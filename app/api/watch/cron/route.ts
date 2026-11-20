import { timingSafeEqual } from "node:crypto";
import { runDueWatches } from "@/lib/watch/run";

export const runtime = "nodejs";
export const maxDuration = 800;

// Runs the watches that are due. Called by Vercel Cron (see vercel.json) or by
// your own scheduler:  curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/watch/cron
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Set CRON_SECRET to enable scheduled checks." }, { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // One or two runs fit inside a single invocation's time limit; the rest wait for the next call.
  const limit = Number(process.env.WATCH_RUNS_PER_CRON ?? 2);
  const results = await runDueWatches(Number.isFinite(limit) && limit > 0 ? limit : 2, req.signal);
  return Response.json({ ran: results.length, results });
}
