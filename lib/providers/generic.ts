import type { AgentEvent, ProviderInfo } from "../events";
import { WEB_TOOLS, type ToolDef } from "../tools";
import { webFetch, webSearch } from "../web";
import type { LoopEnd, LoopOptions, Provider, Totals } from "./types";

// Agent loop for providers whose web tools run in this server (Gemini,
// Azure OpenAI). Each provider plugs in through a ChatAdapter.

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
  next(signal: AbortSignal): Promise<TurnResult>;
  addToolResults(results: { call: ToolCall; content: string; isError: boolean }[]): void;
  addUserText(text: string): void;
}

export interface AdapterKit {
  /** A fresh conversation for one agent loop. */
  chat(init: { system: string; firstMessage: string; tools: ToolDef[]; onWait: (s: number) => void; onNotice: (message: string) => void }): ChatAdapter;
  json(
    system: string,
    user: string,
    schema: Record<string, unknown>,
    signal: AbortSignal,
    onWait: (s: number) => void,
    onNotice: (message: string) => void,
  ): Promise<string | undefined>;
  cost(t: Totals): number | null;
  concurrency: number;
}

const MAX_RESULT_CHARS = 24_000;

export function makeGenericProvider(info: ProviderInfo, webLabel: string, kit: AdapterKit): Provider {
  async function runLoop(o: LoopOptions): Promise<LoopEnd> {
    const { agent, emit, signal, meter } = o;
    const lead = agent === "lead";
    const onWait = (s: number) => emit({ type: "status", message: `Rate limit reached, waiting ${s}s (free tiers are slow)…` });
    const onNotice = (message: string) => emit({ type: "status", message });
    const chat = kit.chat({ system: o.system, firstMessage: o.firstMessage, tools: [...WEB_TOOLS, ...o.tools], onWait, onNotice });
    let nudges = 0;

    for (let turn = 0; turn < o.maxTurns; turn++) {
      if (lead) emit({ type: "status", message: turn === 0 ? "Planning the research…" : "Deciding the next move…" });

      const r = await chat.next(signal);
      meter.add({ input: r.usage.input, output: r.usage.output });
      if (lead && r.thinking) emit({ type: "thinking", text: r.thinking });

      if (r.calls.length === 0) {
        if (r.truncated) return "The agent ran out of output space.";
        if (nudges++ >= 2) return "The agent stopped without finishing.";
        chat.addUserText(o.nudge);
        continue;
      }
      if (r.truncated) return "A tool call was cut off by the output limit.";

      // Web calls in one turn run in parallel; the agent's own tools run in order after them.
      const isWeb = (c: ToolCall) => c.name === "web_search" || c.name === "web_fetch";
      const webCalls = r.calls.filter(isWeb);
      const webOut = await Promise.all(webCalls.map((c) => runWebTool(c, agent, emit, signal, () => meter.add({ searches: 1 }))));
      const byCall = new Map(webCalls.map((c, i) => [c, webOut[i]]));
      for (const call of r.calls) {
        if (isWeb(call)) continue;
        const out = await o.exec(call.name, call.args);
        byCall.set(call, { content: out.content, isError: !!out.isError });
      }
      chat.addToolResults(r.calls.map((call) => ({ call, ...byCall.get(call)! })));
      if (o.isDone()) return null;
    }
    return `Stopped after ${o.maxTurns} steps.`;
  }

  return {
    info,
    webLabel,
    concurrency: kit.concurrency,
    runLoop,
    json: (system, user, schema, signal) => kit.json(system, user, schema, signal, () => {}, () => {}),
    cost: kit.cost,
  };
}

async function runWebTool(call: ToolCall, agent: string, emit: (e: AgentEvent) => void, signal: AbortSignal, countSearch: () => void) {
  if (call.name === "web_search") {
    const query = String(call.args.query ?? "");
    emit({ type: "search", id: call.id, query, agent });
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
  emit({ type: "fetch", id: call.id, url, agent });
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
