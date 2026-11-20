"use client";

import { useEffect, useState } from "react";
import type { CitationStats, CiteVerdict, Competitor, TeamMember } from "@/lib/events";
import { AgentBoard } from "./AgentBoard";
import type { Activity } from "./useAgent";

// A scripted run that loops on the landing page, drawn with the same board as
// a real run. Purely illustrative: no requests are made.

const comp = (name: string, website: string, threat: Competitor["threat_level"], sources: string[]): Competitor => ({
  name, website, threat_level: threat, sources,
  one_liner: "", target_customers: "", pricing: "", key_features: [], strengths: [], weaknesses: [],
});

type Step = { ms: number } & (
  | { kind: "think"; text: string }
  | { kind: "search"; agent: string; query: string }
  | { kind: "fetch"; agent: string; url: string; title: string }
  | { kind: "team"; members: { id: string; name: string }[] }
  | { kind: "member"; id: string }
  | { kind: "competitor"; agent: string; c: Competitor }
  | { kind: "cite"; id: string; url: string; claim: string }
  | { kind: "verdict"; id: string; verdict: CiteVerdict }
  | { kind: "review"; approved: boolean; attempt: number; citations: CitationStats }
);

const G2 = "https://www.g2.com/products/notion/competitors";
const CODA = "https://coda.io/pricing";
const CLICKUP = "https://clickup.com/pricing";
const CAPTERRA = "https://www.capterra.com/clickup/reviews";
const REDDIT = "https://www.reddit.com/r/Notion/coda";
const CONFLUENCE = "https://www.atlassian.com/software/confluence/pricing";
const TRUSTRADIUS = "https://www.trustradius.com/confluence/reviews";

const SCRIPT: Step[] = [
  { ms: 1700, kind: "think", text: "Planning: find Notion's real rivals, then put a researcher on each one." },
  { ms: 1200, kind: "search", agent: "lead", query: "notion alternatives for teams" },
  { ms: 1100, kind: "fetch", agent: "lead", url: G2, title: "Notion competitors" },
  { ms: 1700, kind: "think", text: "Three serious rivals: Coda, ClickUp, Confluence. Assigning a researcher to each." },
  { ms: 1000, kind: "team", members: [{ id: "r1", name: "Coda" }, { id: "r2", name: "ClickUp" }, { id: "r3", name: "Confluence" }] },
  { ms: 450, kind: "fetch", agent: "r1", url: CODA, title: "Coda pricing" },
  { ms: 450, kind: "fetch", agent: "r2", url: CLICKUP, title: "ClickUp pricing" },
  { ms: 800, kind: "fetch", agent: "r3", url: CONFLUENCE, title: "Confluence pricing" },
  { ms: 450, kind: "search", agent: "r1", query: "coda reviews reddit" },
  { ms: 450, kind: "fetch", agent: "r2", url: CAPTERRA, title: "ClickUp reviews" },
  { ms: 800, kind: "fetch", agent: "r3", url: TRUSTRADIUS, title: "Confluence reviews" },
  { ms: 800, kind: "fetch", agent: "r1", url: REDDIT, title: "Coda vs Notion" },
  { ms: 450, kind: "competitor", agent: "r2", c: comp("ClickUp", "clickup.com", "high", [CLICKUP, CAPTERRA]) },
  { ms: 550, kind: "member", id: "r2" },
  { ms: 450, kind: "competitor", agent: "r1", c: comp("Coda", "coda.io", "high", [CODA, REDDIT]) },
  { ms: 550, kind: "member", id: "r1" },
  { ms: 450, kind: "competitor", agent: "r3", c: comp("Confluence", "atlassian.com", "medium", [CONFLUENCE, TRUSTRADIUS, G2]) },
  { ms: 1300, kind: "member", id: "r3" },
  { ms: 1600, kind: "think", text: "Writing the report from the three profiles, then checking every citation." },
  { ms: 450, kind: "cite", id: "cite-1-0", url: CODA, claim: "Coda Pro costs $10 per doc maker a month" },
  { ms: 450, kind: "cite", id: "cite-1-1", url: CLICKUP, claim: "ClickUp Unlimited costs $5 per user a month" },
  { ms: 450, kind: "cite", id: "cite-1-2", url: CONFLUENCE, claim: "Confluence Standard is $6.05 per user" },
  { ms: 700, kind: "cite", id: "cite-1-3", url: CAPTERRA, claim: "Users say ClickUp feels cluttered" },
  { ms: 450, kind: "verdict", id: "cite-1-0", verdict: "supported" },
  { ms: 600, kind: "verdict", id: "cite-1-1", verdict: "unsupported" },
  { ms: 450, kind: "verdict", id: "cite-1-2", verdict: "supported" },
  { ms: 900, kind: "verdict", id: "cite-1-3", verdict: "supported" },
  { ms: 2300, kind: "review", approved: false, attempt: 1, citations: { checked: 4, supported: 3, unsupported: 1, unreachable: 0 } },
  { ms: 1500, kind: "think", text: "The ClickUp price was wrong: the page says $7, not $5. Correcting it." },
  { ms: 1100, kind: "fetch", agent: "lead", url: CLICKUP, title: "ClickUp pricing" },
  { ms: 500, kind: "cite", id: "cite-2-0", url: CLICKUP, claim: "ClickUp Unlimited costs $7 per user a month" },
  { ms: 800, kind: "verdict", id: "cite-2-0", verdict: "supported" },
  { ms: 1200, kind: "review", approved: true, attempt: 2, citations: { checked: 4, supported: 4, unsupported: 0, unreachable: 0 } },
];

