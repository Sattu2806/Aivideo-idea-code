import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Change, CitationStats, Competitor, Mode, Report } from "../events";

// ---------------------------------------------------------------------------
// Watchlist storage.
//  - Upstash Redis if UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set
//    (use this on Vercel: its file system doesn't persist between requests)
//  - otherwise a JSON file in ./.data (fine on your own computer)
// ---------------------------------------------------------------------------

export interface WatchRun {
  at: string; // ISO date
  report: Report;
  competitors: Competitor[];
  citations?: CitationStats;
  changes: Change[];
}

export interface Watch {
  id: string;
  company: string;
  mode: Mode;
  focus?: string;
  intervalDays: number;
  createdAt: string;
  nextRunAt: string;
  /** Newest first, at most MAX_RUNS. */
  runs: WatchRun[];
  /** Set while a check is running, so the scheduler doesn't start it twice. */
  runningSince?: string;
}

const MAX_RUNS = 5;
const KEY = "intel:watches";

export function storeKind(): "upstash" | "file" {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? "upstash" : "file";
}

async function loadAll(): Promise<Watch[]> {
  if (storeKind() === "upstash") {
    const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash read failed (HTTP ${res.status})`);
    const { result } = (await res.json()) as { result: string | null };
    return result ? (JSON.parse(result) as Watch[]) : [];
  }
  try {
    return JSON.parse(await readFile(filePath(), "utf8")) as Watch[];
  } catch {
    return [];
  }
}

async function saveAll(watches: Watch[]) {
  const body = JSON.stringify(watches);
  if (storeKind() === "upstash") {
    const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${KEY}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
      body,
    });
    if (!res.ok) throw new Error(`Upstash write failed (HTTP ${res.status})`);
    return;
  }
  const file = filePath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, file); // atomic replace
}

function filePath() {
  return path.join(process.cwd(), ".data", "watches.json");
}

// Serialise writes within this server process so concurrent updates don't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function update<T>(fn: (all: Watch[]) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const all = await loadAll();
    const out = await fn(all);
    await saveAll(all);
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

export const listWatches = () => loadAll();

export async function getWatch(id: string) {
  return (await loadAll()).find((w) => w.id === id) ?? null;
}

export function createWatch(input: { company: string; mode: Mode; focus?: string; intervalDays: number; baseline?: Omit<WatchRun, "changes"> }) {
  return update((all) => {
    if (all.length >= 25) throw new Error("The watchlist is full (25). Remove one first.");
    const now = new Date();
    const w: Watch = {
      id: `w${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      company: input.company,
      mode: input.mode,
      focus: input.focus,
      intervalDays: input.intervalDays,
      createdAt: now.toISOString(),
      nextRunAt: new Date(now.getTime() + input.intervalDays * 86_400_000).toISOString(),
      runs: input.baseline ? [{ ...input.baseline, changes: [] }] : [],
    };
    all.push(w);
    return w;
  });
}

export function deleteWatch(id: string) {
  return update((all) => {
    const i = all.findIndex((w) => w.id === id);
    if (i >= 0) all.splice(i, 1);
    return i >= 0;
  });
}

/** Marks a watch as running. Returns false if it's already running (started < 30 min ago). */
export function claimWatch(id: string) {
  return update((all) => {
    const w = all.find((x) => x.id === id);
    if (!w) return false;
    if (w.runningSince && Date.now() - Date.parse(w.runningSince) < 30 * 60_000) return false;
    w.runningSince = new Date().toISOString();
    return true;
  });
}

export function finishWatch(id: string, run: WatchRun | null) {
  return update((all) => {
    const w = all.find((x) => x.id === id);
    if (!w) return null;
    delete w.runningSince;
    if (run) {
      w.runs = [run, ...w.runs].slice(0, MAX_RUNS);
      w.nextRunAt = new Date(Date.now() + w.intervalDays * 86_400_000).toISOString();
    }
    return w;
  });
}
