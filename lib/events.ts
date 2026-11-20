// Events the agent streams to the browser, one JSON object per line.
// Shared by the server (lib/agent.ts) and the UI (app/page.tsx).

export type StepStatus = "pending" | "in_progress" | "done" | "skipped";

export interface PlanStep {
  title: string;
  status: StepStatus;
  note?: string;
}

export interface Competitor {
  name: string;
  website: string;
  one_liner: string;
  target_customers: string;
  pricing: string;
  key_features: string[];
  strengths: string[];
  weaknesses: string[];
  threat_level: "low" | "medium" | "high";
  sources: string[];
}

export interface Report {
  title: string;
  executive_summary: string;
  report_markdown: string;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "plan"; steps: PlanStep[] }
  | { type: "step"; index: number; status: StepStatus; note?: string }
  | { type: "search"; id: string; query: string }
  | { type: "search_results"; id: string; results: { title: string; url: string }[]; error?: string }
  | { type: "fetch"; id: string; url: string }
  | { type: "fetch_result"; id: string; url: string; title?: string; error?: string }
  | { type: "competitor"; competitor: Competitor }
  | { type: "review"; approved: boolean; issues: string[]; attempt: number }
  | { type: "report"; report: Report }
  | { type: "usage"; input_tokens: number; output_tokens: number; cache_read_tokens: number; web_searches: number }
  | { type: "error"; message: string }
  | { type: "done" };
