"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentEvent, Competitor, PlanStep, Report } from "@/lib/events";

type Activity =
  | { kind: "search"; id: string; query: string; results?: { title: string; url: string }[]; error?: string }
  | { kind: "fetch"; id: string; url: string; title?: string; error?: string; done?: boolean }
  | { kind: "review"; approved: boolean; issues: string[]; attempt: number }
  | { kind: "note"; text: string };

type Usage = Extract<AgentEvent, { type: "usage" }>;

// Rough cost estimate: Opus 5.5 list prices + $10 per 1,000 web searches.
function estimateCost(u: Usage) {
  return (u.input_tokens * 4 + u.output_tokens * 20 + u.cache_read_tokens * 0.2) / 1e6 + u.web_searches * 0.01;
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function Home() {
  const [company, setCompany] = useState("");
  const [focus, setFocus] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [thinking, setThinking] = useState("");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  function handle(event: AgentEvent) {
    switch (event.type) {
      case "status":
        setStatus(event.message);
        break;
      case "thinking":
        setThinking((t) => (t + event.text).slice(-1200));
        break;
      case "text":
        break; // the agent talks through tools; free text is not shown
      case "plan":
        setPlan(event.steps);
        break;
      case "step":
        setPlan((p) => p.map((s, i) => (i === event.index ? { ...s, status: event.status, note: event.note } : s)));
        break;
      case "search":
        setThinking("");
        setActivity((a) => [{ kind: "search", id: event.id, query: event.query }, ...a]);
        break;
      case "search_results":
        setActivity((a) =>
          a.map((x) => (x.kind === "search" && x.id === event.id ? { ...x, results: event.results, error: event.error } : x)),
        );
        break;
      case "fetch":
        setThinking("");
        setActivity((a) => [{ kind: "fetch", id: event.id, url: event.url }, ...a]);
        break;
      case "fetch_result":
        setActivity((a) =>
          a.map((x) =>
            x.kind === "fetch" && x.id === event.id
              ? { ...x, done: true, title: event.title, error: event.error, url: event.url || x.url }
              : x,
          ),
        );
        break;
      case "competitor":
        setCompetitors((c) => [...c, event.competitor]);
        setActivity((a) => [{ kind: "note", text: `Recorded competitor: ${event.competitor.name}` }, ...a]);
        break;
      case "review":
        setActivity((a) => [{ kind: "review", approved: event.approved, issues: event.issues, attempt: event.attempt }, ...a]);
        break;
      case "report":
        setReport(event.report);
        break;
      case "usage":
        setUsage(event);
        break;
      case "error":
        setError(event.message);
        break;
      case "done":
        setStatus("");
        break;
    }
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim() || running) return;
    setRunning(true);
    setStatus("Starting agent…");
    setPlan([]);
    setActivity([]);
    setThinking("");
    setCompetitors([]);
    setReport(null);
    setUsage(null);
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, focus }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as AgentEvent);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setStatus("");
      abortRef.current = null;
    }
  }

  function downloadReport() {
    if (!report) return;
    const md = `# ${report.title}\n\n${report.executive_summary}\n\n${report.report_markdown}\n`;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${company.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "report"}-competitors.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const started = running || plan.length > 0 || competitors.length > 0 || !!report || !!error;

  return (
    <main className="page">
      <header className="hero">
        <div className="badge">Agentic AI</div>
        <h1>Competitor Intel Agent</h1>
        <p>Give it a company. It plans its own research, searches the web, reads competitor sites and reviews, and writes a report that a second AI reviews before you get it.</p>
        <form onSubmit={start} className="form">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company name or website, e.g. linear.app"
            disabled={running}
            autoFocus
          />
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="Focus (optional), e.g. pricing for small teams"
            disabled={running}
          />
          {running ? (
            <button type="button" className="stop" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!company.trim()}>
              Run agent
            </button>
          )}
        </form>
      </header>

      {error && <div className="error">{error}</div>}

      {started && (
        <section className="grid">
          <div className="panel">
            <h2>Plan</h2>
            {plan.length === 0 ? (
              <p className="muted">{running ? "Waiting for the agent's plan…" : "No plan yet."}</p>
            ) : (
              <ol className="plan">
                {plan.map((s, i) => (
                  <li key={i} className={`step ${s.status}`}>
                    <span className="dot" />
                    <div>
                      <div>{s.title}</div>
                      {s.note && <div className="note">{s.note}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {(status || thinking) && (
              <div className="live">
                {status && (
                  <div className="status">
                    {running && <span className="spinner" />} {status}
                  </div>
                )}
                {thinking && running && <div className="thinking">{thinking}</div>}
              </div>
            )}

            {usage && (
              <div className="usage">
                <span>{(usage.input_tokens + usage.cache_read_tokens).toLocaleString()} in</span>
                <span>{usage.output_tokens.toLocaleString()} out</span>
                <span>{usage.web_searches} searches</span>
                <span>≈ ${estimateCost(usage).toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Agent activity</h2>
            {activity.length === 0 && <p className="muted">Tool calls will appear here live.</p>}
            <ul className="feed">
              {activity.map((a, i) => (
                <li key={i} className={`item ${a.kind}`}>
                  {a.kind === "search" && (
                    <>
                      <div className="label">🔎 Search</div>
                      <div className="main">{a.query}</div>
                      {a.error && <div className="note bad">Error: {a.error}</div>}
                      {a.results && (
                        <div className="note">
                          {a.results.length} results
                          {a.results.length > 0 && ` · ${a.results.slice(0, 3).map((r) => hostname(r.url)).join(", ")}`}
                        </div>
                      )}
                    </>
                  )}
                  {a.kind === "fetch" && (
                    <>
                      <div className="label">📄 {a.done ? "Read" : "Reading"}</div>
                      <div className="main">{a.title || hostname(a.url)}</div>
                      <div className={`note ${a.error ? "bad" : ""}`}>{a.error ? `Failed: ${a.error}` : a.url}</div>
                    </>
                  )}
                  {a.kind === "review" && (
                    <>
                      <div className="label">{a.approved ? "✅ Reviewer approved" : `↩️ Reviewer sent it back (round ${a.attempt})`}</div>
                      {a.issues.length > 0 && (
                        <ul className="issues">
                          {a.issues.map((x, j) => (
                            <li key={j}>{x}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {a.kind === "note" && <div className="main">✏️ {a.text}</div>}
                </li>
              ))}
            </ul>
          </div>

          <div className="panel wide">
            <h2>Competitors {competitors.length > 0 && <span className="count">{competitors.length}</span>}</h2>
            {competitors.length === 0 && <p className="muted">Competitor cards appear as the agent finishes each one.</p>}
            <div className="cards">
              {competitors.map((c, i) => (
                <article key={i} className="card">
                  <div className="card-head">
                    <div>
                      <h3>{c.name}</h3>
                      <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">
                        {hostname(c.website)}
                      </a>
                    </div>
                    <span className={`threat ${c.threat_level}`}>{c.threat_level} threat</span>
                  </div>
                  <p>{c.one_liner}</p>
                  <dl>
                    <dt>Pricing</dt>
                    <dd>{c.pricing}</dd>
                    <dt>Customers</dt>
                    <dd>{c.target_customers}</dd>
                  </dl>
                  <div className="pros-cons">
                    <div>
                      <h4>Strengths</h4>
                      <ul>{c.strengths.slice(0, 4).map((s, j) => <li key={j}>{s}</li>)}</ul>
                    </div>
                    <div>
                      <h4>Weaknesses</h4>
                      <ul>{c.weaknesses.slice(0, 4).map((s, j) => <li key={j}>{s}</li>)}</ul>
                    </div>
                  </div>
                  <div className="note">{c.sources.length} sources</div>
                </article>
              ))}
            </div>
          </div>

          {report && (
            <div className="panel wide report">
              <div className="report-head">
                <h2>{report.title}</h2>
                <button onClick={downloadReport}>Download .md</button>
              </div>
              <p className="summary">{report.executive_summary}</p>
              <div className="markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
                >
                  {report.report_markdown}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
