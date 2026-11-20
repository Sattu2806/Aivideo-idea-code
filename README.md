# Competitor Intel Agent

An agentic AI app: type a company name and the agent **plans its own research, searches the web, reads competitor websites, pricing pages and reviews, records each competitor, and writes a report**. A second AI reviews that report and sends it back if it falls short, and the agent keeps working until it passes.

Built with Next.js and the Claude API (`claude-opus-5-5`).

## How the agent works

```
User: "linear.app"
   │
   ▼
┌─────────────────────────── agent loop (lib/agent.ts) ───────────────────────────┐
│  Claude decides the next action and calls a tool:                                 │
│    plan_research      → writes its own plan (shown as a live checklist)           │
│    web_search         → searches the web          (runs on Anthropic's servers)   │
│    web_fetch          → reads a page              (runs on Anthropic's servers)   │
│    update_step        → ticks off plan steps                                      │
│    record_competitor  → saves a structured competitor card                       │
│    submit_report      → hands in the report ──► Reviewer AI grades it            │
│                                                  ├─ rejected → issues go back    │
│                                                  │   to the agent, loop continues│
│                                                  └─ approved → report delivered  │
│  Tool results go back to Claude; repeat until the report is approved.            │
└──────────────────────────────────────────────────────────────────────────────────┘
   │  every step is streamed to the browser as it happens (NDJSON)
   ▼
UI: plan checklist · live search/read feed · competitor cards · final report
```

What makes it an *agent* rather than a chatbot:
- **It plans.** It writes its own step-by-step plan and updates it as it goes.
- **It uses tools.** It decides what to search and which pages to read.
- **It loops.** Each tool result feeds into the next decision, for as many steps as the job needs.
- **It corrects itself.** A separate reviewer model checks the work, and the agent fixes what's flagged.

## Run it locally

You need Node.js 20+ and an Anthropic API key ([get one here](https://platform.claude.com/settings/keys)).

```bash
npm install
cp .env.example .env.local      # then paste your key into .env.local
npm run dev
```

Open http://localhost:3000 and enter a company, for example `linear.app`, `notion.so` or a local business.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Add the `ANTHROPIC_API_KEY` environment variable.
3. Deploy.

A run takes a few minutes. The API route asks for up to 800 seconds (`maxDuration`); how much of that you actually get depends on your Vercel plan.

## Lock it before you share it

Every run spends your API credits, so set these in Vercel (or `.env.local`) before you share a link:

| Variable | What it does |
|---|---|
| `ACCESS_CODE` | Visitors must enter this code to run the agent. Leave empty for open access (only on your own machine). |
| `MAX_RUNS_PER_HOUR` | Runs allowed per IP address per hour. Default 5; `0` means no limit. It's kept in server memory, so on serverless hosts it's best effort. Use Upstash Redis or Vercel KV if you need a strict limit. |

## Exporting reports

- **Export PDF:** opens your browser's save dialog with a branded print layout: cover, executive summary, competitor table and the full report. Choose "Save as PDF". The text stays selectable and the links stay clickable.
- **Markdown** and **Copy:** for pasting into Notion, Google Docs or an email.

## Cost

My rough estimate is **$1–3 per run**, depending on how much the agent reads. This hasn't been measured on a real run yet. The UI shows a live cost estimate while it runs.
To make it cheaper, set `AGENT_EFFORT=low` in `.env.local`; for more thorough research, use `high`.

## Files

| File | What it does |
|---|---|
| `lib/agent.ts` | The agent: system prompt, tools, the loop, and the reviewer |
| `lib/events.ts` | Event types streamed from the server to the UI |
| `app/api/research/route.ts` | API route that runs the agent and streams its events |
| `app/api/access/route.ts` | Checks the access code |
| `lib/access.ts` | Access code check and per-IP run limit |
| `app/page.tsx` | Page shell: switches between the landing page and the workspace |
| `components/Landing.tsx` | Landing page with the request form |
| `components/Workspace.tsx` | Live run view: plan, timestamped log, competitor ledger |
| `components/AgentBoard.tsx` | Animated live board: sources, competitors and the agent moving between them |
| `components/ReportView.tsx` | Report view plus the PDF / Markdown export |
| `components/useAgent.ts` | Client state: streams events from the API |
| `app/globals.css` | Design (paper, ink, one accent colour) and the print (PDF) layout |

## Ideas to extend it (and for follow-up videos)

- Export straight to Google Docs.
- Run it every week and email you what changed in competitor pricing.
- Add a "battle card" mode for sales teams: how to win against each competitor.
- Let it research a whole market from a single keyword ("CRM for dentists").
