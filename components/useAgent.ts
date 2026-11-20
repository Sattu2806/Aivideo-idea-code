"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Competitor, Mode, PlanStep, ProviderInfo, Report, RunRequest } from "@/lib/events";

export type Activity = { uid: number } & (
  | { kind: "search"; id: string; query: string; at: number; results?: { title: string; url: string }[]; error?: string }
  | { kind: "fetch"; id: string; url: string; at: number; title?: string; error?: string; done?: boolean }
  | { kind: "review"; approved: boolean; issues: string[]; attempt: number; at: number }
  | { kind: "competitor"; name: string; at: number });

export type Usage = Extract<AgentEvent, { type: "usage" }>;
export type Phase = "idle" | "running" | "done" | "error";

export interface SavedFile {
  id: string;
  target: string;
  mode: Mode;
  date: number;
  report: Report;
  competitors: Competitor[];
}

const ACCESS_KEY = "intel-access-code";
const HISTORY_KEY = "intel-history";
const MAX_HISTORY = 12;

export const MODE_LABEL: Record<Mode, string> = { competitors: "Competitors", battlecards: "Battle cards", market: "Market map" };

export function formatCost(u: Usage | null, provider: ProviderInfo | null) {
  if (provider?.free) return "Free";
  if (!u) return "$0.00";
  return u.cost === null ? "—" : `$${u.cost.toFixed(2)}`;
}

function loadHistory(): SavedFile[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as SavedFile[];
  } catch {
    return [];
  }
}

export function useAgent() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<Mode>("competitors");
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
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [searchBackend, setSearchBackend] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedFile[]>([]);
  const [isFollowUp, setIsFollowUp] = useState(false);

  // Access code
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const pending = useRef<RunRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uidRef = useRef(0);
  // Latest values for saving to history when a report arrives.
  const live = useRef({ target, mode, competitors });
  live.current = { target, mode, competitors };

  useEffect(() => {
    setAccessCode(localStorage.getItem(ACCESS_KEY));
    setHistory(loadHistory());
    fetch("/api/access")
      .then((r) => r.json())
      .then((d: { required: boolean; provider: ProviderInfo | null; search: string | null }) => {
        setAccessRequired(d.required);
        setProvider(d.provider);
        setSearchBackend(d.search);
      })
      .catch(() => {});
  }, []);

  const saveToHistory = useCallback((rep: Report, comps: Competitor[]) => {
    const { target: t, mode: m } = live.current;
    const entry: SavedFile = { id: `${Date.now()}`, target: t, mode: m, date: Date.now(), report: rep, competitors: comps };
    const next = [entry, ...loadHistory().filter((h) => !(h.target === t && h.mode === m))].slice(0, MAX_HISTORY);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // storage full: skip saving
    }
    setHistory(next);
  }, []);

  const handle = useCallback(
    (event: AgentEvent) => {
      const at = Date.now();
      const uid = ++uidRef.current;
      switch (event.type) {
        case "meta":
          setProvider(event.provider);
          setSearchBackend(event.search);
          break;
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
          setActivity((a) => a.map((x) => (x.kind === "search" && x.id === event.id ? { ...x, results: event.results, error: event.error } : x)));
          break;
        case "fetch":
          setThinking("");
          setActivity((a) => [{ uid, kind: "fetch", id: event.id, url: event.url, at }, ...a]);
          break;
        case "fetch_result":
          setActivity((a) =>
            a.map((x) =>
              x.kind === "fetch" && x.id === event.id ? { ...x, done: true, title: event.title, error: event.error, url: event.url || x.url } : x,
            ),
          );
          break;
        case "competitor": {
          const c = event.competitor;
          // A follow-up can update a company that's already on file.
          setCompetitors((list) => {
            const i = list.findIndex((x) => x.name.toLowerCase() === c.name.toLowerCase());
            const next = i >= 0 ? list.map((x, j) => (j === i ? c : x)) : [...list, c];
            live.current.competitors = next;
            return next;
          });
          setActivity((a) => [{ uid, kind: "competitor", name: c.name, at }, ...a]);
          break;
        }
        case "review":
          setActivity((a) => [{ uid, kind: "review", approved: event.approved, issues: event.issues, attempt: event.attempt, at }, ...a]);
          break;
        case "report":
          setReport(event.report);
          setPlan((p) => p.map((s) => (s.status === "pending" || s.status === "in_progress" ? { ...s, status: "done" } : s)));
          saveToHistory(event.report, live.current.competitors);
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
    },
    [saveToHistory],
  );

  const start = useCallback(
    async (req: RunRequest, code: string | null) => {
      if (accessRequired && !code) {
        pending.current = req;
        setNeedsCode(true);
        return;
      }

      const followUp = !!req.followUp;
      setPhase("running");
      setIsFollowUp(followUp);
      setTarget(req.company);
      setMode(req.mode);
      setStatus("Starting agent…");
      setPlan([]);
      setActivity([]);
      setThinking("");
      if (!followUp) {
        setCompetitors([]);
        setReport(null);
      }
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
          body: JSON.stringify(req),
          signal: controller.signal,
        });
        if (res.status === 401) {
          localStorage.removeItem(ACCESS_KEY);
          setAccessCode(null);
          setAccessRequired(true);
          pending.current = req;
          setNeedsCode(true);
          setPhase(followUp ? "done" : "idle");
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
        setPhase(gotReport || followUp ? "done" : failed ? "error" : "done");
      }
    },
    [accessRequired, handle],
  );

  const run = useCallback(
    (company: string, focus: string, m: Mode = "competitors") => start({ company, focus, mode: m }, accessCode),
    [start, accessCode],
  );

  const followUp = useCallback(
    (question: string) => {
      if (!report) return;
      start({ company: target, mode, followUp: { question, report, competitors } }, accessCode);
    },
    [start, accessCode, report, target, mode, competitors],
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
      if (next) start(next, code);
      return true;
    },
    [start],
  );

  const openSaved = useCallback((f: SavedFile) => {
    setPhase("done");
    setIsFollowUp(false);
    setTarget(f.target);
    setMode(f.mode);
    setPlan([]);
    setActivity([]);
    setCompetitors(f.competitors);
    setReport(f.report);
    setUsage(null);
    setError("");
    setStartedAt(null);
    setFinishedAt(null);
  }, []);

  const removeSaved = useCallback((id: string) => {
    const next = loadHistory().filter((h) => h.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  }, []);

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
    phase, target, mode, status, plan, activity, thinking, competitors, report, usage, error, startedAt, finishedAt,
    provider, searchBackend, history, isFollowUp,
    accessRequired, needsCode, setNeedsCode, submitCode, run, followUp, openSaved, removeSaved, stop, reset,
  };
}
