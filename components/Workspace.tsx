"use client";

import { useEffect, useState } from "react";
import type { Competitor, PlanStep } from "@/lib/events";
import { Back, Check, Doc, Search, Shield, Stop, Users } from "./Icons";
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

function useElapsed(start: number | null, end: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!start || end) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [start, end]);
  if (!start) return "0:00";
  const s = Math.max(0, Math.floor(((end ?? now) - start) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Workspace({ agent }: { agent: Agent }) {
  const { phase, target, status, plan, activity, thinking, competitors, report, usage, error, startedAt, finishedAt } = agent;
  const elapsed = useElapsed(startedAt, finishedAt);
  const running = phase === "running";
  const doneSteps = plan.filter((s) => s.status === "done" || s.status === "skipped").length;
  const progress = report ? 100 : plan.length ? Math.round((doneSteps / plan.length) * 92) + 4 : running ? 3 : 0;
  const searches = activity.filter((a) => a.kind === "search").length;
  const reads = activity.filter((a) => a.kind === "fetch").length;

  return (
    <div className="workspace">
      {/* ---------- Run header ---------- */}
      <div className="run-head">
        <div className="run-title">
          <button className="icon-btn" onClick={agent.reset} title="New research">
            <Back />
          </button>
          <div>
            <div className="run-kicker">
              {running ? (
                <><span className="live-dot" /> Researching</>
              ) : report ? (
                <><Check width={14} height={14} /> Report ready</>
              ) : (
                "Run ended"
              )}
            </div>
            <h1>{target}</h1>
          </div>
        </div>
        <div className="run-stats">
          <Stat label="Elapsed" value={elapsed} />
          <Stat label="Searches" value={String(searches)} />
          <Stat label="Pages read" value={String(reads)} />
          <Stat label="Est. cost" value={usage ? `$${estimateCost(usage).toFixed(2)}` : "$0.00"} />
          {running && (
            <button className="btn-stop" onClick={agent.stop}>
              <Stop width={14} height={14} /> Stop
            </button>
          )}
        </div>
      </div>
      <div className="progress"><div style={{ width: `${progress}%` }} /></div>

      {error && <div className="alert">{error}</div>}

      {/* ---------- Main grid ---------- */}
      <div className="ws-grid">
        <aside className="glass plan-card">
          <div className="card-title">Research plan</div>
          {plan.length === 0 ? (
            <div className="skeleton-list">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div>
          ) : (
            <ol className="timeline">
              {plan.map((s, i) => <PlanItem key={i} step={s} />)}
            </ol>
          )}

          {running && (
            <div className="now">
              <div className="now-label"><span className="spinner" /> {status || "Working…"}</div>
              {thinking && <div className="now-thinking">{thinking}</div>}
            </div>
          )}
        </aside>

        <section className="glass feed-card">
          <div className="card-title">
            Live activity <span className="count-pill">{activity.length}</span>
          </div>
          {activity.length === 0 ? (
            <div className="empty">
              <div className="orb" />
              <p>The agent is getting started. Every search and page it reads will appear here.</p>
            </div>
          ) : (
            <ul className="feed">
              {activity.map((a) => <FeedItem key={a.uid} a={a} />)}
            </ul>
          )}
        </section>
      </div>

      {/* ---------- Competitors ---------- */}
      <section className="block">
        <div className="block-head">
          <h2>Competitors</h2>
          <span className="muted">{competitors.length ? `${competitors.length} profiled` : "Profiles appear as each one is finished"}</span>
        </div>
        <div className="comp-grid">
          {competitors.map((c, i) => <CompetitorCard key={i} c={c} />)}
          {running && competitors.length < 3 &&
            Array.from({ length: 3 - competitors.length }).map((_, i) => (
              <div key={`ph${i}`} className="comp-card placeholder">
                <Users />
                <span>Researching…</span>
              </div>
            ))}
        </div>
      </section>

      {report && <ReportView report={report} competitors={competitors} target={target} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlanItem({ step }: { step: PlanStep }) {
  return (
    <li className={`tl-item ${step.status}`}>
      <span className="tl-marker">{step.status === "done" ? <Check width={12} height={12} /> : null}</span>
      <div>
        <div className="tl-title">{step.title}</div>
        {step.note && <div className="tl-note">{step.note}</div>}
      </div>
    </li>
  );
}

function FeedItem({ a }: { a: Activity }) {
  if (a.kind === "search") {
    return (
      <li className="feed-item">
        <span className="fi-icon search"><Search width={15} height={15} /></span>
        <div className="fi-body">
          <div className="fi-kicker">Searched the web</div>
          <div className="fi-main">{a.query}</div>
          {a.error ? (
            <div className="fi-sub bad">Search failed ({a.error})</div>
          ) : a.results ? (
            <div className="favicons">
              {a.results.slice(0, 5).map((r) => (
                <span key={r.url} className="fav">{hostname(r.url)}</span>
              ))}
              {a.results.length > 5 && <span className="fav more">+{a.results.length - 5}</span>}
            </div>
          ) : (
            <div className="fi-sub shimmer-text">Searching…</div>
          )}
        </div>
      </li>
    );
  }
  if (a.kind === "fetch") {
    return (
      <li className="feed-item">
        <span className="fi-icon read"><Doc width={15} height={15} /></span>
        <div className="fi-body">
          <div className="fi-kicker">{a.done ? "Read page" : "Reading page"}</div>
          <div className="fi-main">{a.title || hostname(a.url)}</div>
          <div className={`fi-sub ${a.error ? "bad" : ""}`}>{a.error ? `Couldn't open (${a.error})` : hostname(a.url)}</div>
        </div>
      </li>
    );
  }
  if (a.kind === "competitor") {
    return (
      <li className="feed-item">
        <span className="fi-icon comp"><Users width={15} height={15} /></span>
        <div className="fi-body">
          <div className="fi-kicker">Profile saved</div>
          <div className="fi-main">{a.name}</div>
        </div>
      </li>
    );
  }
  return (
    <li className={`feed-item review ${a.approved ? "ok" : "back"}`}>
      <span className="fi-icon rev"><Shield width={15} height={15} /></span>
      <div className="fi-body">
        <div className="fi-kicker">Reviewer · round {a.attempt}</div>
        <div className="fi-main">{a.approved ? "Report approved" : "Sent back for fixes"}</div>
        {a.issues.length > 0 && (
          <ul className="fi-issues">{a.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
        )}
      </div>
    </li>
  );
}

function CompetitorCard({ c }: { c: Competitor }) {
  const level = { low: 1, medium: 2, high: 3 }[c.threat_level];
  return (
    <article className="comp-card">
      <div className="comp-head">
        <div className="comp-avatar">{c.name.slice(0, 1)}</div>
        <div className="comp-name">
          <h3>{c.name}</h3>
          <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">
            {hostname(c.website)}
          </a>
        </div>
        <div className={`meter ${c.threat_level}`} title={`${c.threat_level} threat`}>
          {[1, 2, 3].map((n) => <span key={n} className={n <= level ? "on" : ""} />)}
          <em>{c.threat_level}</em>
        </div>
      </div>
      <p className="comp-line">{c.one_liner}</p>
      <div className="comp-facts">
        <div><span>Pricing</span><p>{c.pricing}</p></div>
        <div><span>Best for</span><p>{c.target_customers}</p></div>
      </div>
      <div className="comp-pc">
        <div>
          <span className="pc-h good">Strengths</span>
          <ul>{c.strengths.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
        <div>
          <span className="pc-h bad">Weaknesses</span>
          <ul>{c.weaknesses.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      </div>
      <div className="comp-foot">{c.sources.length} sources</div>
    </article>
  );
}
