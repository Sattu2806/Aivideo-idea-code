import Anthropic from "@anthropic-ai/sdk";
import { checkAccessCode, clientIp, takeRun } from "@/lib/access";
import { z } from "zod";
import { runAgent } from "@/lib/agent";
import { runWatchCheck } from "@/lib/watch/run";
import type { AgentEvent, RunRequest } from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 800; // research runs take a few minutes (Vercel caps this by plan)

const Competitor = z.object({
  name: z.string(), website: z.string(), one_liner: z.string(), target_customers: z.string(), pricing: z.string(),
  key_features: z.array(z.string()), strengths: z.array(z.string()), weaknesses: z.array(z.string()),
  threat_level: z.enum(["low", "medium", "high"]), sources: z.array(z.string()),
});
const Body = z.object({
  /** Set to run a watch-mode re-check instead of a new request. */
  watchId: z.string().max(64).optional(),
  company: z.string().trim().min(1).max(300),
  focus: z.string().trim().max(500).optional(),
  mode: z.enum(["competitors", "battlecards", "market"]).default("competitors"),
  followUp: z
    .object({
      question: z.string().trim().min(1).max(1000),
      report: z.object({ title: z.string(), executive_summary: z.string(), report_markdown: z.string().max(60_000) }),
      competitors: z.array(Competitor).max(20),
    })
    .optional(),
});

export async function POST(req: Request) {
  if (!checkAccessCode(req.headers.get("x-access-code"))) {
    return Response.json({ error: "Access code required", code: "access_required" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "company is required" }, { status: 400 });
  const { watchId, ...rest } = parsed.data;
  const run: RunRequest = { ...rest, focus: rest.focus || undefined };

  const quota = takeRun(clientIp(req));
  if (!quota.ok) {
    return Response.json(
      { error: `Run limit reached. Try again in about ${quota.retryInMinutes} minutes.`, code: "rate_limited" },
      { status: 429 },
    );
  }

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
        if (watchId) await runWatchCheck(watchId, emit, req.signal);
        else await runAgent(run, emit, req.signal);
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
  if (err instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected. Check ANTHROPIC_API_KEY (or your Foundry key).";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Bad request: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  const status = (err as { status?: number }).status;
  const msg = err instanceof Error ? err.message : "";
  if (status === 404 && /no longer available|not found/i.test(msg)) {
    return "That AI model isn't available to your key. Set GEMINI_MODEL (or CLAUDE_MODEL / AZURE_OPENAI_DEPLOYMENT) in .env.local to a model your key can use.";
  }
  if (status === 503) return "The AI model is overloaded right now (high demand). Wait a minute and try again, or pick another model with GEMINI_MODEL.";
  if (status === 401 || status === 403) return "The AI provider rejected the API key. Check your .env.local settings.";
  if (status === 429) return "The AI provider's rate limit was hit. Free tiers allow only a few requests per minute; wait and try again.";
  return err instanceof Error ? err.message : "Unknown error";
}
