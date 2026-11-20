import type { AgentEvent, RunRequest } from "../events";
import { reviewerPrompt, systemPrompt, userMessage } from "../prompts";
import { AGENT_TOOLS, AgentState, parseReview, reviewInput, WEB_TOOLS, type ToolDef } from "../tools";
import { webFetch, webSearch } from "../web";

// One agent loop for providers whose web tools run in this server
// (Gemini, Azure OpenAI). Each provider plugs in through a ChatAdapter.

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface TurnResult {
  calls: ToolCall[];
  text: string;
  thinking: string;
  usage: { input: number; output: number };
  /** true when the reply was cut off by the output limit */
  truncated: boolean;
}

export interface ChatAdapter {
  /** Ask the model for its next move given everything so far. */
  next(signal: AbortSignal): Promise<TurnResult>;
  addToolResults(results: { call: ToolCall; content: string; isError: boolean }[]): void;
  addUserText(text: string): void;
  /** One-shot JSON call, used by the reviewer. */
  json(system: string, user: string, signal: AbortSignal): Promise<string | undefined>;
  /** Estimated USD for this token usage: 0 on free tiers, null if unknown. */
  cost(input: number, output: number): number | null;
}

export type AdapterFactory = (init: { system: string; firstMessage: string; tools: ToolDef[]; onWait: (s: number) => void }) => ChatAdapter;

const MAX_TURNS = 40;
const MAX_RESULT_CHARS = 24_000;

export async function runGeneric(makeAdapter: AdapterFactory, req: RunRequest, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  const adapter = makeAdapter({
    system: systemPrompt(req.mode),
    firstMessage: userMessage(req),
    tools: [...WEB_TOOLS, ...AGENT_TOOLS],
    onWait: (s) => emit({ type: "status", message: `Rate limit reached, waiting ${s}s (free tiers are slow)…` }),
  });

  const state = new AgentState(
    emit,
    async (report, count) => parseReview(await adapter.json(reviewerPrompt(req.mode), reviewInput(req.company, report, count), signal)),
    req.followUp?.competitors,
  );

  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, web_searches: 0 };
  let nudges = 0;

  for (let turn = 0; turn < MAX_TURNS && !state.finished; turn++) {
    emit({ type: "status", message: turn === 0 ? "Planning the research…" : "Deciding the next move…" });

    const r = await adapter.next(signal);
    usage.input_tokens += r.usage.input;
    usage.output_tokens += r.usage.output;
    emit({ type: "usage", ...usage, cost: adapter.cost(usage.input_tokens, usage.output_tokens) });
    if (r.thinking) emit({ type: "thinking", text: r.thinking });
    if (r.text) emit({ type: "text", text: r.text });

    if (r.calls.length === 0) {
      if (r.truncated) {
        emit({ type: "error", message: "The agent ran out of output space." });
        return;
      }
      if (nudges++ >= 2) {
        emit({ type: "error", message: "The agent stopped without submitting a report." });
        return;
      }
      adapter.addUserText("Continue working through the plan using your tools. When the research is complete, call submit_report.");
      continue;
    }
    if (r.truncated) {
      emit({ type: "error", message: "A tool call was cut off by the output limit. Try again." });
      return;
    }

    // Web calls in one turn run in parallel; agent tools run in order after them.
    const webCalls = r.calls.filter((c) => c.name === "web_search" || c.name === "web_fetch");
    const webResults = await Promise.all(webCalls.map((c) => runWebTool(c, emit, signal, () => usage.web_searches++)));
    const results = webCalls.map((call, i) => ({ call, ...webResults[i] }));
    for (const call of r.calls) {
      if (webCalls.includes(call)) continue;
      const out = await state.run(call.name, call.args);
      results.push({ call, content: out.content, isError: !!out.isError });
    }
    // Keep the provider's original call order.
    results.sort((a, b) => r.calls.indexOf(a.call) - r.calls.indexOf(b.call));
    adapter.addToolResults(results);
  }

  if (!state.finished) emit({ type: "error", message: `Stopped after ${MAX_TURNS} steps without a final report.` });
}

async function runWebTool(call: ToolCall, emit: (e: AgentEvent) => void, signal: AbortSignal, countSearch: () => void) {
  if (call.name === "web_search") {
    const query = String(call.args.query ?? "");
    emit({ type: "search", id: call.id, query });
    countSearch();
    try {
      const res = await webSearch(query, signal);
      emit({ type: "search_results", id: call.id, results: res.results.map((x) => ({ title: x.title, url: x.url })) });
      const lines = res.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}${x.snippet ? `\n   ${x.snippet}` : ""}`);
      const content = `${res.summary ? `Summary of findings:\n${res.summary}\n\nSources:\n` : ""}${lines.join("\n") || "No results."}`;
      return { content: content.slice(0, MAX_RESULT_CHARS), isError: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "search_results", id: call.id, results: [], error: msg });
      return { content: `Search failed: ${msg}`, isError: true };
    }
  }

  const url = String(call.args.url ?? "");
  emit({ type: "fetch", id: call.id, url });
  try {
    const page = await webFetch(url, signal);
    emit({ type: "fetch_result", id: call.id, url: page.url, title: page.title || undefined });
    return { content: `URL: ${page.url}\nTitle: ${page.title}\n\n${page.text}`, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: "fetch_result", id: call.id, url, error: msg });
    return { content: `Could not read ${url}: ${msg}`, isError: true };
  }
}
