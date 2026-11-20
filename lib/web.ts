import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// Web tools for providers without built-in web access (Gemini, Azure OpenAI).
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  summary?: string;
}

const UA = "Mozilla/5.0 (compatible; IntelResearchAgent/1.0; +https://github.com)";

/** Which search backend is used: SEARCH_PROVIDER, else Tavily if keyed, else Gemini if keyed, else DuckDuckGo. */
export function searchBackend(): "tavily" | "gemini" | "duckduckgo" {
  const forced = process.env.SEARCH_PROVIDER?.toLowerCase();
  if (forced === "tavily" || forced === "gemini" || forced === "duckduckgo") return forced;
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "duckduckgo";
}

export async function webSearch(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const backend = searchBackend();
  if (backend === "tavily") return tavilySearch(query, signal);
  if (backend === "gemini") return geminiSearch(query, signal);
  return duckDuckGoSearch(query, signal);
}

async function tavilySearch(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 8, search_depth: "basic" }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily search failed (HTTP ${res.status})`);
  const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return { results: (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 300) ?? "" })) };
}

// Gemini's built-in Google Search grounding, used as a search engine.
async function geminiSearch(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await withRetry(
    () =>
      ai.models.generateContent({
        model: process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: `Search the web for: ${query}\n\nList the most relevant findings as short bullet points with the specific facts (names, prices, numbers) you found.`,
        config: { tools: [{ googleSearch: {} }], abortSignal: signal },
      }),
    signal,
  );
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const results = chunks
    .filter((c) => c.web?.uri)
    .map((c) => ({ title: c.web!.title ?? c.web!.uri!, url: c.web!.uri!, snippet: "" }));
  return { results, summary: res.text?.slice(0, 4000) };
}

// No key needed. Parses DuckDuckGo's HTML results page.
async function duckDuckGoSearch(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal,
  });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  return { results: parseDuckDuckGo(await res.text()) };
}

export function parseDuckDuckGo(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/class="result results_links/).slice(1);
  for (const b of blocks) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decodeEntities(a[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/); // DuckDuckGo wraps links in a redirect
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // skip ads
    const snippet = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    results.push({ title: clean(a[2]), url, snippet: snippet ? clean(snippet[1]) : "" });
    if (results.length >= 8) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Page reader with SSRF protection: public http(s) hosts only, checked on
// every redirect hop.
// ---------------------------------------------------------------------------

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
}

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 24_000;

export async function webFetch(rawUrl: string, signal: AbortSignal): Promise<FetchedPage> {
  let url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/|json|xml/.test(type)) throw new Error(`unsupported content type ${type.split(";")[0] || "unknown"}`);
    const body = await readLimited(res, MAX_BYTES);
    const page = /html|xml/.test(type) ? htmlToText(body) : { title: "", text: body };
    return { url: url.toString(), title: page.title, text: page.text.slice(0, MAX_TEXT) };
  }
  throw new Error("too many redirects");
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http(s) URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("private address not allowed");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const { address } of addrs) if (isPrivateIp(address)) throw new Error("private address not allowed");
}

export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

async function readLimited(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= max) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br|table|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(h[1-6])[^>]*>/gi, "\n## ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title, text };
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function clean(s: string) {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Retry with backoff for free-tier rate limits (HTTP 429 / 503).
// ---------------------------------------------------------------------------

export async function withRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
  onWait?: (seconds: number) => void,
  tries = 5,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (attempt >= tries - 1 || signal.aborted || (status !== 429 && status !== 503)) throw err;
      const seconds = Math.min(60, 8 * 2 ** attempt);
      onWait?.(seconds);
      await new Promise((r) => setTimeout(r, seconds * 1000));
    }
  }
}
