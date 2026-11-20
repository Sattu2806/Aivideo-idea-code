"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Competitor, PlanStep, Report } from "@/lib/events";

export type Activity = { uid: number } & (
  | { kind: "search"; id: string; query: string; at: number; results?: { title: string; url: string }[]; error?: string }
  | { kind: "fetch"; id: string; url: string; at: number; title?: string; error?: string; done?: boolean }
  | { kind: "review"; approved: boolean; issues: string[]; attempt: number; at: number }
  | { kind: "competitor"; name: string; at: number });

export type Usage = Extract<AgentEvent, { type: "usage" }>;
export type Phase = "idle" | "running" | "done" | "error";

const ACCESS_KEY = "intel-access-code";

// Rough cost estimate: Opus 5.5 list prices + $10 per 1,000 web searches.
export function estimateCost(u: Usage) {
  return (u.input_tokens * 4 + u.output_tokens * 20 + u.cache_read_tokens * 0.2) / 1e6 + u.web_searches * 0.01;
}

export function useAgent() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [thinking, setThinking] = useState("");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  // Access code
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const pending = useRef<{ company: string; focus: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setAccessCode(localStorage.getItem(ACCESS_KEY));
    fetch("/api/access")
      .then((r) => r.json())
      .then((d: { required: boolean }) => setAccessRequired(d.required))
      .catch(() => {});
  }, []);

  const uidRef = useRef(0);
  const handle = useCallback((event: AgentEvent) => {
    const at = Date.now();
    const uid = ++uidRef.current;
    switch (event.type) {
      case "status":
        setStatus(event.message);
        break;
      case "thinking":
        setThinking((t) => (t + event.text).slice(-600));
        break;
      case "text":
        break;
      case "plan":
        setPlan(event.steps);
        break;
      case "step":
        setPlan((p) => p.map((s, i) => (i === event.index ? { ...s, status: event.status, note: event.note } : s)));
        break;
      case "search":
        setThinking("");
        setActivity((a) => [{ uid, kind: "search", id: event.id, query: event.query, at }, ...a]);
        break;
      case "search_results":
        setActivity((a) =>
          a.map((x) => (x.kind === "search" && x.id === event.id ? { ...x, results: event.results, error: event.error } : x)),
        );
        break;
      case "fetch":
        setThinking("");
        setActivity((a) => [{ uid, kind: "fetch", id: event.id, url: event.url, at }, ...a]);
        break;
      case "fetch_result":
        setActivity((a) =>
          a.map((x) =>
            x.kind === "fetch" && x.id === event.id
              ? { ...x, done: true, title: event.title, error: event.error, url: event.url || x.url }
              : x,
          ),
        );
        break;
      case "competitor":
        setCompetitors((c) => [...c, event.competitor]);
        setActivity((a) => [{ uid, kind: "competitor", name: event.competitor.name, at }, ...a]);
        break;
      case "review":
        setActivity((a) => [{ uid, kind: "review", approved: event.approved, issues: event.issues, attempt: event.attempt, at }, ...a]);
        break;
      case "report":
        setReport(event.report);
        setPlan((p) => p.map((s) => (s.status === "pending" || s.status === "in_progress" ? { ...s, status: "done" } : s)));
        break;
      case "usage":
        setUsage(event);
        break;
      case "error":
        setError(event.message);
        break;
      case "done":
        setStatus("");
        break;
    }
  }, []);

  const run = useCallback(
    async (company: string, focus: string, code: string | null = accessCode) => {
      if (accessRequired && !code) {
        pending.current = { company, focus };
        setNeedsCode(true);
        return;
      }

      setPhase("running");
      setTarget(company);
      setStatus("Starting agent…");
      setPlan([]);
      setActivity([]);
      setThinking("");
      setCompetitors([]);
      setReport(null);
      setUsage(null);
      setError("");
      setStartedAt(Date.now());
      setFinishedAt(null);

      const controller = new AbortController();
      abortRef.current = controller;
      let failed = false;
      let gotReport = false;
      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(code ? { "x-access-code": code } : {}) },
          body: JSON.stringify({ company, focus }),
          signal: controller.signal,
        });
        if (res.status === 401) {
          localStorage.removeItem(ACCESS_KEY);
          setAccessCode(null);
          setAccessRequired(true);
          pending.current = { company, focus };
          setNeedsCode(true);
          setPhase("idle");
          return;
        }
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as AgentEvent;
            if (event.type === "error") failed = true;
            if (event.type === "report") gotReport = true;
            handle(event);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          failed = true;
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        abortRef.current = null;
        setStatus("");
        setFinishedAt(Date.now());
        setPhase(gotReport ? "done" : failed ? "error" : "done");
      }
    },
    [accessCode, accessRequired, handle],
  );

  const submitCode = useCallback(
    async (code: string): Promise<boolean> => {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) return false;
      localStorage.setItem(ACCESS_KEY, code);
      setAccessCode(code);
      setNeedsCode(false);
      const next = pending.current;
      pending.current = null;
      if (next) run(next.company, next.focus, code);
      return true;
    },
    [run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle");
    setPlan([]);
    setActivity([]);
    setCompetitors([]);
    setReport(null);
    setUsage(null);
    setError("");
    setTarget("");
  }, []);

  return {
    phase, target, status, plan, activity, thinking, competitors, report, usage, error, startedAt, finishedAt,
    accessRequired, needsCode, setNeedsCode, submitCode, run, stop, reset,
  };
}
