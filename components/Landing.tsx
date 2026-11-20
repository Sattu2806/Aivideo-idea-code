"use client";

import { useState } from "react";
import type { Mode, ProviderInfo } from "@/lib/events";
import { DemoBoard } from "./DemoBoard";
import { MODE_LABEL, type SavedFile } from "./useAgent";

const MODES: { id: Mode; hint: string; placeholder: string; examples: string[] }[] = [
  { id: "competitors", hint: "Who you're up against, and where they're weak.", placeholder: "company.com", examples: ["linear.app", "notion.so", "calendly.com"] },
  { id: "battlecards", hint: "How to win deals against each rival, objection by objection.", placeholder: "company.com", examples: ["hubspot.com", "loom.com", "zendesk.com"] },
  { id: "market", hint: "Every serious player in a category, and the white space.", placeholder: "a category, e.g. CRM for dentists", examples: ["CRM for dentists", "AI note-takers", "B2B invoicing tools"] },
];

interface Props {
  onRun: (company: string, focus: string, mode: Mode) => void;
  locked: boolean;
  provider: ProviderInfo | null;
  searchBackend: string | null;
  history: SavedFile[];
  onOpen: (f: SavedFile) => void;
  onRemove: (id: string) => void;
}

export function Landing({ onRun, locked, provider, searchBackend, history, onOpen, onRemove }: Props) {
  const [company, setCompany] = useState("");
  const [focus, setFocus] = useState("");
  const [mode, setMode] = useState<Mode>("competitors");
  const current = MODES.find((m) => m.id === mode)!;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (company.trim()) onRun(company.trim(), focus.trim(), mode);
  }

  return (
    <div className="landing">
      <section className="hero">
        <div className="kicker">File a request</div>
        <h1 className="headline">
          Who are you <em>really</em> up&nbsp;against?
        </h1>
        <p className="lede">
          Name a company. An AI agent plans the research, reads competitor sites, pricing pages and reviews, then files a
          cited report. A second AI checks it before you see it.
        </p>

        <div className="modes" role="tablist" aria-label="Type of research">
          {MODES.map((m, i) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>
              <span className="mode-n">0{i + 1}</span> {MODE_LABEL[m.id]}
            </button>
          ))}
        </div>
        <p className="mode-hint">{current.hint}</p>

        <form className="ask" onSubmit={submit}>
          <label className="field">
            <span className="field-label">{mode === "market" ? "Market" : "Subject"}</span>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={current.placeholder}
              aria-label={mode === "market" ? "Market or category" : "Company or website"}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="field small">
            <span className="field-label">Focus</span>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="optional — e.g. pricing for small teams"
              aria-label="Optional focus"
              autoComplete="off"
            />
          </label>
          <button type="submit" className="run" disabled={!company.trim()}>
            <span>{locked ? "Unlock & run" : "Run agent"}</span>
            <span className="run-arrow">→</span>
          </button>
        </form>

        <div className="examples">
          <span>Try</span>
          {current.examples.map((ex) => (
            <button key={ex} type="button" onClick={() => setCompany(ex)}>
              {ex}
            </button>
          ))}
        </div>

        <div className="engine">
          {provider ? (
            <>
              <span className="lamp ready" />
              Runs on <strong>{provider.label}</strong> · {provider.model}
              {provider.free && <span className="tag">free tier</span>}
              {searchBackend && searchBackend !== "built-in" && <span className="dim"> · web search via {searchBackend}</span>}
            </>
          ) : (
            <>
              <span className="lamp err" /> No AI provider configured yet — add a key to <code>.env.local</code>
            </>
          )}
        </div>
      </section>

      <section className="preview">
        <div className="section-head">
          <div className="section-label">What happens when you press run</div>
          <div className="count">Demo · replays</div>
        </div>
        <DemoBoard />
      </section>

      <section className="method">
        {[
          ["01", "It plans", "Breaks your request into a research plan, then works through it on its own."],
          ["02", "It reads", "Searches the web and reads pricing pages, docs and real customer reviews."],
          ["03", "It's checked", "A second AI rejects weak work and sends it back until the report holds up."],
        ].map(([n, t, d]) => (
          <div key={n} className="method-item">
            <div className="method-n">{n}</div>
            <h3>{t}</h3>
            <p>{d}</p>
          </div>
        ))}
      </section>

      {history.length > 0 && (
        <section className="files">
          <div className="section-head">
            <div className="section-label">Your files</div>
            <div className="count">Saved in this browser</div>
          </div>
          <ul>
            {history.map((f) => (
              <li key={f.id}>
                <button className="file-row" onClick={() => onOpen(f)}>
                  <span className="file-target">{f.target}</span>
                  <span className="file-title">{f.report.title}</span>
                  <span className="file-meta">
                    {MODE_LABEL[f.mode]} · {new Date(f.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </button>
                <button className="file-x" onClick={() => onRemove(f.id)} aria-label={`Delete ${f.target}`}>×</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
