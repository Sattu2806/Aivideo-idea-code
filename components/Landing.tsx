"use client";

import { useState } from "react";

const EXAMPLES = ["linear.app", "notion.so", "calendly.com", "loom.com"];

export function Landing({ onRun, locked }: { onRun: (company: string, focus: string) => void; locked: boolean }) {
  const [company, setCompany] = useState("");
  const [focus, setFocus] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (company.trim()) onRun(company.trim(), focus.trim());
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

        <form className="ask" onSubmit={submit}>
          <label className="field">
            <span className="field-label">Subject</span>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="company.com"
              aria-label="Company or website"
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
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setCompany(ex)}>
              {ex}
            </button>
          ))}
        </div>
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
    </div>
  );
}
