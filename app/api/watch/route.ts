import { z } from "zod";
import { checkAccessCode } from "@/lib/access";
import { createWatch, deleteWatch, listWatches, storeKind } from "@/lib/watch/store";

export const runtime = "nodejs";

const denied = () => Response.json({ error: "Access code required", code: "access_required" }, { status: 401 });

// GET: the watchlist (latest run of each, without old history).
export async function GET(req: Request) {
  if (!checkAccessCode(req.headers.get("x-access-code"))) return denied();
  try {
    const watches = (await listWatches()).map(({ runs, ...w }) => ({ ...w, latest: runs[0] ?? null, runCount: runs.length }));
    return Response.json({ watches, store: storeKind() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

const Competitor = z.object({
  name: z.string(), website: z.string(), one_liner: z.string(), target_customers: z.string(), pricing: z.string(),
  key_features: z.array(z.string()), strengths: z.array(z.string()), weaknesses: z.array(z.string()),
  threat_level: z.enum(["low", "medium", "high"]), sources: z.array(z.string()),
});
const Create = z.object({
  company: z.string().trim().min(1).max(300),
  mode: z.enum(["competitors", "battlecards", "market"]),
  focus: z.string().trim().max(500).optional(),
  intervalDays: z.number().int().min(1).max(60).default(7),
  baseline: z
    .object({
      report: z.object({ title: z.string(), executive_summary: z.string(), report_markdown: z.string().max(60_000) }),
      competitors: z.array(Competitor).max(20),
    })
    .optional(),
});

// POST: start watching. The current report becomes the baseline for the first comparison.
export async function POST(req: Request) {
  if (!checkAccessCode(req.headers.get("x-access-code"))) return denied();
  const p = Create.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return Response.json({ error: "Invalid watch request" }, { status: 400 });
  try {
    const { baseline, ...rest } = p.data;
    const w = await createWatch({ ...rest, baseline: baseline ? { at: new Date().toISOString(), ...baseline } : undefined });
    return Response.json({ watch: { ...w, runs: undefined, latest: w.runs[0] ?? null, runCount: w.runs.length } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

// DELETE ?id=…: stop watching.
export async function DELETE(req: Request) {
  if (!checkAccessCode(req.headers.get("x-access-code"))) return denied();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  return Response.json({ deleted: await deleteWatch(id) });
}
