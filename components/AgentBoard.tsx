"use client";

import { useMemo } from "react";
import type { Competitor } from "@/lib/events";
import type { Activity } from "./useAgent";

// A live "investigation board": the subject sits in the middle, every page the
// agent reads pins a source to the board, filed competitors form an inner ring
// linked to their sources, and a dot (the agent) travels to whatever it is
// working on. Everything is plain SVG + CSS animations.

const W = 1000;
const H = 460;
const GOLDEN = 2.39996; // golden angle in radians: spreads nodes evenly without overlap

function host(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

type Pt = { x: number; y: number };

function sourcePos(i: number): Pt {
  const a = i * GOLDEN - Math.PI / 2;
  const ring = 0.62 + (i % 3) * 0.17; // three staggered rings
  return { x: Math.cos(a) * 360 * ring, y: Math.sin(a) * 185 * ring };
}

function competitorPos(k: number, n: number): Pt {
  const total = Math.max(n, 3);
  const a = (k / total) * Math.PI * 2 - Math.PI / 2 + 0.5;
  return { x: Math.cos(a) * 230, y: Math.sin(a) * 96 };
}

interface Props {
  target: string;
  activity: Activity[];
  competitors: Competitor[];
  running: boolean;
  done: boolean;
  thinking: string;
  status: string;
}

export function AgentBoard({ target, activity, competitors, running, done, thinking, status }: Props) {
  const log = useMemo(() => [...activity].reverse(), [activity]); // oldest first

  // Source nodes: one per website, in the order the agent first read it.
  const sources = useMemo(() => {
    const map = new Map<string, { host: string; pos: Pt; failed: boolean; uid: number }>();
    for (const a of log) {
      if (a.kind !== "fetch" || !a.url) continue;
      const h = host(a.url);
      if (!map.has(h)) map.set(h, { host: h, pos: sourcePos(map.size), failed: !!a.error, uid: a.uid });
      else if (!a.error) map.get(h)!.failed = false;
    }
    return map;
  }, [log]);

  const comps = competitors.map((c, k) => ({
    c,
    pos: competitorPos(k, competitors.length),
    links: c.sources.map(host).filter((h) => sources.has(h)),
  }));

  // Where the agent is right now, and what it is doing.
  const last = log[log.length - 1];
  let cursor: Pt = { x: 0, y: 0 };
  let caption = running ? status || "Starting" : done ? "Report filed" : "Stopped";
  let verb = running ? "THINKING" : done ? "DONE" : "IDLE";
  if (running && last) {
    if (last.kind === "fetch") {
      cursor = sources.get(host(last.url))?.pos ?? cursor;
      verb = last.done ? "READ" : "READING";
      caption = last.title ? `${host(last.url)} — ${last.title}` : host(last.url);
    } else if (last.kind === "search") {
      verb = "SEARCHING";
      caption = `“${last.query}”`;
    } else if (last.kind === "competitor") {
      const k = competitors.findIndex((c) => c.name === last.name);
      if (k >= 0) cursor = comps[k].pos;
      verb = "FILING";
      caption = `Profile of ${last.name}`;
    } else if (last.kind === "review") {
      verb = "REVIEW";
      caption = last.approved ? "Reviewer approved the report" : "Reviewer sent the report back — fixing it";
    }
    if (thinking && (last.kind === "competitor" || last.kind === "review" || (last.kind === "fetch" && last.done) || (last.kind === "search" && last.results))) {
      verb = "THINKING";
      caption = thinking.slice(-140);
    }
  }

  const lastSearch = [...log].reverse().find((a) => a.kind === "search");
  const searches = log.filter((a) => a.kind === "search");
  const lastReview = [...log].reverse().find((a) => a.kind === "review");

  return (
    <div className={`board ${running ? "is-live" : ""}`}>
      <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} role="img" aria-label="Live map of what the agent is researching">
        {/* faint orbit guides */}
        {[0.62, 0.79, 0.96].map((r) => (
          <ellipse key={r} rx={360 * r} ry={185 * r} className="orbit" />
        ))}

        {/* search ripples: one ring per search, expands once */}
        {searches.slice(-6).map((s) => (
          <ellipse key={s.uid} rx={60} ry={30} className="ripple" />
        ))}

        {/* lines from the subject to each source */}
        {[...sources.values()].map((s) => (
          <line key={`l-${s.uid}`} x1={0} y1={0} x2={s.pos.x} y2={s.pos.y} pathLength={1} className={`edge ${s.failed ? "failed" : ""}`} />
        ))}

        {/* lines from competitors to the sources they were built from */}
        {comps.flatMap(({ c, pos, links }) =>
          links.map((h) => {
            const p = sources.get(h)!.pos;
            return <line key={`cl-${c.name}-${h}`} x1={pos.x} y1={pos.y} x2={p.x} y2={p.y} pathLength={1} className="edge comp-edge" />;
          }),
        )}

        {/* source nodes */}
        {[...sources.values()].map((s) => (
          <g key={`n-${s.uid}`} transform={`translate(${s.pos.x} ${s.pos.y})`} >
            <g className={`src pop ${s.failed ? "failed" : ""}`}>
              <rect x={-6} y={-6} width={12} height={12} />
              {s.failed && <path d="M-6 -6 L6 6 M6 -6 L-6 6" />}
              <text x={s.pos.x >= 0 ? 12 : -12} y={4} textAnchor={s.pos.x >= 0 ? "start" : "end"}>{clip(s.host, 22)}</text>
            </g>
          </g>
        ))}

        {/* competitor nodes */}
        {comps.map(({ c, pos }) => (
          <g key={`c-${c.name}`} transform={`translate(${pos.x} ${pos.y})`} >
            <g className={`comp pop t-${c.threat_level}`}>
              <circle r={11} />
              <text y={pos.y > 0 ? 34 : -20} textAnchor="middle">{clip(c.name, 18)}</text>
            </g>
          </g>
        ))}

        {/* the subject */}
        <g className="subject-node">
          <circle r={34} className="halo" />
          <circle r={5} />
          <text y={66} textAnchor="middle" className="subject-label">{clip(target, 28)}</text>
          {lastSearch && running && (
            <text key={lastSearch.uid} y={92} textAnchor="middle" className="query">
              {clip(`“${lastSearch.query}”`, 48)}
            </text>
          )}
        </g>

        {/* the agent */}
        {running && (
          <g className="agent" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
            <circle r={14} className="agent-ring" />
            <circle r={5.5} className="agent-dot" />
          </g>
        )}
      </svg>

      {lastReview && (
        <div key={lastReview.uid} className={`stamp ${lastReview.approved ? "ok" : "back"}`}>
          {lastReview.approved ? "Approved" : "Sent back"}
          <small>Reviewer · round {lastReview.attempt}</small>
        </div>
      )}

      <div className="board-caption">
        <span className="verb">{verb}</span>
        <span key={caption} className="caption-text">{caption}</span>
        {running && <span className="cursor" />}
      </div>

      <div className="board-legend">
        <span><i className="lg-src" /> Source read</span>
        <span><i className="lg-comp" /> Competitor filed</span>
        <span><i className="lg-agent" /> Agent</span>
      </div>
    </div>
  );
}
