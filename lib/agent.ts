import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AgentEvent, PlanStep } from "./events";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 40; // hard stop for the agent loop
const MAX_REVIEW_ROUNDS = 2; // how many times the reviewer can send the report back
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const EFFORT: Effort = (EFFORTS as readonly string[]).includes(process.env.AGENT_EFFORT ?? "")
  ? (process.env.AGENT_EFFORT as Effort)
  : "medium";

// ---------------------------------------------------------------------------
// System prompt (kept static so it is cached across every turn of the loop)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a competitive-intelligence analyst working as an autonomous agent. The user gives you a company (a name, a URL, or both) and optionally a focus. Your job is to deliver a competitor analysis a founder or sales team could act on today.

How to work:
1. Start by calling plan_research with 4-7 concrete steps. First step is always understanding the target company itself.
2. Work through the plan with web_search and web_fetch. Call update_step when you start a step (in_progress) and when you finish or skip it.
3. Identify the 3-5 most relevant direct competitors. Prefer the companies the target's own customers would actually compare it to, not the biggest names in the industry.
4. For each competitor, research positioning, target customers, pricing, key features, strengths and weaknesses. Get pricing from the competitor's own pricing page when one exists. Get weaknesses from real user feedback (review sites, forums, app store reviews), not from the competitor's marketing.
5. As soon as you have solid information on a competitor, call record_competitor. Don't wait until the end.
6. When every competitor is recorded, call submit_report. The report must include: a comparison table (one row per competitor: pricing, target customer, biggest strength, biggest weakness, threat level), the gaps in the market the target company could exploit, and 3-5 specific recommended actions.

Rules:
- Every factual claim in the report cites its source URL inline as a markdown link.
- If you cannot find something (for example pricing is "contact sales"), say so plainly. Never guess numbers.
- Be decisive in the recommendations. Generic advice like "focus on customer experience" is not useful.
- An independent reviewer checks your report when you submit it. If it sends the report back, fix every issue it lists, doing more research where needed, and submit again.`;

// ---------------------------------------------------------------------------
// Custom tools (run in this server). Web search and web fetch run on
// Anthropic's servers, so they have no code here.
// ---------------------------------------------------------------------------

const PlanInput = z.object({ steps: z.array(z.string().min(1)).min(1).max(10) });
const StepInput = z.object({
  index: z.number().int().min(0),
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
const ReportInput = z.object({
  title: z.string(),
  executive_summary: z.string(),
  report_markdown: z.string(),
});

const strArray = { type: "array", items: { type: "string" } } as const;

const CUSTOM_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "plan_research",
    description:
      "Write your research plan as an ordered list of steps. Call this once at the start. The user sees the plan as a live checklist.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { steps: { ...strArray, description: "4-7 short, concrete steps" } },
      required: ["steps"],
    },
  },
  {
    name: "update_step",
    description: "Mark a plan step as in_progress, done or skipped. index is 0-based.",
    eager_input_streaming: true,
    input_schema: {
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
    description:
      "Save your findings on one competitor. Call it once per competitor, as soon as the research on it is done.",
    eager_input_streaming: true,
    input_schema: {
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
      required: [
        "name",
        "website",
        "one_liner",
        "target_customers",
        "pricing",
        "key_features",
        "strengths",
        "weaknesses",
        "threat_level",
        "sources",
      ],
    },
  },
  {
    name: "submit_report",
    description:
      "Submit the final competitor report. An independent reviewer checks it and may send it back with issues to fix.",
    eager_input_streaming: true,
    input_schema: {
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

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 12 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 15, max_content_tokens: 8000 },
  ...CUSTOM_TOOLS,
];

// ---------------------------------------------------------------------------
// Reviewer: a second, independent model call that grades the report.
// This is what makes the agent self-correcting.
// ---------------------------------------------------------------------------

const ReviewSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()),
});

async function reviewReport(
  client: Anthropic,
  target: string,
  report: z.infer<typeof ReportInput>,
  competitorCount: number,
  signal: AbortSignal,
): Promise<z.infer<typeof ReviewSchema>> {
  const response = await client.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(ReviewSchema) },
      system:
        "You are a strict editor reviewing a competitor analysis before it goes to a client. Approve it only if ALL of these hold: (1) it covers at least 3 direct competitors; (2) it has a comparison table with pricing, target customer, strength, weakness and threat level per competitor; (3) factual claims, especially prices, cite source URLs; (4) it names concrete market gaps; (5) the recommendations are specific to this company, not generic advice; (6) there are no placeholders or TODOs. If anything fails, set approved to false and list each problem as a short, actionable instruction.",
      messages: [
        {
          role: "user",
          content: `Target company: ${target}\nCompetitors recorded by the agent: ${competitorCount}\n\n# ${report.title}\n\n${report.executive_summary}\n\n${report.report_markdown}`,
        },
      ],
    },
    { signal },
  );
  // A refusal or unparseable reply should not block the user from getting a report.
  return response.parsed_output ?? { approved: true, issues: [] };
}

// ---------------------------------------------------------------------------
// The agent loop
// ---------------------------------------------------------------------------

export interface RunOptions {
  company: string;
  focus?: string;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
}

