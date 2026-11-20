import { z } from "zod";
import type { Report } from "./events";

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

export const ASSIGN_TOOL: ToolDef = {
  name: "assign_researchers",
  description:
    "Hand companies to researcher agents that research them in parallel. Call it once with all the companies. Returns each researcher's profile and findings.",
  parameters: {
    type: "object",
    properties: {
      researchers: {
        type: "array",
        description: "One entry per company, at most 6",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            website: { type: "string" },
            focus: { type: "string", description: "Optional: what this researcher should pay special attention to" },
          },
          required: ["company"],
        },
      },
    },
    required: ["researchers"],
  },
};

export const FINISH_TOOL: ToolDef = {
  name: "finish_research",
  description: "Report back to the lead analyst. Call it last, after record_competitor.",
  parameters: {
    type: "object",
    properties: { summary: { type: "string", description: "3-5 bullet points, each with its source URL" } },
    required: ["summary"],
  },
};

export const toolDef = (name: string) => [...AGENT_TOOLS, ASSIGN_TOOL, FINISH_TOOL].find((t) => t.name === name)!;

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

export const PlanInput = z.object({ steps: z.array(z.string().min(1)).min(1).max(10) });
export const StepInput = z.object({
  index: z.coerce.number().int().min(0),
  status: z.enum(["in_progress", "done", "skipped"]),
  note: z.string().optional(),
});
export const CompetitorInput = z.object({
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
export const ReportInput = z.object({ title: z.string(), executive_summary: z.string(), report_markdown: z.string() });
export const AssignInput = z.object({
  researchers: z
    .array(z.object({ company: z.string().min(1), website: z.string().optional(), focus: z.string().optional() }))
    .min(1)
    .max(6),
});
export const FinishInput = z.object({ summary: z.string() });

export const ReviewSchema = z.object({ approved: z.boolean(), issues: z.array(z.string()) });
export type Review = z.infer<typeof ReviewSchema>;
export const REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: { approved: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } },
  required: ["approved", "issues"],
};

export interface ToolOutcome {
  content: string;
  isError?: boolean;
}

export const invalid = (msg: string): ToolOutcome => ({ content: `Invalid input: ${msg}`, isError: true });

export function reviewInput(subject: string, report: Report, count: number, citationNotes = "") {
  return `Subject: ${subject}\nCompanies recorded by the team: ${count}${citationNotes ? `\n\nCitation check:\n${citationNotes}` : ""}\n\n# ${report.title}\n\n${report.executive_summary}\n\n${report.report_markdown}`;
}

/** Parse a reply that should be JSON; tolerates code fences. Returns null if it isn't valid. */
export function parseJson(text: string | undefined | null): unknown {
  if (!text) return null;
  const json = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(json);
  } catch {
    const m = json.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/** A bad reviewer reply never blocks the user. */
export function parseReview(text: string | undefined | null): Review {
  const r = ReviewSchema.safeParse(parseJson(text));
  return r.success ? r.data : { approved: true, issues: [] };
}