const HOLD_MS = 5500;

export function DemoBoard() {
  const [loop, setLoop] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const finished = step >= SCRIPT.length;
    const wait = finished ? HOLD_MS : step === 0 ? 900 : SCRIPT[step - 1].ms;
    const t = setTimeout(() => {
      if (finished) {
        setStep(0);
        setLoop((l) => l + 1);
      } else setStep((s) => s + 1);
    }, wait);
    return () => clearTimeout(t);
  }, [step]);

  // Board state after the first `step` steps of the script.
  const base = loop * 1000; // fresh uids each loop so animations replay
  let activity: Activity[] = [];
  const competitors: Competitor[] = [];
  let team: TeamMember[] = [];
  let thinking = "";
  SCRIPT.slice(0, step).forEach((s, i) => {
    const uid = base + i + 1;
    thinking = s.kind === "think" ? s.text : "";
    switch (s.kind) {
      case "search":
        activity = [{ uid, agent: s.agent, kind: "search", id: `d${uid}`, query: s.query, at: uid, results: [] }, ...activity];
        break;
      case "fetch":
        activity = [{ uid, agent: s.agent, kind: "fetch", id: `d${uid}`, url: s.url, title: s.title, done: true, at: uid }, ...activity];
        break;
      case "team":
        team = s.members.map((m) => ({ ...m, status: "working" }));
        break;
      case "member":
        team = team.map((m) => (m.id === s.id ? { ...m, status: "done" } : m));
        break;
      case "competitor":
        competitors.push(s.c);
        activity = [{ uid, agent: s.agent, kind: "competitor", name: s.c.name, at: uid }, ...activity];
        break;
      case "cite":
        activity = [{ uid, agent: "lead", kind: "cite", id: s.id, url: s.url, claim: s.claim, at: uid }, ...activity];
        break;
      case "verdict":
        activity = activity.map((a) => (a.kind === "cite" && a.id === s.id ? { ...a, verdict: s.verdict } : a));
        break;
      case "review":
        activity = [{ uid, agent: "lead", kind: "review", approved: s.approved, issues: [], attempt: s.attempt, at: uid, citations: s.citations }, ...activity];
        break;
    }
  });
  const finished = step >= SCRIPT.length;

  return (
    <AgentBoard
      key={loop}
      target="notion.so"
      activity={activity}
      competitors={competitors}
      running={!finished}
      done={finished}
      thinking={thinking}
      status="Starting the agent"
      team={team}
    />
  );
}
