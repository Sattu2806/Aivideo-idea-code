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

type Step =
  | { kind: "search"; query: string }
  | { kind: "fetch"; url: string; title: string }
  | { kind: "competitor"; c: Competitor }
  | { kind: "review"; approved: boolean };

const SCRIPT: Step[] = [
  { kind: "search", query: "notion alternatives for teams" },
  { kind: "fetch", url: "https://www.g2.com/products/notion/competitors", title: "Notion competitors" },
  { kind: "fetch", url: "https://coda.io/pricing", title: "Coda pricing" },
  { kind: "fetch", url: "https://clickup.com/pricing", title: "ClickUp pricing" },
  { kind: "search", query: "coda vs notion reddit" },
  { kind: "fetch", url: "https://www.reddit.com/r/Notion/coda", title: "Coda vs Notion" },
  { kind: "competitor", c: comp("Coda", "coda.io", "high", ["https://coda.io/pricing", "https://www.reddit.com/r/Notion/coda"]) },
  { kind: "fetch", url: "https://www.capterra.com/clickup/reviews", title: "ClickUp reviews" },
  { kind: "competitor", c: comp("ClickUp", "clickup.com", "high", ["https://clickup.com/pricing", "https://www.capterra.com/clickup/reviews"]) },
  { kind: "review", approved: false },
  { kind: "fetch", url: "https://www.atlassian.com/software/confluence/pricing", title: "Confluence pricing" },
  { kind: "fetch", url: "https://www.trustradius.com/confluence/reviews", title: "Confluence reviews" },
  { kind: "competitor", c: comp("Confluence", "atlassian.com", "medium", ["https://www.atlassian.com/software/confluence/pricing", "https://www.trustradius.com/confluence/reviews", "https://www.g2.com/products/notion/competitors"]) },
  { kind: "review", approved: true },
];

const STEP_MS = 1400;
const HOLD_MS = 4500;

export function DemoBoard() {
  const [loop, setLoop] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const done = step >= SCRIPT.length;
    const t = setTimeout(
      () => {
        if (done) {
          setStep(0);
          setLoop((l) => l + 1);
        } else setStep((s) => s + 1);
      },
      done ? HOLD_MS : step === 0 ? 700 : STEP_MS,
    );
    return () => clearTimeout(t);
  }, [step]);

  // Build board state for the first `step` steps of the script.
  const base = loop * 1000; // fresh uids each loop so the animations replay
  const activity: Activity[] = [];
  const competitors: Competitor[] = [];
  SCRIPT.slice(0, step).forEach((s, i) => {
    const uid = base + i + 1;
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
      thinking=""
      status="Planning the research…"
    />
  );
}
