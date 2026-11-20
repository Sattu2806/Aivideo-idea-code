import { z } from "zod";
import type { AgentEvent, Competitor, PlanStep, Report } from "./events";

// ---------------------------------------------------------------------------
// Tool definitions shared by every provider (plain JSON Schema).
// web_search / web_fetch are only used by providers without built-in web tools.
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const strArray = { type: "array", items: { type: "string" } };

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "plan_research",
    description: "Write your research plan as an ordered list of steps. Call this once at the start. The user sees it as a live checklist.",
    parameters: {
      type: "object",
      properties: { steps: { ...strArray, description: "4-7 short, concrete steps" } },
      required: ["steps"],
    },
  },
  {
    name: "update_step",
    description: "Mark a plan step as in_progress, done or skipped. index is 0-based.",
    parameters: {
      type: "object",
      properties: {
        index: { type: "integer" },
        status: { type: "string", enum: ["in_progress", "done", "skipped"] },
        note: { type: "string", description: "Optional one-line note on what you found" },
      },
      required: ["index", "status"],
    },
  },
  {
    name: "record_competitor",
    description: "Save your findings on one company. Call it once per company, as soon as the research on it is done.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        website: { type: "string" },
        one_liner: { type: "string", description: "What they do, in one sentence" },
        target_customers: { type: "string" },
        pricing: { type: "string", description: "Plans and prices as published, or 'Not public'" },
        key_features: strArray,
        strengths: strArray,
        weaknesses: { ...strArray, description: "From real user feedback where possible" },
        threat_level: { type: "string", enum: ["low", "medium", "high"] },
        sources: { ...strArray, description: "URLs you used" },
      },
      required: ["name", "website", "one_liner", "target_customers", "pricing", "key_features", "strengths", "weaknesses", "threat_level", "sources"],
    },
  },
  {
    name: "submit_report",
    description: "Submit the final report. An independent reviewer checks it and may send it back with issues to fix.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        executive_summary: { type: "string", description: "3-4 sentences" },
        report_markdown: { type: "string", description: "The full report in markdown" },
      },
      required: ["title", "executive_summary", "report_markdown"],
    },
  },
];

export const WEB_TOOLS: ToolDef[] = [
  {
    name: "web_search",
    description: "Search the web. Returns result titles, URLs and snippets. Use specific queries.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "web_fetch",
    description: "Read a web page and return its text. Use it on URLs from search results or URLs you already know.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PlanInput = z.object({ steps: z.array(z.string().min(1)).min(1).max(10) });
const StepInput = z.object({
  index: z.coerce.number().int().min(0),
  status: z.enum(["in_progress", "done", "skipped"]),
  note: z.string().optional(),
});
const CompetitorInput = z.object({
  name: z.string(),
  website: z.string(),
  one_liner: z.string(),
  target_customers: z.string(),
  pricing: z.string(),
  key_features: z.array(z.string()),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  threat_level: z.enum(["low", "medium", "high"]),
  sources: z.array(z.string()),
});
const ReportInput = z.object({ title: z.string(), executive_summary: z.string(), report_markdown: z.string() });
export const ReviewSchema = z.object({ approved: z.boolean(), issues: z.array(z.string()) });
export type Review = z.infer<typeof ReviewSchema>;

export const MAX_REVIEW_ROUNDS = 2;

export interface ToolOutcome {
  content: string;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Run state + the four agent tools. Same logic for every provider.
// ---------------------------------------------------------------------------

export class AgentState {
  plan: PlanStep[] = [];
  competitors = new Map<string, Competitor>();
  reviewRounds = 0;
  finished = false;

  constructor(
    private emit: (e: AgentEvent) => void,
    private review: (report: Report, competitorCount: number) => Promise<Review>,
    seed: Competitor[] = [],
  ) {
    for (const c of seed) this.competitors.set(c.name.toLowerCase(), c);
  }

  isAgentTool(name: string) {
    return AGENT_TOOLS.some((t) => t.name === name);
  }

  async run(name: string, input: unknown): Promise<ToolOutcome> {
    const invalid = (msg: string): ToolOutcome => ({ content: `Invalid input: ${msg}`, isError: true });

    switch (name) {
      case "plan_research": {
        const p = PlanInput.safeParse(input);
        if (!p.success) return invalid(p.error.message);
        this.plan = p.data.steps.map((title) => ({ title, status: "pending" }));
        this.emit({ type: "plan", steps: this.plan });
        return { content: `Plan saved with ${this.plan.length} steps (indexes 0-${this.plan.length - 1}).` };
      }
      case "update_step": {
        const p = StepInput.safeParse(input);
        if (!p.success) return invalid(p.error.message);
        if (p.data.index >= this.plan.length) return invalid(`no step ${p.data.index}; the plan has ${this.plan.length} steps`);
        this.plan[p.data.index] = { ...this.plan[p.data.index], status: p.data.status, note: p.data.note };
        this.emit({ type: "step", ...p.data });
        return { content: "Step updated." };
      }
      case "record_competitor": {
        const p = CompetitorInput.safeParse(input);
        if (!p.success) return invalid(p.error.message);
        this.competitors.set(p.data.name.toLowerCase(), p.data);
        this.emit({ type: "competitor", competitor: p.data });
        return { content: `Saved ${p.data.name}. ${this.competitors.size} compan${this.competitors.size === 1 ? "y" : "ies"} recorded so far.` };
      }
      case "submit_report": {
        const p = ReportInput.safeParse(input);
        if (!p.success) return invalid(p.error.message);
        if (this.reviewRounds < MAX_REVIEW_ROUNDS) {
          this.reviewRounds++;
          this.emit({ type: "status", message: "Reviewer is checking the report…" });
          const r = await this.review(p.data, this.competitors.size).catch((): Review => ({ approved: true, issues: [] }));
          this.emit({ type: "review", approved: r.approved, issues: r.issues, attempt: this.reviewRounds });
          if (!r.approved && r.issues.length > 0) {
            return {
              content: `The reviewer sent the report back. Fix these issues, then call submit_report again:\n- ${r.issues.join("\n- ")}`,
              isError: true,
            };
          }
        }
        this.emit({ type: "report", report: p.data });
        this.finished = true;
        return { content: "Report accepted and delivered to the user." };
      }
      default:
        return invalid(`unknown tool ${name}`);
    }
  }
}

export function reviewInput(subject: string, report: Report, count: number) {
  return `Subject: ${subject}\nCompanies recorded by the agent: ${count}\n\n# ${report.title}\n\n${report.executive_summary}\n\n${report.report_markdown}`;
}

/** Parse a reviewer reply that should be JSON; tolerate code fences. A bad reply never blocks the user. */
export function parseReview(text: string | undefined | null): Review {
  if (!text) return { approved: true, issues: [] };
  const json = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    const r = ReviewSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : { approved: true, issues: [] };
  } catch {
    return { approved: true, issues: [] };
  }
}
