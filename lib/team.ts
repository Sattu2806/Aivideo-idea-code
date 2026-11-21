import { checkCitations } from "./citations";
import type { AgentEvent, Competitor, PlanStep, RunRequest, TeamMember } from "./events";
import { leadPrompt, researcherMessage, researcherPrompt, reviewerPrompt, userMessage } from "./prompts";
import type { Provider, Totals } from "./providers/types";
import {
  AGENT_TOOLS,
  ASSIGN_TOOL,
  AssignInput,
  CompetitorInput,
  FINISH_TOOL,
  FinishInput,
  invalid,
  parseReview,
  PlanInput,
  REVIEW_JSON_SCHEMA,
  ReportInput,
  reviewInput,
  StepInput,
  toolDef,
  type ToolOutcome,
} from "./tools";

// ---------------------------------------------------------------------------
// A small team of agents:
//   lead       plans, finds the companies, assigns researchers, writes the report
//   researcher one per company, in parallel; returns a cited profile
//   checks     every submitted report gets a citation check, then a review
// ---------------------------------------------------------------------------

const LEAD_TURNS = 40;
const RESEARCHER_TURNS = 12;
const MAX_REVIEW_ROUNDS = 2;
const MAX_ASSIGN_CALLS = 2;
const LEAD_WEB_BEFORE_ASSIGN = 6; // enough to identify the companies
const LEAD_WEB_AFTER_ASSIGN = 8; // filling gaps after the researchers report
const RESEARCHER_WEB = 8;

