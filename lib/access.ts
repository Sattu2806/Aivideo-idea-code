import { createHash, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Access code: set ACCESS_CODE to lock the app. Leave it empty for open access
// (fine on your own machine, never on a public URL).
// ---------------------------------------------------------------------------

export function accessRequired(): boolean {
  return !!process.env.ACCESS_CODE;
}

export function checkAccessCode(provided: string | null): boolean {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return true;
  if (!provided) return false;
  // Compare hashes so the comparison takes the same time whatever the input length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Run limit per IP address (MAX_RUNS_PER_HOUR, default 5).
// Best effort: it lives in server memory, so on serverless hosts each instance
// keeps its own count and a restart resets it. For a hard limit, use a store
// like Upstash Redis or Vercel KV.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60 * 60 * 1000;
const runs = new Map<string, number[]>();

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export function takeRun(ip: string): { ok: boolean; retryInMinutes: number } {
  const limit = Number(process.env.MAX_RUNS_PER_HOUR ?? 5);
  if (!Number.isFinite(limit) || limit <= 0) return { ok: true, retryInMinutes: 0 };

  const now = Date.now();
  const recent = (runs.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    return { ok: false, retryInMinutes: Math.ceil((WINDOW_MS - (now - recent[0])) / 60000) };
  }
  recent.push(now);
  runs.set(ip, recent);
  return { ok: true, retryInMinutes: 0 };
}
