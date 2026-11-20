"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Competitor, Report } from "@/lib/events";
import { Check, Copy, Doc, Download, Logo } from "./Icons";

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

  // PDF export uses the browser's print engine with a dedicated print layout
  // (see .print-doc in globals.css): crisp vector text, selectable, clickable links.
  function exportPdf() {
    const previous = document.title;
    document.title = `${slug(target)}-competitor-report`; // becomes the default PDF file name
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
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="block">
      <div className="block-head">
        <h2>Report</h2>
        <div className="toolbar">
          <button className="tool-btn" onClick={copy}>
            {copied ? <Check width={15} height={15} /> : <Copy width={15} height={15} />} {copied ? "Copied" : "Copy"}
          </button>
          <button className="tool-btn" onClick={downloadMd}>
            <Doc width={15} height={15} /> Markdown
          </button>
          <button className="btn-primary sm" onClick={exportPdf}>
            <Download width={15} height={15} /> Export PDF
          </button>
        </div>
      </div>

      <article className="paper">
        <div className="paper-head">
          <div className="paper-kicker">Competitive analysis · {new Date().toLocaleDateString(undefined, { dateStyle: "long" })}</div>
          <h1>{report.title}</h1>
          <p className="paper-summary">{report.executive_summary}</p>
        </div>
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdLinks}>
            {report.report_markdown}
          </ReactMarkdown>
        </div>
      </article>

      {mounted && createPortal(<PrintDocument report={report} competitors={competitors} target={target} />, document.body)}
    </section>
  );
}

// Only visible when printing / saving as PDF.
function PrintDocument({ report, competitors, target }: { report: Report; competitors: Competitor[]; target: string }) {
  const date = new Date().toLocaleDateString(undefined, { dateStyle: "long" });
  return (
    <div className="print-doc">
      <header className="pd-cover">
        <div className="pd-brand">
          <Logo width={30} height={30} /> <span>Competitor Intel</span>
        </div>
        <div className="pd-meta">Competitive analysis · {date}</div>
        <h1>{report.title}</h1>
        <div className="pd-target">Subject: {target}</div>
        <div className="pd-summary">
          <div className="pd-label">Executive summary</div>
          <p>{report.executive_summary}</p>
        </div>
      </header>

      {competitors.length > 0 && (
        <section className="pd-section">
          <h2>Competitors at a glance</h2>
          <table className="pd-table">
            <thead>
              <tr><th>Competitor</th><th>Pricing</th><th>Best for</th><th>Threat</th></tr>
            </thead>
            <tbody>
              {competitors.map((c) => (
                <tr key={c.name}>
                  <td><strong>{c.name}</strong><br /><span className="pd-muted">{c.website}</span></td>
                  <td>{c.pricing}</td>
                  <td>{c.target_customers}</td>
                  <td><span className={`pd-threat ${c.threat_level}`}>{c.threat_level}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="pd-section pd-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.report_markdown}</ReactMarkdown>
      </section>

      <footer className="pd-footer">Researched by an AI agent. Verify key figures against the linked sources before making decisions.</footer>
    </div>
  );
}
