import type { FetchFn } from "./providers";
import type { SearchResult } from "./types";

export interface SearchProvider {
  readonly name: string;
  search(query: string, signal?: AbortSignal): Promise<SearchResult[]>;
}

export type SearchSettings =
  | { provider: "google"; apiKey: string; cx: string }
  | { provider: "serper"; apiKey: string }
  | { provider: "duckduckgo" };

const MAX_RESULTS = 6;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapDdgLink(href: string): string | null {
  const raw = decodeHtml(href);
  try {
    const u = new URL(raw, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg") ?? (u.hostname.endsWith("duckduckgo.com") ? null : u.toString());
    if (!target) return null;
    const t = new URL(target);
    return t.protocol === "http:" || t.protocol === "https:" ? t.toString() : null;
  } catch {
    return null;
  }
}

/** Absolute http(s) URL or null: the only links the app opens or shows a host for. */
export function httpUrl(link: string | undefined): string | null {
  try {
    const u = new URL(link ?? "");
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Parses html.duckduckgo.com results; ads and internal links are dropped. */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const blocks = html.split(/<div class="result results_links/).slice(1);
  // A captcha or a new layout would otherwise read as "no sources" and cost the speaker a point.
  if (!blocks.length && !/id="links"|class="results"|no-results/.test(html)) throw new Error("DuckDuckGo devolveu uma página que não é de resultados");
  for (const block of blocks) {
    if (/result--ad/.test(block.slice(0, 200))) continue;
    const a = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = unwrapDdgLink(a[1]);
    if (!url || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ title: decodeHtml(a[2]), url, snippet: snippet ? decodeHtml(snippet[1]) : "" });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** Waits after DuckDuckGo refuses a request (rate limit), before giving up. */
const DDG_BACKOFF_MS = [8000, 20000];

export function duckduckgo(fetchFn: FetchFn = fetch, minIntervalMs = 3000, backoffMs = DDG_BACKOFF_MS): SearchProvider {
  let last = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const attempt = async (query: string, signal?: AbortSignal) => {
    // DuckDuckGo rate-limits bursts: requests are serialized and spaced.
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
    const res = await fetchFn(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" }, signal });
    const html = await res.text();
    const refused = !res.ok || /anomaly-modal|Unfortunately, bots use DuckDuckGo/i.test(html);
    return { refused, status: res.status, html };
  };
  const run = async (query: string, signal?: AbortSignal) => {
    for (let i = 0; ; i++) {
      const r = await attempt(query, signal);
      if (!r.refused) return parseDuckDuckGoHtml(r.html);
      if (i >= backoffMs.length) throw new Error(`DuckDuckGo recusou a busca (HTTP ${r.status}) mesmo após esperar; use Google ou Serper em Configurar`);
      // Holding the queue here also slows every later search, which is what a rate limit asks for.
      await sleep(backoffMs[i]);
    }
  };
  return {
    name: "DuckDuckGo",
    search(query, signal) {
      const p = chain.then(() => run(query, signal));
      chain = p.catch(() => undefined);
      return p;
    },
  };
}

export function googleCustomSearch(apiKey: string, cx: string, fetchFn: FetchFn = fetch): SearchProvider {
  return {
    name: "Google",
    async search(query, signal) {
      const u = new URL("https://www.googleapis.com/customsearch/v1");
      u.search = new URLSearchParams({ key: apiKey, cx, q: query, num: String(MAX_RESULTS), lr: "lang_pt", gl: "br" }).toString();
      // The key travels in the URL and network errors quote the URL; never let it reach the screen.
      const res = await fetchFn(u.toString(), { signal }).catch((e: unknown) => {
        throw new Error(`Google Custom Search falhou: ${String(e instanceof Error ? e.message : e).replaceAll(apiKey, "***")}`);
      });
      if (!res.ok) throw new Error(`Google Custom Search respondeu ${res.status}`);
      const body = (await res.json()) as { items?: { title?: string; link?: string; snippet?: string }[] };
      return (body.items ?? []).flatMap((i) => {
        const url = httpUrl(i.link);
        return url ? [{ title: i.title ?? "", url, snippet: (i.snippet ?? "").replace(/\s+/g, " ") }] : [];
      });
    },
  };
}

export function serper(apiKey: string, fetchFn: FetchFn = fetch): SearchProvider {
  return {
    name: "Google (Serper)",
    async search(query, signal) {
      const res = await fetchFn("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, gl: "br", hl: "pt-br", num: MAX_RESULTS }),
        signal,
      });
      if (!res.ok) throw new Error(`Serper respondeu ${res.status}`);
      const body = (await res.json()) as { organic?: { title?: string; link?: string; snippet?: string }[] };
      return (body.organic ?? []).flatMap((i) => {
        const url = httpUrl(i.link);
        return url ? [{ title: i.title ?? "", url, snippet: i.snippet ?? "" }] : [];
      });
    },
  };
}

const NEWS_RESULTS = 4;

/** Google News RSS items: headline, outlet and date are the evidence (no snippet in the feed). */
export function parseGoogleNewsRss(xml: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (t: string) => decodeHtml(item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "").trim();
    const url = tag("link");
    if (!/^https:\/\//.test(url)) continue;
    const source = tag("source");
    const date = new Date(tag("pubDate"));
    const headline = tag("title");
    const title = source && headline.endsWith(` - ${source}`) ? headline.slice(0, -(source.length + 3)) : headline;
    // Local calendar date, the same convention as the debate's "today" the judge compares with.
    out.push({ title, url, snippet: `Notícia${source ? ` de ${source}` : ""}${Number.isNaN(date.getTime()) ? "" : `, publicada em ${date.toLocaleDateString("sv-SE")}`}` });
    if (out.length >= NEWS_RESULTS) break;
  }
  return out;
}

export function googleNews(fetchFn: FetchFn = fetch): SearchProvider {
  return {
    name: "Google Notícias",
    async search(query, signal) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
      const res = await fetchFn(url, { headers: { "User-Agent": UA }, signal });
      if (!res.ok) throw new Error(`Google Notícias respondeu ${res.status}`);
      return parseGoogleNewsRss(await res.text());
    },
  };
}

/** News first, then the web; either one failing still leaves evidence to judge with. */
export function withNews(web: SearchProvider, news: SearchProvider): SearchProvider {
  return {
    name: `${web.name} + ${news.name}`,
    async search(query, signal) {
      const [n, w] = await Promise.allSettled([news.search(query, signal), web.search(query, signal)]);
      if (n.status === "rejected" && w.status === "rejected") throw w.reason;
      const seen = new Set<string>();
      return [...(n.status === "fulfilled" ? n.value : []), ...(w.status === "fulfilled" ? w.value : [])]
        .filter((r) => !seen.has(r.url) && seen.add(r.url))
        .slice(0, MAX_RESULTS + NEWS_RESULTS);
    },
  };
}

function webSearch(s: SearchSettings, fetchFn: FetchFn): SearchProvider {
  switch (s.provider) {
    case "google":
      if (!s.apiKey || !s.cx) throw new Error("Google Custom Search precisa de API key e cx");
      return googleCustomSearch(s.apiKey, s.cx, fetchFn);
    case "serper":
      if (!s.apiKey) throw new Error("Serper precisa de API key");
      return serper(s.apiKey, fetchFn);
    case "duckduckgo":
      return duckduckgo(fetchFn);
  }
}

export function createSearch(s: SearchSettings, fetchFn: FetchFn = fetch): SearchProvider {
  return withNews(webSearch(s, fetchFn), googleNews(fetchFn));
}
