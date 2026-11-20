"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Competitor, Report } from "@/lib/events";

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report";
}

function toMarkdown(report: Report) {
  return `# ${report.title}\n\n${report.executive_summary}\n\n${report.report_markdown}\n`;
}

const mdLinks = { a: (props: React.ComponentProps<"a">) => <a {...props} target="_blank" rel="noreferrer" /> };

export function ReportView({ report, competitors, target }: { report: Report; competitors: Competitor[]; target: string }) {
  const [copied, setCopied] = useState(false);
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
    const url = URL.createObjectURL(new Blob([toMarkdown(report)], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(target)}-competitor-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(toMarkdown(report));
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
          <button className="run small" onClick={exportPdf}><span>Export PDF</span><span className="run-arrow">↓</span></button>
        </div>
      </div>

      <article className="doc">
        <div className="doc-meta mono">
          <span>Competitive analysis</span>
          <span>{date}</span>
        </div>
        <h1 className="doc-title">{report.title}</h1>
        <p className="doc-summary">{report.executive_summary}</p>
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdLinks}>{report.report_markdown}</ReactMarkdown>
        </div>
      </article>

      {mounted && createPortal(<PrintDocument report={report} competitors={competitors} target={target} date={date} />, document.body)}
    </section>
  );
}

// Only rendered on paper / PDF.
function PrintDocument({ report, competitors, target, date }: { report: Report; competitors: Competitor[]; target: string; date: string }) {
  return (
    <div className="print-doc">
      <header className="pd-head">
        <div className="pd-row"><strong>INTEL/01</strong><span>Competitive analysis · {date}</span></div>
        <h1>{report.title}</h1>
        <div className="pd-target">Subject: {target}</div>
        <p className="pd-summary">{report.executive_summary}</p>
      </header>

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

      <footer className="pd-footer">Researched by an AI agent. Check key figures against the linked sources before acting on them.</footer>
    </div>
  );
}
