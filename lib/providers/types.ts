import type { AgentEvent, ProviderInfo } from "../events";
import type { ToolDef, ToolOutcome } from "../tools";

// The contract every provider implements. The team logic in lib/team.ts only
// talks to this interface, so it works the same on Claude, Gemini and Azure.

export interface UsageDelta {
  input?: number;
  output?: number;
  cacheRead?: number;
  searches?: number;
}

export interface Meter {
  add(u: UsageDelta): void;
}

export interface LoopOptions {
  /** "lead" or a researcher id like "r2". Tags the web events this loop emits. */
  agent: string;
  system: string;
  firstMessage: string;
  /** The agent's own tools. The provider adds web_search / web_fetch itself. */
  tools: ToolDef[];
  exec: (name: string, input: unknown) => Promise<ToolOutcome>;
  /** Checked after every turn; the loop ends when it returns true. */
  isDone: () => boolean;
  maxTurns: number;
  /** Sent when the model stops without finishing. */
  nudge: string;
  /**
   * Called before each web_search / web_fetch this server runs. Return a message to
   * refuse the call (the model sees it as the tool result), or null to allow it.
   * Keeps weaker models on the workflow. Built-in web tools (Claude) aren't affected.
   */
  webGuard?: (tool: "web_search" | "web_fetch") => string | null;
  /** Claude only: thinking depth for this loop. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  emit: (e: AgentEvent) => void;
  signal: AbortSignal;
  meter: Meter;
}

/** Why a loop ended without isDone() becoming true. null = finished normally. */
export type LoopEnd = null | string;

export interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  searches: number;
}

export interface Provider {
  info: ProviderInfo;
  /** How web search works: "built-in" or the backend name. */
  webLabel: string;
  /** How many researchers may run at the same time (lower on free tiers). */
  concurrency: number;
  runLoop(o: LoopOptions): Promise<LoopEnd>;
  /** One-shot call that should answer with JSON matching `schema`. Returns the raw text. */
  json(system: string, user: string, schema: Record<string, unknown>, signal: AbortSignal): Promise<string | undefined>;
  /** Estimated USD for these totals: 0 on free tiers, null if unknown. */
  cost(t: Totals): number | null;
}
