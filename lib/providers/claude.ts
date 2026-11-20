import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, RunRequest } from "../events";
import { reviewerPrompt, systemPrompt, userMessage } from "../prompts";
import { AGENT_TOOLS, AgentState, parseReview, reviewInput } from "../tools";

// Claude, via the Claude API or Claude on Azure (Microsoft Foundry).
// Web search and web fetch run on the provider's servers as built-in tools.

const MAX_TURNS = 40;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const EFFORT: Effort = (EFFORTS as readonly string[]).includes(process.env.AGENT_EFFORT ?? "")
  ? (process.env.AGENT_EFFORT as Effort)
  : "medium";

/** The parts of the client this loop uses; satisfied by both Anthropic and AnthropicFoundry. */
export type ClaudeClient = { messages: Pick<Anthropic["messages"], "create">; beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> } };

export interface ClaudeOptions {
  client: ClaudeClient;
  model: string;
  /** Foundry hosted on Azure supports only the basic web tool versions and has no server-side fallback. */
  platform: "anthropic" | "foundry";
  /** USD per million tokens, for the live cost estimate. */
  price: { input: number; output: number; cacheRead: number };
}

export async function runClaude(opts: ClaudeOptions, req: RunRequest, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  const { client, model, platform, price } = opts;

  const tools: Anthropic.Beta.BetaToolUnion[] = [
    platform === "anthropic"
      ? { type: "web_search_20260209", name: "web_search", max_uses: 12 }
      : { type: "web_search_20250305", name: "web_search", max_uses: 12 },
    platform === "anthropic"
      ? { type: "web_fetch_20260209", name: "web_fetch", max_uses: 15, max_content_tokens: 8000 }
      : { type: "web_fetch_20250910", name: "web_fetch", max_uses: 15, max_content_tokens: 8000 },
    ...AGENT_TOOLS.map(
      (t): Anthropic.Beta.BetaTool => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
        eager_input_streaming: true,
      }),
    ),
  ];

  const state = new AgentState(
    emit,
    async (report, count) => {
      const res = await client.messages.create(
        {
          model,
          max_tokens: 16000,
          output_config: { effort: "low" },
          system: reviewerPrompt(req.mode),
          messages: [{ role: "user", content: reviewInput(req.company, report, count) }],
        },
        { signal },
      );
      const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
      return parseReview(text);
    },
    req.followUp?.competitors,
  );

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userMessage(req) }];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, web_searches: 0 };
  let jsonRetries = 0;
  let nudges = 0;

  for (let turn = 0; turn < MAX_TURNS && !state.finished; turn++) {
    emit({ type: "status", message: turn === 0 ? "Planning the research…" : "Deciding the next move…" });

    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        // On the Claude API, a declined request is retried on a fallback model in the same call.
        ...(platform === "anthropic" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: EFFORT },
        cache_control: { type: "ephemeral" },
        system: systemPrompt(req.mode),
        tools,
        messages,
      },
      { signal },
    );

    stream.on("thinking", (delta) => emit({ type: "thinking", text: delta }));
    stream.on("text", (delta) => emit({ type: "text", text: delta }));
    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use") {
        const input = block.input as { query?: string; url?: string };
        if (block.name === "web_search") emit({ type: "search", id: block.id, query: input.query ?? "" });
        if (block.name === "web_fetch") emit({ type: "fetch", id: block.id, url: input.url ?? "" });
      } else if (block.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          emit({ type: "search_results", id: block.tool_use_id, results: block.content.map((r) => ({ title: r.title, url: r.url })) });
        } else {
          emit({ type: "search_results", id: block.tool_use_id, results: [], error: block.content.error_code });
        }
      } else if (block.type === "web_fetch_tool_result") {
        if (block.content.type === "web_fetch_result") {
          emit({ type: "fetch_result", id: block.tool_use_id, url: block.content.url, title: block.content.content.title ?? undefined });
        } else {
          emit({ type: "fetch_result", id: block.tool_use_id, url: "", error: block.content.error_code });
        }
      }
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
      emit({ type: "status", message: "Connection hiccup, retrying this step…" });
      continue;
    }

    usage.input_tokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0);
    usage.output_tokens += message.usage.output_tokens;
    usage.cache_read_tokens += message.usage.cache_read_input_tokens ?? 0;
    usage.web_searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    const cost =
      (usage.input_tokens * price.input + usage.output_tokens * price.output + usage.cache_read_tokens * price.cacheRead) / 1e6 +
      usage.web_searches * 0.01;
    emit({ type: "usage", ...usage, cost });

    messages.push({ role: "assistant", content: message.content }); // unchanged, thinking blocks included

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined to continue this request." });
      return;
    }
    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      if (message.stop_reason === "max_tokens") {
        emit({ type: "error", message: "The agent ran out of output space." });
        return;
      }
      if (nudges++ >= 2) {
        emit({ type: "error", message: "The agent stopped without submitting a report." });
        return;
      }
      messages.push({ role: "user", content: "Continue working through the plan. When the research is complete, call submit_report." });
      continue;
    }
    if (message.stop_reason === "max_tokens") {
      emit({ type: "error", message: "A tool call was cut off (max_tokens). Try again." });
      return;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      const r = await state.run(tool.name, tool.input);
      results.push({ type: "tool_result", tool_use_id: tool.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  if (!state.finished) emit({ type: "error", message: `Stopped after ${MAX_TURNS} steps without a final report.` });
}
