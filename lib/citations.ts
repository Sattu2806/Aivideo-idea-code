import type { AgentEvent, CitationStats, CiteVerdict } from "./events";
import { CITATION_PROMPT } from "./prompts";
import type { Provider } from "./providers/types";
import { parseJson } from "./tools";
import { webFetch, type FetchedPage } from "./web";

// ---------------------------------------------------------------------------
// Citation checker: opens every link the report cites and asks the model
// whether the page actually supports the claim next to it.
// ---------------------------------------------------------------------------

export interface Citation {
  url: string;
  claim: string;
}

const MAX_CITATIONS = 10;

/** Pull [text](https://…) links out of markdown, with the sentence or table row around each. */
export function extractCitations(markdown: string): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const rawLine of markdown.split("\n")) {
    for (const m of rawLine.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
      const url = m[2];
      if (seen.has(url)) continue;
      seen.add(url);
      const claim = rawLine
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`#>|]/g, " ")
        .replace(/^\s*[-\d.]+\s+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
      out.push({ url, claim });
    }
  }
  // Claims with numbers (prices, percentages, counts) matter most; check those first.
  const factual = (c: Citation) => (/[\d$€£%]/.test(c.claim) ? 0 : 1);
  return out.sort((a, b) => factual(a) - factual(b)).slice(0, MAX_CITATIONS);
}

/** The parts of the page most likely to contain the claim's facts. */
export function excerptFor(claim: string, text: string, max = 1800): string {
  const lower = text.toLowerCase();
  const numbers = claim.match(/[$€£]?\d[\d,.]*\s?%?/g) ?? [];
  const words = (claim.match(/\b[A-Z][A-Za-z0-9]{3,}\b/g) ?? []).slice(0, 6);
  const terms = [...new Set([...numbers.map((n) => n.trim()), ...words])].filter((t) => t.length > 1);
  const windows: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (let hits = 0; hits < 2; hits++) {
      const i = lower.indexOf(term.toLowerCase(), from);
      if (i < 0) break;
      windows.push([Math.max(0, i - 220), Math.min(text.length, i + term.length + 220)]);
      from = i + term.length;
    }
  }
  if (windows.length === 0) return text.slice(0, max);
  windows.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  let out = "";
  for (const [a, b] of merged) {
    if (out.length > max) break;
    out += (out ? "\n…\n" : "") + text.slice(a, b);
  }
  return out.slice(0, max);
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: { n: { type: "integer" }, supported: { type: "boolean" }, note: { type: "string" } },
        required: ["n", "supported"],
      },
    },
  },
  required: ["results"],
};

export interface CitationResult {
  stats: CitationStats;
  /** Problems to send back to the agent. */
  issues: string[];
  /** One line per citation, for the reviewer. */
  notes: string;
}

export async function checkCitations(
  provider: Provider,
  markdown: string,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
  round: number,
  fetchPage: (url: string, signal: AbortSignal) => Promise<FetchedPage> = webFetch,
): Promise<CitationResult> {
  const cites = extractCitations(markdown);
  const stats: CitationStats = { checked: cites.length, supported: 0, unsupported: 0, unreachable: 0 };
  if (cites.length === 0) {
    return { stats, issues: ["The report cites no sources. Add inline markdown links for every factual claim."], notes: "No citations found." };
  }

  emit({ type: "status", message: `Checking ${cites.length} citations against their sources…` });
  const ids = cites.map((_, i) => `cite-${round}-${i}`);
  const verdicts: { verdict: CiteVerdict; note?: string }[] = cites.map(() => ({ verdict: "unreachable" }));
  const excerpts: (string | null)[] = cites.map(() => null);

  // Open the pages, a few at a time.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, cites.length) }, async () => {
      while (next < cites.length) {
        const i = next++;
        emit({ type: "cite", id: ids[i], url: cites[i].url, claim: cites[i].claim });
        try {
          const page = await fetchPage(cites[i].url, signal);
          excerpts[i] = excerptFor(cites[i].claim, page.text);
        } catch (err) {
          verdicts[i] = { verdict: "unreachable", note: err instanceof Error ? err.message : String(err) };
          emit({ type: "cite_result", id: ids[i], verdict: "unreachable", note: verdicts[i].note });
        }
      }
    }),
  );

  // One model call judges every page that opened.
  const readable = cites.map((c, i) => ({ c, i })).filter(({ i }) => excerpts[i] !== null);
  if (readable.length > 0) {
    const prompt = readable
      .map(({ c, i }) => `#${i}\nClaim: ${c.claim}\nURL: ${c.url}\nPage excerpts:\n${excerpts[i]}`)
      .join("\n\n---\n\n");
    let parsed: { n: number; supported: boolean; note?: string }[] = [];
    try {
      const raw = parseJson(await provider.json(CITATION_PROMPT, prompt, VERDICT_SCHEMA, signal)) as { results?: typeof parsed } | null;
      parsed = Array.isArray(raw?.results) ? raw!.results : [];
    } catch {
      parsed = []; // judging failed: treat as supported rather than blocking the report
    }
    for (const { i } of readable) {
      const r = parsed.find((x) => x.n === i);
      verdicts[i] = r && r.supported === false ? { verdict: "unsupported", note: r.note } : { verdict: "supported", note: r?.note };
      emit({ type: "cite_result", id: ids[i], verdict: verdicts[i].verdict, note: verdicts[i].note });
    }
  }

  const issues: string[] = [];
  const notes: string[] = [];
  cites.forEach((c, i) => {
    const v = verdicts[i];
    stats[v.verdict]++;
    notes.push(`- ${v.verdict.toUpperCase()}: "${c.claim}" → ${c.url}${v.note ? ` (${v.note})` : ""}`);
    if (v.verdict === "unsupported") {
      issues.push(`Citation check: "${c.claim}" is not supported by ${c.url}${v.note ? ` (${v.note})` : ""}. Correct the claim or cite a source that supports it.`);
    }
  });
  // Many sites block automated reading, so an unreachable page alone isn't an error.
  return { stats, issues, notes: notes.join("\n") };
}
