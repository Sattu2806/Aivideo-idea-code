"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Competitor } from "@/lib/events";
import type { Activity } from "./useAgent";

// ---------------------------------------------------------------------------
// The live board, drawn as a "constellation":
//  - every page the agent reads flies onto an outer ring
//  - the agent is a comet that swoops to whatever it is working on
//  - when a competitor is filed, its sources glide in and cluster around it
//  - a radar sweep turns while the agent is thinking
// Positions are animated in JS (one requestAnimationFrame loop) so that lines
// follow the nodes smoothly as the layout reorganises.
// ---------------------------------------------------------------------------

const W = 1000;
const H = 480;
const OUTER = { rx: 365, ry: 176 };
const INNER = { rx: 238, ry: 112 };
const CLUSTER = { rx: 345, ry: 170 };

type Vec = { x: number; y: number };
const ell = (a: number, r: { rx: number; ry: number }): Vec => ({ x: Math.cos(a) * r.rx, y: Math.sin(a) * r.ry });
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const backOut = (p: number) => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};

function host(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface Props {
  target: string;
  activity: Activity[];
  competitors: Competitor[];
  running: boolean;
  done: boolean;
  thinking: string;
  status: string;
}

interface Layout {
  sources: { id: string; host: string; failed: boolean; owner: string | null; target: Vec; spawn: Vec }[];
  comps: { id: string; name: string; threat: Competitor["threat_level"]; target: Vec }[];
  focus: string | null; // node id the agent is heading to ("center" for the subject)
  verb: string;
  caption: string;
  searches: Activity[];
  review: Extract<Activity, { kind: "review" }> | undefined;
  lastEventUid: number;
}

function computeLayout(p: Props): Layout {
  const log = [...p.activity].reverse(); // oldest first

  // Sources in first-read order.
  const order: { host: string; failed: boolean }[] = [];
  const seen = new Map<string, { host: string; failed: boolean }>();
  for (const a of log) {
    if (a.kind !== "fetch" || !a.url) continue;
    const h = host(a.url);
    const prev = seen.get(h);
    if (!prev) {
      const s = { host: h, failed: !!a.error };
      seen.set(h, s);
      order.push(s);
    } else if (!a.error) prev.failed = false;
  }

  // Competitors on the inner ring, evenly spaced.
  const n = Math.max(p.competitors.length, 3);
  const comps = p.competitors.map((c, k) => {
    const angle = -Math.PI / 2 + 0.55 + (k / n) * Math.PI * 2;
    return { id: `c:${c.name}`, name: c.name, threat: c.threat_level, angle, target: ell(angle, INNER), hosts: c.sources.map(host) };
  });

  // Each source belongs to the first competitor that cites it.
  const owner = new Map<string, (typeof comps)[number]>();
  for (const c of comps) for (const h of c.hosts) if (seen.has(h) && !owner.has(h)) owner.set(h, c);

  // Owned sources fan out behind their competitor; unowned ones take the free
  // spots on the outer ring, away from those clusters (an inner ring if full).
  const angleOf = new Map<string, number>();
  for (const c of comps) {
    const members = order.filter((x) => owner.get(x.host) === c);
    members.forEach((m, j) => angleOf.set(m.host, c.angle + (j - (members.length - 1) / 2) * 0.3));
  }
  const taken = [...angleOf.values(), ...comps.map((c) => c.angle)];
  const wrap = (d: number) => Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  const loose = order.filter((s) => !owner.has(s.host));
  const SLOTS = 18;
  const free: { a: number; r: { rx: number; ry: number } }[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const a = -Math.PI / 2 + 0.2 + (i / SLOTS) * Math.PI * 2;
    if (taken.every((t) => wrap(a - t) > 0.36)) free.push({ a, r: OUTER });
  }
  // Fill alternately around the ring so early sources are spread out.
  const spread = free.filter((_, i) => i % 2 === 0).concat(free.filter((_, i) => i % 2 === 1));
  for (let i = 0; spread.length < loose.length; i++) {
    spread.push({ a: -Math.PI / 2 + ((i + 0.5) / SLOTS) * Math.PI * 2, r: { rx: OUTER.rx * 0.8, ry: OUTER.ry * 0.8 } });
  }
  const sources = order.map((s) => {
    const o = owner.get(s.host);
    const target = o ? ell(angleOf.get(s.host)!, CLUSTER) : ell(spread[loose.indexOf(s)].a, spread[loose.indexOf(s)].r);
    const spawn = { x: target.x * 1.5, y: target.y * 1.5 };
    return { id: `s:${s.host}`, host: s.host, failed: s.failed, owner: o?.id ?? null, target, spawn };
  });

  // What the agent is doing right now.
  const last = log[log.length - 1];
  let focus: string | null = p.running ? "center" : null;
  let verb = p.running ? "THINKING" : p.done ? "FILED" : "IDLE";
  let caption = p.running ? p.status || "Planning the research" : p.done ? "Report approved and filed" : "Stopped";
  if (p.running && last) {
    if (last.kind === "fetch") {
      focus = `s:${host(last.url)}`;
      verb = last.done ? "READ" : "READING";
      caption = last.title ? `${host(last.url)} — ${last.title}` : host(last.url);
    } else if (last.kind === "search") {
      verb = "SEARCHING";
      caption = `“${last.query}”`;
    } else if (last.kind === "competitor") {
      focus = `c:${last.name}`;
      verb = "FILING";
      caption = `Profile of ${last.name}`;
    } else if (last.kind === "review") {
      verb = "REVIEW";
      caption = last.approved ? "Reviewer approved the report" : "Reviewer sent it back — fixing it";
    }
  }
  if (p.running && p.thinking) {
    verb = "THINKING";
    caption = p.thinking.slice(-120);
  }

  return {
    sources,
    comps: comps.map(({ id, name, threat, target }) => ({ id, name, threat, target })),
    focus,
    verb,
    caption,
    searches: log.filter((a) => a.kind === "search"),
    review: [...log].reverse().find((a): a is Extract<Activity, { kind: "review" }> => a.kind === "review"),
    lastEventUid: last?.uid ?? 0,
  };
}

// ---------------------------------------------------------------------------

interface NodeState {
  pos: Vec;
  born: number;
}

export function AgentBoard(props: Props) {
  const layout = useMemo(() => computeLayout(props), [props]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const nodes = useRef(new Map<string, NodeState>());
  const agent = useRef({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, trail: [] as Vec[], focus: "center" as string | null, alpha: 0 });
  const captionStart = useRef({ text: "", at: 0 });
  const lastEventAt = useRef(0);
  const doneAt = useRef<number | null>(null);
  const lastEventUid = useRef(0);
  const [t, setT] = useState(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      step(now, dt);
      setT(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function targetOf(id: string | null): Vec {
    if (!id || id === "center") return { x: 0, y: 0 };
    const L = layoutRef.current;
    const n = nodes.current.get(id);
    if (n) return n.pos;
    return L.sources.find((s) => s.id === id)?.target ?? L.comps.find((c) => c.id === id)?.target ?? { x: 0, y: 0 };
  }

  function step(now: number, dt: number) {
    const L = layoutRef.current;
    const map = nodes.current;
    const snap = reduced.current;
    const k = 1 - Math.exp(-dt * 4.2); // smoothing toward targets

    // Spawn new nodes, move all nodes toward their targets.
    const alive = new Set<string>();
    for (const s of L.sources) {
      alive.add(s.id);
      let n = map.get(s.id);
      if (!n) map.set(s.id, (n = { pos: snap ? { ...s.target } : { ...s.spawn }, born: now }));
      n.pos.x += (s.target.x - n.pos.x) * (snap ? 1 : k);
      n.pos.y += (s.target.y - n.pos.y) * (snap ? 1 : k);
    }
    for (const c of L.comps) {
      alive.add(c.id);
      let n = map.get(c.id);
      if (!n) map.set(c.id, (n = { pos: snap ? { ...c.target } : { x: 0, y: 0 }, born: now }));
      n.pos.x += (c.target.x - n.pos.x) * (snap ? 1 : k);
      n.pos.y += (c.target.y - n.pos.y) * (snap ? 1 : k);
    }
    for (const id of [...map.keys()]) if (!alive.has(id)) map.delete(id);

    // Agent: a slightly under-damped spring; a sideways kick on each new target gives curved swoops.
    const a = agent.current;
    if (a.focus !== L.focus) {
      const to = targetOf(L.focus);
      const dx = to.x - a.pos.x;
      const dy = to.y - a.pos.y;
      a.vel.x += -dy * 1.1;
      a.vel.y += dx * 0.55;
      a.focus = L.focus;
    }
    const goal = targetOf(a.focus);
    if (snap) {
      a.pos = { ...goal };
      a.vel = { x: 0, y: 0 };
    } else {
      const stiff = 26;
      const damp = 2 * Math.sqrt(stiff) * 0.72;
      a.vel.x += ((goal.x - a.pos.x) * stiff - a.vel.x * damp) * dt;
      a.vel.y += ((goal.y - a.pos.y) * stiff - a.vel.y * damp) * dt;
      a.pos.x += a.vel.x * dt;
      a.pos.y += a.vel.y * dt;
    }
    a.trail.push({ ...a.pos });
    if (a.trail.length > 22) a.trail.shift();
    a.alpha += ((L.focus ? 1 : 0) - a.alpha) * (1 - Math.exp(-dt * 5));

    // Timers for caption typing, radar and the finale.
    if (captionStart.current.text !== L.caption) captionStart.current = { text: L.caption, at: now };
    if (L.lastEventUid !== lastEventUid.current) {
      lastEventUid.current = L.lastEventUid;
      lastEventAt.current = now;
    }
    const finished = !!L.review?.approved && !L.focus;
    if (finished && doneAt.current === null) doneAt.current = now;
    if (!finished) doneAt.current = null;
  }

  // ------------------------------------------------------------------ render
  const L = layout;
  const map = nodes.current;
  const drift = (id: string, base: Vec): Vec => {
    if (reduced.current) return base;
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
    return { x: base.x + Math.sin(t / 1500 + h) * 2.6, y: base.y + Math.cos(t / 1800 + h * 1.3) * 2.2 };
  };
  const posOf = (id: string) => drift(id, map.get(id)?.pos ?? { x: 0, y: 0 });
  const grow = (id: string, ms = 650) => (reduced.current ? 1 : easeOut(clamp01((t - (map.get(id)?.born ?? t)) / ms)));
  const pop = (id: string) => (reduced.current ? 1 : backOut(clamp01((t - (map.get(id)?.born ?? t)) / 480)));

  const typed = reduced.current ? L.caption : L.caption.slice(0, Math.floor((t - captionStart.current.at) / 18));
  const idleFor = t - lastEventAt.current;
  const sweeping = props.running && !reduced.current;
  const sweepAngle = (t / 2600) * Math.PI * 2;
  const sweepAlpha = sweeping ? clamp01((idleFor - 600) / 800) : 0;
  const finale = doneAt.current !== null ? (reduced.current ? 1 : easeOut(clamp01((t - doneAt.current) / 1400))) : 0;
  const a = agent.current;
  const lastSearch = L.searches[L.searches.length - 1];
  const filedCount = L.comps.length;

  const line = (from: Vec, to: Vec, p: number) => ({ x1: from.x, y1: from.y, x2: from.x + (to.x - from.x) * p, y2: from.y + (to.y - from.y) * p });
  const subject = { x: 0, y: 0 };

  return (
    <div className={`board ${props.running ? "is-live" : ""} ${finale > 0 ? "is-filed" : ""}`}>
      <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} role="img" aria-label="Live map of what the agent is researching">
        <defs>
          <radialGradient id="bd-glow">
            <stop offset="0" stopColor="#ff4f00" stopOpacity="0.16" />
            <stop offset="1" stopColor="#ff4f00" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse rx={260} ry={150} fill="url(#bd-glow)" />
        <ellipse rx={OUTER.rx} ry={OUTER.ry} className="orbit" />
        <ellipse rx={INNER.rx} ry={INNER.ry} className="orbit" />

        {/* radar sweep while the agent thinks */}
        {sweepAlpha > 0 &&
          [0, 1, 2, 3, 4, 5].map((i) => {
            const ang = sweepAngle - i * 0.07;
            const end = ell(ang, OUTER);
            return <line key={i} x1={0} y1={0} x2={end.x} y2={end.y} className="sweep" style={{ opacity: sweepAlpha * (0.32 - i * 0.05) }} />;
          })}

        {/* search ripples */}
        {L.searches.slice(-5).map((s) => (
          <ellipse key={s.uid} rx={70} ry={34} className="ripple" />
        ))}

        {/* edges */}
        {L.sources.map((s) => {
          const p = grow(s.id, 700);
          if (s.owner) {
            const c = posOf(s.owner);
            return <line key={`e-${s.id}`} {...line(c, posOf(s.id), p)} className="edge owned" />;
          }
          return <line key={`e-${s.id}`} {...line(subject, posOf(s.id), p)} className={`edge ${s.failed ? "failed" : ""}`} />;
        })}
        {L.comps.map((c) => (
          <line key={`e-${c.id}`} {...line(subject, posOf(c.id), grow(c.id, 800))} className="edge comp-edge" />
        ))}

        {/* finale ring */}
        {finale > 0 && (
          <ellipse
            rx={OUTER.rx + 24}
            ry={OUTER.ry + 18}
            className="finale"
            pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: 1 - finale }}
          />
        )}

        {/* source nodes */}
        {L.sources.map((s) => {
          const p = posOf(s.id);
          const sc = pop(s.id);
          const right = p.x >= 0;
          const active = L.focus === s.id;
          return (
            <g key={s.id} transform={`translate(${p.x} ${p.y}) scale(${sc})`} className={`src ${s.failed ? "failed" : ""} ${active ? "active" : ""} ${s.owner ? "owned" : ""}`}>
              {active && <circle r={13} className="src-halo" />}
              <rect x={-5.5} y={-5.5} width={11} height={11} transform="rotate(45)" />
              {s.failed && <path d="M-6 -6 L6 6 M6 -6 L-6 6" />}
              <text x={right ? 13 : -13} y={4.5} textAnchor={right ? "start" : "end"}>{clip(s.host, 22)}</text>
            </g>
          );
        })}

        {/* competitor nodes */}
        {L.comps.map((c) => {
          const p = posOf(c.id);
          const sc = pop(c.id);
          // Label on the side facing the centre; its sources fan out on the far side.
          const side = Math.abs(p.x) < 70 ? 0 : p.x > 0 ? -1 : 1;
          const lx = side * 30;
          const ly = side === 0 ? (p.y > 0 ? 44 : -32) : 9;
          return (
            <g key={c.id} transform={`translate(${p.x} ${p.y}) scale(${sc})`} className={`comp t-${c.threat}`}>
              <circle r={20} className="comp-ring" />
              <circle r={10} className="comp-core" />
              <text x={lx} y={ly} textAnchor={side === 0 ? "middle" : side < 0 ? "end" : "start"}>{clip(c.name, 18)}</text>
            </g>
          );
        })}

        {/* subject */}
        <g className="subject-node">
          <circle r={30} className="halo" />
          <circle r={5.5} className="core" />
          <text y={58} textAnchor="middle" className="subject-label">{clip(props.target, 26)}</text>
          {lastSearch && props.running && lastSearch.kind === "search" && L.verb === "SEARCHING" && (
            <text key={lastSearch.uid} y={-46} textAnchor="middle" className="query">
              {clip(`“${lastSearch.query}”`, 46)}
            </text>
          )}
        </g>

        {/* the agent: comet with a tail */}
        {a.alpha > 0.02 && (
          <g style={{ opacity: a.alpha }}>
            {a.trail.map((pt, i) => {
              if (i === 0) return null;
              const prev = a.trail[i - 1];
              const f = i / a.trail.length;
              return <line key={i} x1={prev.x} y1={prev.y} x2={pt.x} y2={pt.y} className="trail" style={{ strokeWidth: 1 + f * 6, opacity: f * 0.55 }} />;
            })}
            <g transform={`translate(${a.pos.x} ${a.pos.y})`}>
              <circle r={15} className="agent-ring" />
              <circle r={6} className="agent-dot" />
            </g>
          </g>
        )}
      </svg>

      {L.review && (
        <div key={L.review.uid} className={`stamp ${L.review.approved ? "ok" : "back"}`}>
          {L.review.approved ? "Approved" : "Sent back"}
          <small>Reviewer · round {L.review.attempt}</small>
        </div>
      )}

      <div className="board-legend">
        <span><i className="lg-src" /> Source</span>
        <span><i className="lg-comp" /> Competitor</span>
        <span><i className="lg-agent" /> Agent</span>
      </div>

      <div className="board-caption">
        <span className="verb">{L.verb}</span>
        <span className="caption-text">
          {typed}
          {props.running && <span className="cursor" />}
        </span>
        <span className="counters">
          <span><b>{String(L.searches.length).padStart(2, "0")}</b> searches</span>
          <span><b>{String(L.sources.length).padStart(2, "0")}</b> sources</span>
          <span><b>{String(filedCount).padStart(2, "0")}</b> filed</span>
        </span>
      </div>
    </div>
  );
}
