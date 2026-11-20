import { accessRequired, checkAccessCode } from "@/lib/access";

export const runtime = "nodejs";

// GET: is an access code required?  POST: is this code correct?
export async function GET() {
  return Response.json({ required: accessRequired() });
}

export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const ok = checkAccessCode(code ?? null);
  if (!ok) await new Promise((r) => setTimeout(r, 800)); // slow down guessing
  return Response.json({ ok }, { status: ok ? 200 : 401 });
}
