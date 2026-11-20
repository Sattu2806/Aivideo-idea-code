import { accessRequired, checkAccessCode } from "@/lib/access";
import { activeProvider, webToolsLabel } from "@/lib/agent";

export const runtime = "nodejs";

// GET: is an access code required, and which model runs the agent?  POST: is this code correct?
export async function GET() {
  const provider = activeProvider();
  return Response.json({ required: accessRequired(), provider, search: provider ? webToolsLabel(provider) : null });
}

export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const ok = checkAccessCode(code ?? null);
  if (!ok) await new Promise((r) => setTimeout(r, 800)); // slow down guessing
  return Response.json({ ok }, { status: ok ? 200 : 401 });
}
