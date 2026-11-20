"use client";

import { useEffect, useState } from "react";
import type { Competitor } from "@/lib/events";
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
  | { kind: "search"; query: string }
  | { kind: "fetch"; url: string; title: string }
  | { kind: "competitor"; c: Competitor }
  | { kind: "review"; approved: boolean }
);

const G2 = "https://www.g2.com/products/notion/competitors";
const SCRIPT: Step[] = [
  { ms: 1800, kind: "think", text: "Planning: find Notion's real rivals, compare pricing, read what users complain about." },
  { ms: 1300, kind: "search", query: "notion alternatives for teams" },
  { ms: 1100, kind: "fetch", url: G2, title: "Notion competitors" },
  { ms: 1100, kind: "fetch", url: "https://coda.io/pricing", title: "Coda pricing" },
  { ms: 1100, kind: "fetch", url: "https://clickup.com/pricing", title: "ClickUp pricing" },
  { ms: 1300, kind: "search", query: "coda vs notion reddit" },
  { ms: 1100, kind: "fetch", url: "https://www.reddit.com/r/Notion/coda", title: "Coda vs Notion" },
  { ms: 1100, kind: "fetch", url: "https://www.capterra.com/clickup/reviews", title: "ClickUp reviews" },
  { ms: 1600, kind: "think", text: "Coda keeps coming up for docs-heavy teams. Filing it." },
  { ms: 1500, kind: "competitor", c: comp("Coda", "coda.io", "high", ["https://coda.io/pricing", "https://www.reddit.com/r/Notion/coda"]) },
  { ms: 1500, kind: "competitor", c: comp("ClickUp", "clickup.com", "high", ["https://clickup.com/pricing", "https://www.capterra.com/clickup/reviews"]) },
  { ms: 2200, kind: "review", approved: false },
  { ms: 1500, kind: "think", text: "Reviewer wants a third competitor. Checking Confluence." },
  { ms: 1100, kind: "fetch", url: "https://www.atlassian.com/software/confluence/pricing", title: "Confluence pricing" },
  { ms: 1100, kind: "fetch", url: "https://www.trustradius.com/confluence/reviews", title: "Confluence reviews" },
  { ms: 1500, kind: "competitor", c: comp("Confluence", "atlassian.com", "medium", ["https://www.atlassian.com/software/confluence/pricing", "https://www.trustradius.com/confluence/reviews", G2]) },
  { ms: 1200, kind: "review", approved: true },
];

const HOLD_MS = 5000;

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
  const activity: Activity[] = [];
  const competitors: Competitor[] = [];
  let thinking = "";
  SCRIPT.slice(0, step).forEach((s, i) => {
    const uid = base + i + 1;
    thinking = s.kind === "think" ? s.text : "";
    if (s.kind === "search") activity.unshift({ uid, kind: "search", id: `d${uid}`, query: s.query, at: uid, results: [] });
    if (s.kind === "fetch") activity.unshift({ uid, kind: "fetch", id: `d${uid}`, url: s.url, title: s.title, done: true, at: uid });
    if (s.kind === "competitor") {
      competitors.push(s.c);
      activity.unshift({ uid, kind: "competitor", name: s.c.name, at: uid });
    }
    if (s.kind === "review") activity.unshift({ uid, kind: "review", approved: s.approved, issues: [], attempt: s.approved ? 2 : 1, at: uid });
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
    />
  );
}
