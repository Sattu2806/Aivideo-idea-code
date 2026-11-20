"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Change, CitationStats, Competitor, Report } from "@/lib/events";
import { BrandModal } from "./BrandModal";
import { isCustomBrand, useBrand, type Brand } from "./useBrand";

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report";
}

function toMarkdown(report: Report, brand: Brand) {
  const by = isCustomBrand(brand)
    ? `*${[brand.name && `Prepared by ${brand.name}`, brand.preparedFor && `for ${brand.preparedFor}`].filter(Boolean).join(" ")}*\n\n`
    : "";
  const footer = brand.contact ? `\n---\n${brand.contact}\n` : "";
  return `# ${report.title}\n\n${by}${report.executive_summary}\n\n${report.report_markdown}\n${footer}`;
}

const mdLinks = { a: (props: React.ComponentProps<"a">) => <a {...props} target="_blank" rel="noreferrer" /> };

interface Props {
  report: Report;
  competitors: Competitor[];
  target: string;
  citations?: CitationStats | null;
  changes?: { since: string; list: Change[] } | null;
  /** Watch state: null = not watched. */
  watching: { nextRunAt: string } | null;
  onWatch: (intervalDays: number) => Promise<string | null>;
  onUnwatch: () => void;
}

export function ReportView({ report, competitors, target, citations, changes, watching, onWatch, onUnwatch }: Props) {
  const [copied, setCopied] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [watchErr, setWatchErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { brand, save } = useBrand();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const date = new Date().toLocaleDateString(undefined, { dateStyle: "long" });

  // PDF export uses the browser's print engine with the print layout in globals.css:
  // vector text, selectable, clickable links.
  function exportPdf() {
    const previous = document.title;
    document.title = `${slug(target)}-competitor-report`; // default PDF file name
    window.print();
    document.title = previous;
  }

  function downloadMd() {
    const url = URL.createObjectURL(new Blob([toMarkdown(report, brand)], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(target)}-competitor-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(toMarkdown(report, brand));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section>
      <div className="section-head">
        <div className="section-label">Report</div>
        <div className="actions">
          <button className="link" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button className="link" onClick={downloadMd}>Markdown</button>
          <button className="link" onClick={() => setBrandOpen(true)}>{isCustomBrand(brand) ? `Brand: ${brand.name}` : "Brand"}</button>
          <button className="run small" onClick={exportPdf}><span>Export PDF</span><span className="run-arrow">↓</span></button>
        </div>
      </div>

      <div className="watchbar">
        {watching ? (
          <>
            <span className="lamp ready" /> Watching — next check {new Date(watching.nextRunAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            <button className="link" onClick={onUnwatch}>Stop watching</button>
          </>
        ) : (
          <>
            <span className="dim">Get told when competitors change their pricing or features.</span>
            <button
              className="link"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setWatchErr((await onWatch(7)) ?? "");
                setBusy(false);
              }}
            >
              {busy ? "Saving…" : "Watch weekly"}
            </button>
          </>
        )}
        {watchErr && <span className="err small"> {watchErr}</span>}
      </div>

      {changes && <ChangesPanel changes={changes} />}

      <article className="doc">
        <div className="doc-meta mono">
          <span>Competitive analysis</span>
          <span>{date}</span>
        </div>
        <h1 className="doc-title">{report.title}</h1>
        {citations && citations.checked > 0 && <CitationBadge c={citations} />}
        <p className="doc-summary">{report.executive_summary}</p>
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdLinks}>{report.report_markdown}</ReactMarkdown>
        </div>
      </article>

      {mounted && createPortal(<PrintDocument report={report} competitors={competitors} target={target} date={date} brand={brand} changes={changes?.list ?? []} />, document.body)}
      {brandOpen && <BrandModal brand={brand} onSave={save} onClose={() => setBrandOpen(false)} />}
    </section>
  );
}

function changeLine(c: Change) {
  switch (c.kind) {
    case "new":
      return <><strong>{c.company}</strong> is new in the report</>;
    case "removed":
      return <><strong>{c.company}</strong> dropped out of the report</>;
    case "pricing":
      return <><strong>{c.company}</strong> pricing: <s>{c.before}</s> → {c.after}</>;
    case "threat":
      return <><strong>{c.company}</strong> threat level: {c.before} → {c.after}</>;
  }
}

function ChangesPanel({ changes }: { changes: { since: string; list: Change[] } }) {
  const since = changes.since ? new Date(changes.since).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "the last check";
  return (
    <div className={`changes ${changes.list.length ? "" : "none"}`}>
      <div className="changes-head">
        <span className="section-label">Changes since {since}</span>
        <span className="count">{changes.list.length || "No"} change{changes.list.length === 1 ? "" : "s"} found</span>
      </div>
      {changes.list.length > 0 ? (
        <ul>
          {changes.list.map((c, i) => (
            <li key={i} className={`chg ${c.kind}`}>
              <span className="chg-kind">{c.kind}</span>
              <span>{changeLine(c)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim">The competitor profiles match the last check. The report&apos;s first section notes anything else that moved.</p>
      )}
    </div>
  );
}

function CitationBadge({ c }: { c: CitationStats }) {
  const n = c.checked;
  if (c.supported === 0 && c.unsupported === 0) {
    return (
      <div className="verified none mono">
        Citations not auto-checked — the cited sites block automated reading. Verify key figures yourself.
      </div>
    );
  }
  return (
    <div className={`verified mono ${c.unsupported > 0 ? "warn" : ""}`}>
      <span className="seal">{c.unsupported > 0 ? "!" : "✓"}</span>
      {c.supported === n ? `All ${n} citations verified by opening the source` : `${c.supported} of ${n} citations verified by opening the source`}
      {c.unsupported > 0 && <span> · {c.unsupported} didn&apos;t match their source</span>}
      {c.unreachable > 0 && <span className="dim"> · {c.unreachable} couldn&apos;t be opened</span>}
    </div>
  );
}

// Only rendered on paper / PDF.
function PrintDocument({ report, competitors, target, date, brand, changes }: { report: Report; competitors: Competitor[]; target: string; date: string; brand: Brand; changes: Change[] }) {
  return (
    <div className="print-doc" style={{ ["--brand" as string]: brand.accent }}>
      <header className="pd-head">
        <div className="pd-row">
          <span className="pd-brand">
            {brand.logo && <img src={brand.logo} alt="" />}
            <strong>{brand.name || "INTEL/01"}</strong>
          </span>
          <span>Competitive analysis · {date}</span>
        </div>
        <h1>{report.title}</h1>
        <div className="pd-target">
          Subject: {target}
          {brand.preparedFor && <> · Prepared for {brand.preparedFor}</>}
        </div>
        <p className="pd-summary">{report.executive_summary}</p>
      </header>

      {changes.length > 0 && (
        <section className="pd-section pd-changes">
          <h2>Changes since the last check</h2>
          <ul>
            {changes.map((c, i) => (
              <li key={i}>{changeLine(c)}</li>
            ))}
          </ul>
        </section>
      )}

      {competitors.length > 0 && (
        <section className="pd-section">
          <h2>Competitors at a glance</h2>
          <table className="pd-table">
            <thead><tr><th>Competitor</th><th>Pricing</th><th>Best for</th><th>Threat</th></tr></thead>
            <tbody>
              {competitors.map((c) => (
                <tr key={c.name}>
                  <td><strong>{c.name}</strong><br /><span className="pd-muted">{c.website}</span></td>
                  <td>{c.pricing}</td>
                  <td>{c.target_customers}</td>
                  <td className={`pd-threat ${c.threat_level}`}>{c.threat_level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="pd-section pd-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.report_markdown}</ReactMarkdown>
      </section>

      <footer className="pd-footer">
        <span>{brand.contact || "Researched by an AI agent team."}</span>
        <span>Check key figures against the linked sources before acting on them.</span>
      </footer>
    </div>
  );
}
