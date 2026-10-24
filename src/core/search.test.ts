// Dates in headlines are compared with the debate's local "today" (Brazil).
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = "America/Sao_Paulo";

import { describe, expect, it } from "vitest";
import { decodeHtml, duckduckgo, googleCustomSearch, parseDuckDuckGoHtml, parseGoogleNewsRss, serper } from "./search";

describe("search failures are not evidence", () => {
  it("a page that is not a result list (captcha, new layout) is an error, not an empty search", () => {
    expect(() => parseDuckDuckGoHtml("<html><body><form id='challenge-form'>Prove you are human</form></body></html>")).toThrow(/DuckDuckGo/);
    // A real page with no hits still parses as zero results.
    expect(parseDuckDuckGoHtml('<div id="links" class="results"><div class="no-results">No results.</div></div>')).toEqual([]);
  });

  it("an unparseable page fails the search so the claim is not scored as 'sem evidência'", async () => {
    const ddg = duckduckgo(async () => new Response("<html>unexpected</html>"), 0, []);
    await expect(ddg.search("selic")).rejects.toThrow(/DuckDuckGo/);
  });

  it("an out-of-range numeric entity does not break the whole page", () => {
    expect(decodeHtml("a &#99999999; b &#x110000; c")).toBe("a &#99999999; b &#x110000; c");
  });
});

describe("result links", () => {
  const json = (body: unknown) => async () => Response.json(body);
  const items = [{ title: "ok", link: "https://example.org/a" }, { title: "js", link: "javascript:alert(1)" }, { title: "rel", link: "/relative" }, { title: "file", link: "file:///C:/x" }];

  it("Google and Serper keep only absolute http(s) links, the only ones the app can open", async () => {
    expect((await googleCustomSearch("k", "cx", json({ items })).search("q")).map((r) => r.url)).toEqual(["https://example.org/a"]);
    expect((await serper("k", json({ organic: items })).search("q")).map((r) => r.url)).toEqual(["https://example.org/a"]);
  });

  it("a network error never shows the Google API key (it travels in the URL)", async () => {
    const failing = async (input: RequestInfo | URL) => {
      throw new Error(`error sending request for url (${String(input)})`);
    };
    const err = await googleCustomSearch("SEKRET-123", "cx", failing).search("q").catch((e: Error) => e);
    expect(String(err)).toMatch(/Google/);
    expect(String(err)).not.toContain("SEKRET-123");
  });
});

describe("news dates", () => {
  it("an evening headline in Brazil keeps its local date, like the debate's 'today'", () => {
    const rss = `<rss><channel><item><title>Manchete - Jornal</title><link>https://news.google.com/rss/articles/x</link><pubDate>Thu, 23 Oct 2026 01:30:00 GMT</pubDate><source url="https://jornal.example">Jornal</source></item></channel></rss>`;
    expect(parseGoogleNewsRss(rss)[0].snippet).toBe("Notícia de Jornal, publicada em 2026-10-22");
  });
});
