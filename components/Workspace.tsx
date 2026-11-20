"use client";

import { Fragment, useEffect, useState } from "react";
import type { Competitor } from "@/lib/events";
import { AgentBoard } from "./AgentBoard";
import { ReportView } from "./ReportView";
import { estimateCost, type Activity, type useAgent } from "./useAgent";

type Agent = ReturnType<typeof useAgent>;

export function hostname(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function Workspace({ agent }: { agent: Agent }) {
  const { phase, target, status, plan, activity, thinking, competitors, report, usage, error, startedAt, finishedAt } = agent;
  const running = phase === "running";
  const now = useNow(running);
  const t0 = startedAt ?? now;
  const elapsed = clock((finishedAt ?? now) - t0);
  const searches = activity.filter((a) => a.kind === "search").length;
  const reads = activity.filter((a) => a.kind === "fetch").length;
  const log = [...activity].reverse(); // oldest first, like a real log

  return (
    <div className="ws">
      {/* ------------ Left: the file ------------ */}
      <aside className="file">
        <div className="kicker">{running ? "Subject under research" : report ? "Report filed" : "Run ended"}</div>
        <h1 className="subject">{target}</h1>

        <dl className="meta">
          <div><dt>Elapsed</dt><dd>{elapsed}</dd></div>
          <div><dt>Searches</dt><dd>{searches}</dd></div>
          <div><dt>Pages read</dt><dd>{reads}</dd></div>
          <div><dt>Est. cost</dt><dd>${usage ? estimateCost(usage).toFixed(2) : "0.00"}</dd></div>
        </dl>

        <div className="section-label">Plan</div>
        {plan.length === 0 ? (
          <p className="dim">{running ? "Drafting a plan…" : "No plan was made."}</p>
        ) : (
          <ol className="plan">
            {plan.map((s, i) => (
              <li key={i} className={s.status}>
                <span className="box">{s.status === "done" ? "×" : s.status === "in_progress" ? "→" : s.status === "skipped" ? "–" : ""}</span>
                <span>
                  {s.title}
                  {s.note && <em className="plan-note">{s.note}</em>}
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="file-actions">
          {running ? (
            <button className="link danger" onClick={agent.stop}>Stop the agent</button>
          ) : (
            <button className="link" onClick={agent.reset}>← New request</button>
          )}
        </div>
      </aside>

      {/* ------------ Right: log, ledger, report ------------ */}
      <div className="desk">
        {error && <div className="notice">{error}</div>}

        <section>
          <div className="section-head">
            <div className="section-label">Live board</div>
            <div className="count">{running ? "watching the agent" : "final state"}</div>
          </div>
          <AgentBoard
            target={target}
            activity={activity}
            competitors={competitors}
            running={running}
            done={!!report}
            thinking={thinking}
            status={status}
          />
        </section>

        <section>
          <div className="section-head">
            <div className="section-label">Log</div>
            <div className="count">{activity.length} entries</div>
          </div>
          <div className="log">
            {log.length === 0 && !running && <div className="log-line dim">Nothing was logged.</div>}
            {log.map((a) => <LogLine key={a.uid} a={a} t0={t0} />)}
            {running && (
              <div className="log-line live">
                <span className="t">{elapsed}</span>
                <span className="k">····</span>
                <span className="v">
                  {thinking ? <span className="thinking">{thinking.slice(-160)}</span> : status || "Working"}
                  <span className="cursor" />
                </span>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-head">
            <div className="section-label">Competitors</div>
            <div className="count">{competitors.length} profiled</div>
          </div>
          {competitors.length === 0 ? (
            <p className="dim">{running ? "Profiles are added here as the agent finishes each competitor." : "No competitors were profiled."}</p>
          ) : (
            <Ledger rows={competitors} />
          )}
        </section>

        {report && <ReportView report={report} competitors={competitors} target={target} />}
      </div>
    </div>
  );
}

function LogLine({ a, t0 }: { a: Activity; t0: number }) {
  const t = clock(a.at - t0);
  if (a.kind === "search") {
    return (
      <div className="log-line">
        <span className="t">{t}</span>
        <span className="k">SEARCH</span>
        <span className="v">
          “{a.query}”
          {a.error ? <span className="err"> — failed ({a.error})</span> : a.results && <span className="dim"> — {a.results.length} results</span>}
        </span>
      </div>
    );
  }
  if (a.kind === "fetch") {
    return (
      <div className="log-line">
        <span className="t">{t}</span>
        <span className="k">READ</span>
        <span className="v">
          {hostname(a.url)}
          {a.error ? <span className="err"> — couldn&apos;t open ({a.error})</span> : a.title && <span className="dim"> — {a.title}</span>}
          {!a.done && !a.error && <span className="dim"> …</span>}
        </span>
      </div>
    );
  }
  if (a.kind === "competitor") {
    return (
      <div className="log-line">
        <span className="t">{t}</span>
        <span className="k">FILED</span>
        <span className="v">Profile: <strong>{a.name}</strong></span>
      </div>
    );
  }
  return (
    <div className={`log-line review ${a.approved ? "ok" : "back"}`}>
      <span className="t">{t}</span>
      <span className="k">REVIEW</span>
      <span className="v">
        {a.approved ? "Approved." : `Sent back (round ${a.attempt}):`}
        {a.issues.map((x, i) => <span key={i} className="issue">— {x}</span>)}
      </span>
    </div>
  );
}

function Ledger({ rows }: { rows: Competitor[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <table className="ledger">
      <thead>
        <tr><th>#</th><th>Competitor</th><th>Pricing</th><th>Best for</th><th>Threat</th></tr>
      </thead>
      <tbody>
        {rows.map((c, i) => {
          const level = { low: 1, medium: 2, high: 3 }[c.threat_level];
          const isOpen = open === i;
          return (
            <Fragment key={c.name + i}>
              <tr className={`row ${isOpen ? "open" : ""}`} onClick={() => setOpen(isOpen ? null : i)}>
                <td className="mono dim">{String(i + 1).padStart(2, "0")}</td>
                <td>
                  <div className="c-name">{c.name}</div>
                  <div className="mono dim small">{hostname(c.website)}</div>
                </td>
                <td>{c.pricing}</td>
                <td>{c.target_customers}</td>
                <td>
                  <span className={`threat t${level}`} title={`${c.threat_level} threat`}>
                    {[1, 2, 3].map((n) => <i key={n} className={n <= level ? "on" : ""} />)}
                  </span>
                </td>
              </tr>
              {isOpen && (
                <tr className="detail">
                  <td />
                  <td colSpan={4}>
                    <p className="c-line">{c.one_liner}</p>
                    <div className="sw">
                      <div><div className="section-label">Strengths</div><ul>{c.strengths.map((s, j) => <li key={j}>{s}</li>)}</ul></div>
                      <div><div className="section-label">Weaknesses</div><ul>{c.weaknesses.map((s, j) => <li key={j}>{s}</li>)}</ul></div>
                    </div>
                    {c.sources.length > 0 && (
                      <div className="sources mono small">
                        {c.sources.slice(0, 6).map((s) => (
                          <a key={s} href={s} target="_blank" rel="noreferrer">{hostname(s)}</a>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
