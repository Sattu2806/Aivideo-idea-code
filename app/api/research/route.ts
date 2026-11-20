import Anthropic from "@anthropic-ai/sdk";
import { runCompetitorAgent } from "@/lib/agent";
import type { AgentEvent } from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 800; // research runs take a few minutes (Vercel caps this by plan)

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { company?: string; focus?: string };
  const company = body.company?.trim().slice(0, 300);
  const focus = body.focus?.trim().slice(0, 500) || undefined;
  if (!company) return Response.json({ error: "company is required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // client disconnected
        }
      };
      try {
        // req.signal fires when the user closes the tab or hits Stop, which stops the agent (and the spend).
        await runCompetitorAgent({ company, focus, emit, signal: req.signal });
      } catch (err) {
        if (!req.signal.aborted) emit({ type: "error", message: describeError(err) });
      } finally {
        emit({ type: "done" });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid or missing ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Bad request: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : "Unknown error";
}
