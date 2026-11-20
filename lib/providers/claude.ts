import Anthropic from "@anthropic-ai/sdk";
import type { ProviderInfo } from "../events";
import type { LoopEnd, LoopOptions, Provider, Totals } from "./types";

// Claude, via the Claude API or Claude on Azure (Microsoft Foundry).
// Web search and web fetch run on the provider's servers as built-in tools.

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const DEFAULT_EFFORT: Effort = (EFFORTS as readonly string[]).includes(process.env.AGENT_EFFORT ?? "")
  ? (process.env.AGENT_EFFORT as Effort)
  : "medium";

/** The parts of the client used here; satisfied by both Anthropic and AnthropicFoundry. */
export type ClaudeClient = {
  messages: Pick<Anthropic["messages"], "create">;
  beta: { messages: Pick<Anthropic["beta"]["messages"], "stream"> };
};

export interface ClaudeConfig {
  client: ClaudeClient;
  info: ProviderInfo;
  /** Foundry hosted on Azure supports only the basic web tool versions and has no server-side fallback. */
  platform: "anthropic" | "foundry";
  /** USD per million tokens, for the live estimate. */
  price: { input: number; output: number; cacheRead: number };
}

export function makeClaudeProvider({ client, info, platform, price }: ClaudeConfig): Provider {
  const model = info.model;
  const webTools: Anthropic.Beta.BetaToolUnion[] =
    platform === "anthropic"
      ? [
          { type: "web_search_20260209", name: "web_search", max_uses: 10 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 12, max_content_tokens: 8000 },
        ]
      : [
          { type: "web_search_20250305", name: "web_search", max_uses: 10 },
          { type: "web_fetch_20250910", name: "web_fetch", max_uses: 12, max_content_tokens: 8000 },
        ];

  async function runLoop(o: LoopOptions): Promise<LoopEnd> {
    const { agent, emit, signal, meter } = o;
    const lead = agent === "lead";
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      ...webTools,
      ...o.tools.map(
        (t): Anthropic.Beta.BetaTool => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
          eager_input_streaming: true,
        }),
      ),
    ];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: o.firstMessage }];
    let jsonRetries = 0;
    let nudges = 0;

    for (let turn = 0; turn < o.maxTurns; turn++) {
      if (lead) emit({ type: "status", message: turn === 0 ? "Planning the research…" : "Deciding the next move…" });

      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          // On the Claude API, a declined request is retried on a fallback model in the same call.
          ...(platform === "anthropic" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: o.effort ?? DEFAULT_EFFORT },
          cache_control: { type: "ephemeral" },
          system: o.system,
          tools,
          messages,
        },
        { signal },
      );

      if (lead) stream.on("thinking", (delta) => emit({ type: "thinking", text: delta }));
      stream.on("contentBlock", (block) => {
        if (block.type === "server_tool_use") {
          const input = block.input as { query?: string; url?: string };
          if (block.name === "web_search") emit({ type: "search", id: block.id, query: input.query ?? "", agent });
          if (block.name === "web_fetch") emit({ type: "fetch", id: block.id, url: input.url ?? "", agent });
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
        continue; // unparseable tool input or dropped connection: re-issue the turn
      }

      meter.add({
        input: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0),
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        searches: message.usage.server_tool_use?.web_search_requests ?? 0,
      });

      messages.push({ role: "assistant", content: message.content }); // unchanged, thinking blocks included

      if (message.stop_reason === "refusal") return "The model declined to continue this request.";
      if (message.stop_reason === "pause_turn") continue;

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) {
        if (message.stop_reason === "max_tokens") return "The agent ran out of output space.";
        if (nudges++ >= 2) return "The agent stopped without finishing.";
        messages.push({ role: "user", content: o.nudge });
        continue;
      }
      if (message.stop_reason === "max_tokens") return "A tool call was cut off (max_tokens).";

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tool of toolUses) {
        const r = await o.exec(tool.name, tool.input);
        results.push({ type: "tool_result", tool_use_id: tool.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (o.isDone()) return null;
    }
    return `Stopped after ${o.maxTurns} steps.`;
  }

  async function json(system: string, user: string, schema: Record<string, unknown>, signal: AbortSignal) {
    const res = await client.messages.create(
      {
        model,
        max_tokens: 16000,
        output_config: { effort: "low" },
        system: `${system}\n\nReply with JSON only, matching this schema: ${JSON.stringify(schema)}`,
        messages: [{ role: "user", content: user }],
      },
      { signal },
    );
    if (res.stop_reason === "refusal") return undefined;
    return res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  }

  return {
    info,
    webLabel: "built-in",
    concurrency: 4,
    runLoop,
    json,
    cost: (t: Totals) => (t.input * price.input + t.output * price.output + t.cacheRead * price.cacheRead) / 1e6 + t.searches * 0.01,
  };
}
