"use client";

import { Fragment, useEffect, useState } from "react";
import type { Competitor } from "@/lib/events";
import { AgentBoard } from "./AgentBoard";
import { ReportView } from "./ReportView";
import { formatCost, MODE_LABEL, type Activity, type useAgent } from "./useAgent";

type Agent = ReturnType<typeof useAgent>;

export function hostname(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const running_ = (phase: string) => phase === "running";

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
  const { phase, target, mode, status, plan, activity, thinking, competitors, report, usage, error, startedAt, finishedAt, provider, isFollowUp } = agent;
  const [question, setQuestion] = useState("");
  const fromFiles = !running_(phase) && activity.length === 0 && plan.length === 0 && !!report;
  const running = phase === "running";
  const now = useNow(running);
  const t0 = startedAt ?? now;
  const elapsed = clock((finishedAt ?? now) - t0);
  const searches = activity.filter((a) => a.kind === "search").length;
  const reads = activity.filter((a) => a.kind === "fetch").length;
  const log = [...activity].reverse(); // oldest first, like a real log
  const team = agent.team;
  const who = (id: string) => (id === "lead" ? "Lead" : team.find((m) => m.id === id)?.name ?? id);

  return (
    <div className="ws">
      {/* ------------ Left: the file ------------ */}
      <aside className="file">
        <div className="kicker">
          {running ? (agent.watchId ? "Re-checking" : isFollowUp ? "Digging deeper" : "Under research") : fromFiles ? "From your files" : report ? "Report filed" : "Run ended"} ·{" "}
          {MODE_LABEL[mode]}
        </div>
        <h1 className="subject">{target}</h1>

        {fromFiles ? (
          <dl className="meta">
            <div><dt>Companies</dt><dd>{competitors.length}</dd></div>
          </dl>
        ) : (
          <dl className="meta">
            <div><dt>Elapsed</dt><dd>{elapsed}</dd></div>
            <div><dt>Searches</dt><dd>{searches}</dd></div>
            <div><dt>Pages read</dt><dd>{reads}</dd></div>
            <div><dt>Est. cost</dt><dd>{formatCost(usage, provider)}</dd></div>
            {provider && <div><dt>Model</dt><dd className="model">{provider.model}</dd></div>}
          </dl>
        )}

        <div className="section-label">Plan</div>
        {plan.length === 0 ? (
          <p className="dim">{running ? "Drafting a plan…" : fromFiles ? "Saved report — the research log isn't kept." : "No plan was made."}</p>
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

        {team.length > 0 && (
          <>
            <div className="section-label team-label">Team</div>
            <ul className="team">
              <li className="lead"><span className="dot" /> Lead analyst <em>plans · writes · checks</em></li>
              {team.map((m) => (
                <li key={m.id} className={m.status}>
                  <span className="dot" /> {m.name}
                  <em>{m.status === "working" ? "researching…" : m.status === "done" ? "profile filed" : "couldn't finish"}</em>
                </li>
              ))}
            </ul>
          </>
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

        {!fromFiles && (
        <>
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
            team={team}
          />
        </section>

        <section>
          <div className="section-head">
            <div className="section-label">Log</div>
            <div className="count">{activity.length} entries</div>
          </div>
          <div className="log">
            {log.length === 0 && !running && <div className="log-line dim">Nothing was logged.</div>}
            {log.map((a) => <LogLine key={a.uid} a={a} t0={t0} who={who} />)}
            {running && (
              <div className="log-line live" key="live">
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
        </>
        )}

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

        {report && (
          <ReportView
            report={report}
            competitors={competitors}
            target={target}
            citations={agent.citations}
            changes={agent.changes}
            watching={(() => {
              const w = agent.watches.find((x) => x.id === agent.watchId) ?? agent.watches.find((x) => x.company === target && x.mode === mode);
              return w ? { nextRunAt: w.nextRunAt } : null;
            })()}
            onWatch={agent.watchCurrent}
            onUnwatch={() => {
              const w = agent.watches.find((x) => x.id === agent.watchId) ?? agent.watches.find((x) => x.company === target && x.mode === mode);
              if (w) agent.unwatch(w.id);
            }}
          />
        )}
        {report && !running && (
          <section className="deeper">
            <div className="section-head">
              <div className="section-label">Dig deeper</div>
              <div className="count">the agent continues from this report</div>
            </div>
            <form
              className="ask-more"
              onSubmit={(e) => {
                e.preventDefault();
                if (question.trim()) {
                  agent.followUp(question.trim());
                  setQuestion("");
                }
              }}
            >
              <label className="field small">
                <span className="field-label">Ask</span>
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. add Monday.com · verify Jira's enterprise pricing · find their latest funding"
                  aria-label="Follow-up request for the agent"
                />
              </label>
              <button type="submit" className="run small" disabled={!question.trim()}>
                <span>Send agent</span>
                <span className="run-arrow">→</span>
              </button>
            </form>
            <div className="examples">
              <span>Try</span>
              {["Add two more competitors", "Double-check every price", "Write a cold email for each competitor's unhappy customers"].map((q) => (
                <button key={q} type="button" onClick={() => setQuestion(q)}>{q}</button>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

function LogLine({ a, t0, who }: { a: Activity; t0: number; who: (agent: string) => string }) {
  const t = clock(a.at - t0);
  const tag = <span className={`who ${a.agent === "lead" ? "lead" : ""}`}>{who(a.agent)}</span>;
  if (a.kind === "search") {
    return (
      <div className="log-line">
        <span className="t">{t}</span>
        <span className="k">SEARCH</span>
        <span className="v">
          {tag}“{a.query}”
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
          {tag}
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
        <span className="v">{tag}Profile: <strong>{a.name}</strong></span>
      </div>
    );
  }
  if (a.kind === "cite") {
    const label = a.verdict === "supported" ? "✓ supported" : a.verdict === "unsupported" ? "✗ not supported" : a.verdict === "unreachable" ? "couldn't open" : "checking…";
    return (
      <div className={`log-line cite ${a.verdict ?? "pending"}`}>
        <span className="t">{t}</span>
        <span className="k">VERIFY</span>
        <span className="v">
          {hostname(a.url)} <span className="verdict">{label}</span>
          <span className="issue">“{a.claim.slice(0, 140)}”{a.note && a.verdict === "unsupported" ? ` — ${a.note}` : ""}</span>
        </span>
      </div>
    );
  }
  return (
    <div className={`log-line review ${a.approved ? "ok" : "back"}`}>
      <span className="t">{t}</span>
      <span className="k">REVIEW</span>
      <span className="v">
        {a.approved ? "Approved." : `Sent back (round ${a.attempt}):`}
        {a.citations && (
          <span className="dim"> {a.citations.supported}/{a.citations.checked} citations verified</span>
        )}
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
