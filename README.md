# Competitor Intel Agent

An agentic AI app: name a company and **a team of AI agents researches its competitors**. A lead agent plans the work and finds the competitors, then sends one researcher agent per competitor to work in parallel. The lead writes the report, every citation is checked by opening the source, and a reviewer sends the report back until it passes. A live board animates every step.

Built with Next.js. Runs on **Gemini (free API key)**, **Claude**, **Claude on Azure (Microsoft Foundry)** or **Azure OpenAI**.

## What it can do

- **Three research modes**
  - **Competitors:** the 3–5 direct rivals, a comparison table, market gaps and recommended actions.
  - **Battle cards:** for sales teams. For each rival: when you win, when you lose, landmine questions and objection handling.
  - **Market map:** give it a category ("CRM for dentists") and it maps every serious player by segment and finds the white space.
- **Dig deeper:** after a report, ask a follow-up ("add Monday.com", "double-check every price"). The agent continues from the existing report, researches only what's needed, and files an updated version.
- **A team of agents:** the lead assigns one researcher per competitor; they run at the same time (two at a time on Gemini's free tier) and each returns a cited profile.
- **Citation checker:** before review, every link in the report is opened and the model checks whether the page really supports the claim next to it, for example the exact price. Wrong citations are sent back to be fixed. Sites that block automated reading are marked "couldn't open" and don't block the report.
- **Self-review:** an independent reviewer model checks each report against a checklist and sends it back with specific fixes.
- **Watch mode:** click **Watch weekly** under a report. The team re-researches the company on a schedule and the report opens with "What changed since …". The app also compares the competitor profiles itself (new or dropped competitors, price changes, threat-level changes) and shows them in a **Changes** panel, in the PDF, and optionally as a Slack/Discord message.
- **White-label PDFs:** click **Brand** to set your company name, logo, accent colour, the client it's "Prepared for", and a footer contact line. Every PDF and Markdown export uses it.
- **Your files:** finished reports are saved in your browser and listed on the home page.
- **Export:** PDF (print layout with your branding), Markdown, or copy.
- **Live board:** an animated map of the team at work: the lead (orange comet) and each researcher (labelled ink comets) fly to the pages they read, sources cluster around the competitor they belong to, cited sources turn green ✓ or orange ✗ as they're checked, and the reviewer stamps the result. The landing page plays a demo of it.

## How the agents work

```
User: "linear.app"
   │
   ▼
LEAD AGENT ─ plan_research → web_search → finds 3-5 competitors
   │
   ├─ assign_researchers ───────────────┬───────────────────┐
   ▼                                    ▼                   ▼
RESEARCHER: Jira            RESEARCHER: ClickUp   RESEARCHER: Shortcut    (in parallel)
  reads site, pricing, reviews → record_competitor → finish_research
   │                                    │                   │
   └───────────── profiles return to the lead ──────────────┘
   ▼
LEAD writes the report → submit_report
   │
   ├─ CITATION CHECK: open every cited link, does the page support the claim?
   ├─ REVIEWER: checklist for the chosen mode
   │     ├─ issues → back to the lead, who fixes them and resubmits
   │     └─ approved → report delivered
   ▼
Every step streams to the browser as it happens (NDJSON)
```

What makes it *agentic* rather than a chatbot:
- **It plans.** The lead writes its own step-by-step plan and updates it as it goes.
- **It delegates.** The lead decides which companies matter and hands each to its own researcher agent.
- **It uses tools.** Each agent decides what to search and which pages to read.
- **It loops.** Each tool result feeds into the next decision, for as many steps as the job needs.
- **It corrects itself.** Citations are checked against their sources, a reviewer checks the whole report, and the lead fixes what's flagged.

## Run it locally

You need Node.js 20+ and a key for **one** provider.

```bash
npm install
cp .env.example .env.local      # fill in ONE provider section
npm run dev
```

Open http://localhost:3000. The home page shows which model it will use ("Runs on Gemini · gemini-3.5-flash").

## Choosing a provider

| Provider | What to set in `.env.local` | Web search & reading | Cost |
|---|---|---|---|
| **Gemini** | `GEMINI_API_KEY` ([free key](https://aistudio.google.com/apikey)) | Done by the app (see below) | Free tier, with rate limits |
| **Claude** | `ANTHROPIC_API_KEY` | Built into Claude | Paid; live estimate shown |
| **Claude on Azure** | `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_RESOURCE`, `FOUNDRY_MODEL` (deployment name) | Built into Claude (basic versions on Azure) | Billed by Azure |
| **Azure OpenAI** | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Done by the app (see below) | Billed by Azure |

If more than one is configured, set `AI_PROVIDER` to choose. Otherwise the first one found wins, in the order above from Claude down.

**Web tools for Gemini and Azure OpenAI.** These models don't browse on their own here, so the app gives them two tools it runs itself:
- **Search:** Tavily if `TAVILY_API_KEY` is set (free tier: 1,000 searches a month), otherwise Gemini's Google Search if `GEMINI_API_KEY` is set, otherwise DuckDuckGo (no key, but it can rate-limit).
- **Page reading:** the server downloads the page and extracts the text. It only reads public `http`/`https` sites and refuses private or internal network addresses.

**Gemini free tier notes.** Free keys allow only a few requests per minute, and Google's free models are sometimes overloaded. The app waits and retries on rate limits, gives each call 90 seconds, and switches to a lighter model (`GEMINI_FALLBACK_MODELS`, default `gemini-3.5-flash-lite`) when the main one is overloaded; the status line says when this happens. Free keys also tend to get no Google Search allowance, so add a free Tavily key for search. With a Tavily key, pages that block automated reading are read through Tavily instead.

**Claude on Azure note.** The Claude API version retries a declined request on a fallback model automatically; that server-side option isn't available on Azure Foundry, so there a declined request just stops with a message.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Add your provider's environment variables (and `ACCESS_CODE`, below).
3. Deploy.

A run takes a few minutes. The API route asks for up to 800 seconds (`maxDuration`); how much of that you actually get depends on your Vercel plan.

## Lock it before you share it

Every run spends API credits or free-tier quota, so set these before you share a link:

| Variable | What it does |
|---|---|
| `ACCESS_CODE` | Visitors must enter this code to run the agent. Leave empty for open access (only on your own machine). |
| `MAX_RUNS_PER_HOUR` | Runs allowed per IP address per hour. Default 5; `0` means no limit. Kept in server memory, so on serverless hosts it's best effort; use Upstash Redis or Vercel KV for a strict limit. |

## Watch mode setup

Watches are stored on the server and re-checked by `/api/watch/cron`, which runs every watch that's due.

**On your own computer:** watches are saved in `./.data/watches.json`. Set `CRON_SECRET` in `.env.local`, then schedule this command (for example with cron, or Task Scheduler on Windows) to run once a day:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/watch/cron
```

You can also open a watch on the home page and press **Check now** at any time.

**On Vercel:**
1. Create a free Upstash Redis database and add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. (Vercel's file system doesn't keep files between requests.)
2. Add `CRON_SECRET`. `vercel.json` already schedules the check daily at 06:00 UTC; each watch is re-run when its interval (7 days) has passed.
3. Optional: add `WATCH_WEBHOOK_URL` (a Slack or Discord incoming webhook) to get a message when something changes.

Each cron call runs up to `WATCH_RUNS_PER_CRON` watches (default 2) so it stays inside time limits; the rest run on the next call.

## Cost

- **Gemini free tier:** $0, within Google's free limits.
- **Claude:** my rough estimate is **$1–3 per run**, not yet measured on a real run. Researchers run at low effort to keep this down. The UI shows a live estimate. Set `AGENT_EFFORT=low` to make it cheaper, `high` for more thorough research.
- **Azure:** depends on your deployment's pricing, so the UI shows token counts but no dollar figure.

## Files

| File | What it does |
|---|---|
| `lib/agent.ts` | Picks the provider from your settings and starts the run |
| `lib/team.ts` | The team: lead agent, parallel researchers, citation check and review |
| `lib/citations.ts` | Citation checker: finds each linked claim, opens the page, asks the model to judge |
| `lib/watch/` | Watch mode: storage (file or Upstash), re-check runner, profile comparison, alerts |
| `app/api/watch/` | Watchlist API and the cron endpoint |
| `lib/providers/types.ts` | The interface every provider implements (run a loop, make a JSON call) |
| `lib/providers/claude.ts` | Agent loop for Claude (Claude API and Azure Foundry), with built-in web tools |
| `lib/providers/generic.ts` | Agent loop for Gemini and Azure OpenAI, running web tools in this server |
| `lib/providers/gemini.ts` | Gemini adapter (function calling, thought summaries, rate-limit retry) |
| `lib/providers/azure-openai.ts` | Azure OpenAI adapter (Chat Completions with function tools) |
| `lib/web.ts` | Web search backends and the safe page reader |
| `lib/tools.ts` | Tool definitions and input validation shared by all providers |
| `lib/prompts.ts` | Prompts for the lead, researchers, citation checker, reviewer and follow-ups |
| `lib/events.ts` | Event types streamed from the server to the UI |
| `lib/access.ts` | Access code check and per-IP run limit |
| `app/api/research/route.ts` | Runs the agent and streams its events |
| `app/api/access/route.ts` | Access code check; tells the UI which provider is active |
| `components/Landing.tsx` | Home page: modes, request form, demo board, your files |
| `components/DemoBoard.tsx` | Scripted, looping demo of the live board for the home page |
| `components/AgentBoard.tsx` | The animated live board |
| `components/Workspace.tsx` | Run view: plan, board, log, competitor ledger, dig deeper |
| `components/ReportView.tsx` | Report view, changes panel, watch button, PDF / Markdown export |
| `components/BrandModal.tsx`, `useBrand.ts` | White-label settings for exports |
| `components/useAgent.ts` | Client state: streams events, follow-ups, saved files |
| `app/globals.css` | Design (paper, ink, one accent colour) and the print (PDF) layout |

## Ideas for follow-up videos

- Run it every week and email you what changed in competitor pricing.
- Export straight to Google Docs or Notion.
- Email the weekly changes digest instead of (or as well as) Slack.
- Share links: a public read-only page per report.
