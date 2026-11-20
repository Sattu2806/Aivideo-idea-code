"use client";

import { useState } from "react";
import { Arrow, Bolt, Brain, Check, Doc, Globe, Layers, Lock, Search, Shield, Spark, Users } from "./Icons";

const EXAMPLES = ["linear.app", "notion.so", "calendly.com", "a dental clinic in Austin"];

export function Landing({ onRun, locked }: { onRun: (company: string, focus: string) => void; locked: boolean }) {
  const [company, setCompany] = useState("");
  const [focus, setFocus] = useState("");
  const [showFocus, setShowFocus] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (company.trim()) onRun(company.trim(), focus.trim());
  }

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section className="hero" id="top">
        <div className="hero-glow" aria-hidden />
        <div className="grid-bg" aria-hidden />

        <a className="pill reveal" href="#how">
          <span className="pill-dot" /> Autonomous research agent · powered by Claude
          <Arrow width={14} height={14} />
        </a>

        <h1 className="display reveal d1">
          Know your competitors
          <br />
          <span className="gradient-text">before they know you.</span>
        </h1>

        <p className="lede reveal d2">
          Type a company. An AI agent plans the research, reads the web, compares pricing and real customer reviews, and
          hands you a cited, client-ready report in minutes.
        </p>

        <form className="command reveal d3" onSubmit={submit}>
          <div className="command-inner">
            <Search className="command-icon" />
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Enter a company or website…"
              aria-label="Company or website"
              autoFocus
            />
            <button type="button" className="ghost-btn" onClick={() => setShowFocus((s) => !s)}>
              {showFocus ? "– Focus" : "+ Focus"}
            </button>
            <button type="submit" className="btn-primary" disabled={!company.trim()}>
              {locked && <Lock width={15} height={15} />} Run agent <Arrow width={16} height={16} />
            </button>
          </div>
          {showFocus && (
            <input
              className="focus-input"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Optional focus, e.g. pricing for teams under 20 people"
            />
          )}
        </form>

        <div className="examples reveal d4">
          <span>Try</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setCompany(ex)}>
              {ex}
            </button>
          ))}
        </div>

        <ProductShot />
      </section>

      {/* ---------------- Proof strip ---------------- */}
      <section className="strip">
        <div><strong>3–5</strong><span>direct competitors per report</span></div>
        <div><strong>Cited</strong><span>sources linked inline</span></div>
        <div><strong>2 AIs</strong><span>one researches, one reviews</span></div>
        <div><strong>1 click</strong><span>to a branded PDF</span></div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section className="section" id="how">
        <div className="eyebrow">How it works</div>
        <h2 className="h2">An analyst that works on its own.</h2>
        <p className="sub">Not a chatbot you have to prompt. You hand it a goal; it decides the steps, uses tools, and checks its own work.</p>

        <div className="steps">
          {[
            { n: "01", icon: <Brain />, t: "Plans", d: "Breaks your request into a research plan you can watch tick off in real time." },
            { n: "02", icon: <Globe />, t: "Researches", d: "Searches the web and reads competitor sites, pricing pages and review sites itself." },
            { n: "03", icon: <Layers />, t: "Analyses", d: "Builds a structured profile of each competitor: pricing, customers, strengths, weaknesses." },
            { n: "04", icon: <Shield />, t: "Self-reviews", d: "A second AI grades the report and sends it back until it meets the bar." },
          ].map((s) => (
            <div className="step-card" key={s.n}>
              <div className="step-top">
                <span className="step-icon">{s.icon}</span>
                <span className="step-n">{s.n}</span>
              </div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- Bento ---------------- */}
      <section className="section" id="features">
        <div className="eyebrow">Features</div>
        <h2 className="h2">Research that would take a day, done before your coffee cools.</h2>

        <div className="bento">
          <div className="bento-card b-wide">
            <div className="bento-icon"><Search /></div>
            <h3>Reads the real web, live</h3>
            <p>Every search and every page it reads streams to your screen as it happens. Nothing is a black box.</p>
            <div className="mini-feed">
              <div><Search width={14} height={14} /> notion competitors for startups</div>
              <div><Doc width={14} height={14} /> coda.io/pricing</div>
              <div><Doc width={14} height={14} /> g2.com/products/clickup/reviews</div>
            </div>
          </div>
          <div className="bento-card">
            <div className="bento-icon"><Shield /></div>
            <h3>Checks its own work</h3>
            <p>An independent reviewer rejects vague advice, missing sources and gaps in the comparison.</p>
            <div className="review-chip"><Check width={14} height={14} /> Approved on round 2</div>
          </div>
          <div className="bento-card">
            <div className="bento-icon"><Doc /></div>
            <h3>Client-ready PDF</h3>
            <p>Export a branded report with a comparison table and recommendations, ready to send.</p>
          </div>
          <div className="bento-card">
            <div className="bento-icon"><Spark /></div>
            <h3>Every claim cited</h3>
            <p>Prices and facts link back to the page they came from. If it can&apos;t find it, it says so.</p>
          </div>
          <div className="bento-card">
            <div className="bento-icon"><Users /></div>
            <h3>Real customer voice</h3>
            <p>Weaknesses come from reviews and forums, not from competitors&apos; own marketing.</p>
          </div>
          <div className="bento-card b-full">
            <div className="bento-icon"><Bolt /></div>
            <h3>Built for people who sell</h3>
            <p>Founders preparing a pitch, agencies onboarding a client, sales teams building battle cards: one run gives you the market map and where to attack.</p>
            <div className="tags"><span>Founders</span><span>Agencies</span><span>Sales teams</span><span>Consultants</span></div>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="cta">
        <div className="cta-glow" aria-hidden />
        <h2 className="h2">See your whole market in minutes.</h2>
        <p className="sub">Enter one company. Get the full competitive picture.</p>
        <a href="#top" className="btn-primary big">
          Start a research run <Arrow width={18} height={18} />
        </a>
      </section>
    </>
  );
}

// Animated "screenshot" of the app, shown in the hero.
function ProductShot() {
  return (
    <div className="shot reveal d5" aria-hidden>
      <div className="shot-bar">
        <span /><span /><span />
        <div className="shot-url">intel-agent.app/research/notion.so</div>
      </div>
      <div className="shot-body">
        <div className="shot-col">
          <div className="shot-label">Plan</div>
          {["Understand Notion's positioning", "Identify direct competitors", "Compare pricing pages", "Mine user reviews", "Write recommendations"].map((t, i) => (
            <div key={t} className={`shot-step s${i}`}><span className="shot-dot" />{t}</div>
          ))}
        </div>
        <div className="shot-col feedcol">
          <div className="shot-label">Live activity</div>
          <div className="shot-item i0"><Search width={13} height={13} /> notion alternatives for teams</div>
          <div className="shot-item i1"><Doc width={13} height={13} /> coda.io/pricing</div>
          <div className="shot-item i2"><Doc width={13} height={13} /> clickup.com/pricing</div>
          <div className="shot-item i3"><Search width={13} height={13} /> clickup reviews reddit</div>
          <div className="shot-item i4 ok"><Check width={13} height={13} /> Reviewer approved report</div>
        </div>
        <div className="shot-col">
          <div className="shot-label">Competitors</div>
          {[["Coda", "high"], ["ClickUp", "high"], ["Confluence", "medium"]].map(([n, t]) => (
            <div key={n} className="shot-comp">
              <span>{n}</span>
              <span className={`threat ${t}`}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
