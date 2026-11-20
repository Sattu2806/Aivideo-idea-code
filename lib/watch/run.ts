import { runAgent } from "../agent";
import type { AgentEvent, CitationStats, Competitor, Report } from "../events";
import { compareCompetitors, describeChange } from "./diff";
import { claimWatch, finishWatch, getWatch, listWatches, type Watch, type WatchRun } from "./store";

// Runs one watch-mode re-check: the agent researches again with the previous
// report as context, then the profiles are compared and the run is saved.

export async function runWatchCheck(id: string, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<WatchRun | null> {
  const watch = await getWatch(id);
  if (!watch) throw new Error("That watch no longer exists.");
  if (!(await claimWatch(id))) throw new Error("This watch is already being checked. Try again in a few minutes.");

  const prev = watch.runs[0];
  let report: Report | null = null;
  let citations: CitationStats | undefined;
  const competitors = new Map<string, Competitor>();

  const capture = (e: AgentEvent) => {
    if (e.type === "report") report = e.report;
    if (e.type === "competitor") competitors.set(e.competitor.name.toLowerCase(), e.competitor);
    if (e.type === "review" && e.citations) citations = e.citations;
    emit(e);
  };

  let run: WatchRun | null = null;
  try {
    await runAgent(
      {
        company: watch.company,
        mode: watch.mode,
        focus: watch.focus,
        previous: prev ? { date: prev.at, report: prev.report, competitors: prev.competitors } : undefined,
      },
      capture,
      signal,
    );
    if (report) {
      // This run's profiles are the current picture (fall back to the old ones if none were filed).
      const current = competitors.size ? [...competitors.values()] : (prev?.competitors ?? []);
      const changes = prev ? compareCompetitors(prev.competitors, current) : [];
      run = { at: new Date().toISOString(), report, competitors: current, citations, changes };
      emit({ type: "changes", since: prev?.at ?? "", changes, watchId: id });
    }
  } finally {
    await finishWatch(id, run);
  }
  if (run) await notify(watch, run);
  return run;
}

/** Runs watches that are due, oldest first. `limit` keeps one call inside hosting time limits. */
export async function runDueWatches(limit: number, signal: AbortSignal) {
  const due = (await listWatches())
    .filter((w) => Date.parse(w.nextRunAt) <= Date.now() && !w.runningSince)
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
    .slice(0, limit);
  const results: { id: string; company: string; ok: boolean; changes?: number; error?: string }[] = [];
  for (const w of due) {
    try {
      const run = await runWatchCheck(w.id, () => {}, signal);
      results.push({ id: w.id, company: w.company, ok: !!run, changes: run?.changes.length });
    } catch (err) {
      results.push({ id: w.id, company: w.company, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

// Optional Slack / Discord alert (WATCH_WEBHOOK_URL). Sent only when something changed.
async function notify(watch: Watch, run: WatchRun) {
  const url = process.env.WATCH_WEBHOOK_URL;
  if (!url || run.changes.length === 0) return;
  const lines = run.changes.map((c) => `• ${describeChange(c)}`).join("\n");
  const text = `*${watch.company}* — ${run.changes.length} change${run.changes.length === 1 ? "" : "s"} since the last check\n${lines}\n\n${run.report.executive_summary}`;
  try {
    // `text` is read by Slack, `content` by Discord.
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text.slice(0, 1900) }) });
  } catch {
    // an alert failing must not fail the run
  }
}