export async function runCompetitorAgent({ company, focus, emit, signal }: RunOptions) {
  const client = new Anthropic();

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Company to analyse: ${company}${focus ? `\nFocus: ${focus}` : ""}\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
    },
  ];

  let plan: PlanStep[] = [];
  let competitorCount = 0;
  let reviewRounds = 0;
  let finished = false;
  let jsonRetries = 0;
  let nudges = 0;
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, web_searches: 0 };

  for (let turn = 0; turn < MAX_TURNS && !finished; turn++) {
    emit({ type: "status", message: turn === 0 ? "Agent is planning…" : `Agent step ${turn + 1}` });

    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        // If a safety classifier declines, the API retries on a fallback model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: EFFORT },
        cache_control: { type: "ephemeral" }, // cache the growing conversation between turns
        system: SYSTEM_PROMPT,
        tools: TOOLS,
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
          emit({
            type: "search_results",
            id: block.tool_use_id,
            results: block.content.map((r) => ({ title: r.title, url: r.url })),
          });
        } else {
          emit({ type: "search_results", id: block.tool_use_id, results: [], error: block.content.error_code });
        }
      } else if (block.type === "web_fetch_tool_result") {
        if (block.content.type === "web_fetch_result") {
          emit({
            type: "fetch_result",
            id: block.tool_use_id,
            url: block.content.url,
            title: block.content.content.title ?? undefined,
          });
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
      // API errors and user aborts are final. A tool input that could not be parsed
      // (or a dropped connection) is retried a couple of times.
      if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
      emit({ type: "status", message: "Connection hiccup, retrying this step…" });
      continue;
    }

    usage.input_tokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0);
    usage.output_tokens += message.usage.output_tokens;
    usage.cache_read_tokens += message.usage.cache_read_input_tokens ?? 0;
    usage.web_searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    emit({ type: "usage", ...usage });

    // Always append the assistant turn unchanged (thinking blocks included).
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined to continue this request." });
      return;
    }
    if (message.stop_reason === "pause_turn") continue; // long server-tool turn: send it back to resume

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      if (message.stop_reason === "max_tokens") {
        emit({ type: "error", message: "The agent ran out of output space." });
        return;
      }
      // The agent stopped without submitting. Nudge it (at most twice) to finish properly.
      if (nudges++ >= 2) {
        emit({ type: "error", message: "The agent stopped without submitting a report." });
        return;
      }
      messages.push({
        role: "user",
        content: "Continue working through the plan. When the research is complete, call submit_report.",
      });
      continue;
    }
    if (message.stop_reason === "max_tokens") {
      emit({ type: "error", message: "A tool call was cut off (max_tokens). Try again." });
      return;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      const result = await runTool(tool);
      results.push({ type: "tool_result", tool_use_id: tool.id, ...result });
    }
    // All results for one turn go back in a single user message.
    messages.push({ role: "user", content: results });
  }

  if (!finished) emit({ type: "error", message: `Stopped after ${MAX_TURNS} steps without a final report.` });

  // Runs one custom tool and returns the tool_result body.
  async function runTool(tool: Anthropic.Beta.BetaToolUseBlock): Promise<{ content: string; is_error?: boolean }> {
    const invalid = (issues: string) => ({ content: `Invalid input: ${issues}`, is_error: true });

    switch (tool.name) {
      case "plan_research": {
        const p = PlanInput.safeParse(tool.input);
        if (!p.success) return invalid(p.error.message);
        plan = p.data.steps.map((title) => ({ title, status: "pending" }));
        emit({ type: "plan", steps: plan });
        return { content: `Plan saved with ${plan.length} steps (indexes 0-${plan.length - 1}).` };
      }
      case "update_step": {
        const p = StepInput.safeParse(tool.input);
        if (!p.success) return invalid(p.error.message);
        if (p.data.index >= plan.length) return invalid(`no step ${p.data.index}; the plan has ${plan.length} steps`);
        plan[p.data.index] = { ...plan[p.data.index], status: p.data.status, note: p.data.note };
        emit({ type: "step", ...p.data });
        return { content: "Step updated." };
      }
      case "record_competitor": {
        const p = CompetitorInput.safeParse(tool.input);
        if (!p.success) return invalid(p.error.message);
        competitorCount++;
        emit({ type: "competitor", competitor: p.data });
        return { content: `Saved ${p.data.name}. ${competitorCount} competitor(s) recorded so far.` };
      }
      case "submit_report": {
        const p = ReportInput.safeParse(tool.input);
        if (!p.success) return invalid(p.error.message);

        if (reviewRounds < MAX_REVIEW_ROUNDS) {
          reviewRounds++;
          emit({ type: "status", message: "Reviewer is checking the report…" });
          const review = await reviewReport(client, company, p.data, competitorCount, signal);
          emit({ type: "review", approved: review.approved, issues: review.issues, attempt: reviewRounds });
          if (!review.approved && review.issues.length > 0) {
            return {
              content: `The reviewer sent the report back. Fix these issues, then call submit_report again:\n- ${review.issues.join("\n- ")}`,
              is_error: true,
            };
          }
        }
        emit({ type: "report", report: p.data });
        finished = true;
        return { content: "Report accepted and delivered to the user." };
      }
      default:
        return invalid(`unknown tool ${tool.name}`);
    }
  }
}