export async function runTeam(provider: Provider, req: RunRequest, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  // Usage across every agent in the run.
  const totals: Totals = { input: 0, output: 0, cacheRead: 0, searches: 0 };
  const meter = {
    add(u: { input?: number; output?: number; cacheRead?: number; searches?: number }) {
      totals.input += u.input ?? 0;
      totals.output += u.output ?? 0;
      totals.cacheRead += u.cacheRead ?? 0;
      totals.searches += u.searches ?? 0;
      emit({
        type: "usage",
        input_tokens: totals.input,
        output_tokens: totals.output,
        cache_read_tokens: totals.cacheRead,
        web_searches: totals.searches,
        cost: provider.cost(totals),
      });
    },
  };

  let plan: PlanStep[] = [];
  const competitors = new Map<string, Competitor>();
  for (const c of req.followUp?.competitors ?? []) competitors.set(c.name.toLowerCase(), c);
  const team: TeamMember[] = [];
  let assignCalls = 0;
  let reviewRounds = 0;
  let finished = false;
  const lastSubmitted: { current: { report: import("./events").Report; issues: string[] } | null } = { current: null };

  function recordCompetitor(input: unknown, agent: string): ToolOutcome {
    const p = CompetitorInput.safeParse(input);
    if (!p.success) return invalid(p.error.message);
    competitors.set(p.data.name.toLowerCase(), p.data);
    emit({ type: "competitor", competitor: p.data, agent });
    return { content: `Saved ${p.data.name}. ${competitors.size} compan${competitors.size === 1 ? "y" : "ies"} on file.` };
  }

  // ---- one researcher -------------------------------------------------------
  async function runResearcher(member: TeamMember, website?: string, focus?: string) {
    let recorded: Competitor | null = null;
    let webCalls = 0;
    let summary = "";
    let done = false;
    const end = await provider
      .runLoop({
        agent: member.id,
        system: researcherPrompt(req.mode),
        firstMessage: researcherMessage(req, member.name, website, focus),
        tools: [toolDef("record_competitor"), FINISH_TOOL],
        exec: async (name, input) => {
          if (name === "record_competitor") {
            const out = recordCompetitor(input, member.id);
            if (!out.isError) recorded = CompetitorInput.parse(input);
            return out;
          }
          if (name === "finish_research") {
            const p = FinishInput.safeParse(input);
            if (!p.success) return invalid(p.error.message);
            if (!recorded) return { content: "Call record_competitor first, then finish_research.", isError: true };
            summary = p.data.summary;
            done = true;
            return { content: "Thanks — reported to the lead." };
          }
          return invalid(`unknown tool ${name}`);
        },
        isDone: () => done,
        webGuard: () =>
          ++webCalls > RESEARCHER_WEB
            ? "Refused: you've used your web budget. Call record_competitor now with what you found, then finish_research."
            : null,
        maxTurns: RESEARCHER_TURNS,
        nudge: "Finish now: call record_competitor with what you have found (if you haven't), then finish_research.",
        effort: "low",
        emit,
        signal,
        meter,
      })
      .catch((err: unknown) => {
        if (signal.aborted) throw err;
        return err instanceof Error ? err.message : String(err);
      });

    member.status = recorded ? "done" : "failed";
    emit({ type: "member", id: member.id, status: member.status });
    return { company: member.name, status: member.status, profile: recorded, findings: summary || null, problem: recorded ? undefined : end ?? "no profile filed" };
  }

  async function assign(input: unknown): Promise<ToolOutcome> {
    const p = AssignInput.safeParse(input);
    if (!p.success) return invalid(p.error.message);
    if (assignCalls >= MAX_ASSIGN_CALLS) return { content: "You've already used your researchers. Fill remaining gaps yourself.", isError: true };
    assignCalls++;

    const jobs = p.data.researchers.map((r) => {
      const member: TeamMember = { id: `r${team.length + 1}`, name: r.company, status: "working" };
      team.push(member);
      return { member, website: r.website, focus: r.focus };
    });
    emit({ type: "team", members: team.map((m) => ({ ...m })) });
    emit({ type: "status", message: `${jobs.length} researchers working in parallel…` });

    // Run with a concurrency limit (free tiers allow only a few requests a minute).
    const results: Awaited<ReturnType<typeof runResearcher>>[] = new Array(jobs.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(provider.concurrency, jobs.length) }, async () => {
        while (next < jobs.length) {
          const i = next++;
          results[i] = await runResearcher(jobs[i].member, jobs[i].website, jobs[i].focus);
        }
      }),
    );
    return { content: `Researchers reported back:\n${JSON.stringify(results, null, 1).slice(0, 40_000)}` };
  }

  async function submit(input: unknown): Promise<ToolOutcome> {
    const p = ReportInput.safeParse(input);
    if (!p.success) return invalid(p.error.message);
    if (reviewRounds < MAX_REVIEW_ROUNDS) {
      reviewRounds++;
      const cites = await checkCitations(provider, `${p.data.executive_summary}\n${p.data.report_markdown}`, emit, signal, reviewRounds);
      emit({ type: "status", message: "Reviewer is checking the report…" });
      const review = await provider
        .json(reviewerPrompt(req.mode), reviewInput(req.company, p.data, competitors.size, cites.notes), REVIEW_JSON_SCHEMA, signal)
        .then(parseReview)
        .catch(() => ({ approved: true, issues: [] as string[] }));
      const issues = [...cites.issues, ...review.issues];
      const approved = issues.length === 0;
      lastSubmitted.current = { report: p.data, issues };
      emit({ type: "review", approved, issues, attempt: reviewRounds, citations: cites.stats });
      if (!approved) {
        return { content: `The report was sent back. Fix these issues, then call submit_report again:\n- ${issues.join("\n- ")}`, isError: true };
      }
    }
    emit({ type: "report", report: p.data });
    finished = true;
    return { content: "Report accepted and delivered to the user." };
  }

  // ---- the lead -------------------------------------------------------------
  let leadWebBefore = 0;
  let leadWebAfter = 0;
  const end = await provider.runLoop({
    agent: "lead",
    system: leadPrompt(req.mode),
    firstMessage: userMessage(req),
    tools: [...AGENT_TOOLS, ASSIGN_TOOL],
    exec: async (name, input) => {
      switch (name) {
        case "plan_research": {
          const p = PlanInput.safeParse(input);
          if (!p.success) return invalid(p.error.message);
          plan = p.data.steps.map((title) => ({ title, status: "pending" }));
          emit({ type: "plan", steps: plan });
          return { content: `Plan saved with ${plan.length} steps (indexes 0-${plan.length - 1}).` };
        }
        case "update_step": {
          const p = StepInput.safeParse(input);
          if (!p.success) return invalid(p.error.message);
          if (p.data.index >= plan.length) return invalid(`no step ${p.data.index}; the plan has ${plan.length} steps`);
          plan[p.data.index] = { ...plan[p.data.index], status: p.data.status, note: p.data.note };
          emit({ type: "step", ...p.data });
          return { content: "Step updated." };
        }
        case "assign_researchers":
          return assign(input);
        case "record_competitor":
          return recordCompetitor(input, "lead");
        case "submit_report":
          return submit(input);
        default:
          return invalid(`unknown tool ${name}`);
      }
    },
    isDone: () => finished,
    webGuard: () => {
      if (assignCalls === 0) {
        return ++leadWebBefore > LEAD_WEB_BEFORE_ASSIGN
          ? "Refused: you have enough to identify the main companies. Call assign_researchers now with 3-5 of them (they research in depth); don't research them yourself."
          : null;
      }
      return ++leadWebAfter > LEAD_WEB_AFTER_ASSIGN
        ? "Refused: research budget used. Write the report from the researchers' profiles and call submit_report."
        : null;
    },
    maxTurns: LEAD_TURNS,
    nudge: "Continue with the plan. When the research is complete, call submit_report.",
    emit,
    signal,
    meter,
  });

  if (!finished && lastSubmitted.current) {
    // Out of steps after a report was written: deliver it rather than nothing, with the open notes.
    const { report, issues } = lastSubmitted.current;
    const notes = issues.length ? `\n\n---\n\n> **Reviewer notes not yet addressed:**\n${issues.map((i) => `> - ${i}`).join("\n")}` : "";
    emit({ type: "status", message: "Step limit reached — delivering the last draft with the reviewer's notes." });
    emit({ type: "report", report: { ...report, report_markdown: report.report_markdown + notes } });
    finished = true;
  }
  if (!finished) emit({ type: "error", message: end ?? "The agent stopped without a final report." });
}
