import { describe, expect, it } from "vitest";
import { groundAnalysis } from "./analyze";
import { buildJudgePrompt, groundJudgement } from "./factcheck";
import { rankMoments } from "./highlights";
import { scoreboard } from "./score";
import { diversify, sourceKind } from "./search";
import { DebateSession } from "./session";
import type { Claim, SearchResult, Speaker } from "./types";

const speaker = (id: number, talk = 10): Speaker => ({ id, name: `S${id}`, portraits: [], talkSeconds: talk });
const claim = (speakerId: number, verdict: Claim["verdict"], confidence?: number): Claim => ({
  id: Math.random().toString(), utteranceId: "u", speaker: speakerId, at: 0, quote: "q", query: "q", status: "done", verdict, confidence,
});
const res = (url: string, title = url, extra: Partial<SearchResult> = {}): SearchResult => ({ title, url, snippet: "", ...extra });

describe("score impartiality", () => {
  it("not finding a source costs nothing", () => {
    const [row] = scoreboard([speaker(0)], [claim(0, "sem evidência"), claim(0, "sem evidência")], []);
    expect(row).toMatchObject({ points: 0, unproven: 2 });
  });

  it("a verdict the judge itself doubts is shown but does not score", () => {
    const [row] = scoreboard([speaker(0)], [claim(0, "falso", 0.4), claim(0, "falso", 0.9)], []);
    expect(row).toMatchObject({ points: -3, lies: 1, unproven: 1 });
    expect(rankMoments([claim(0, "falso", 0.4)], [])).toEqual([]);
  });

  it("with equal points the one who held up better leads, not the one who talked more", () => {
    // S0: +2 +2 -3 = 1, accuracy 2/3. S1: +2 -1 = 1, accuracy 1/2.
    const rows = scoreboard([speaker(1, 900), speaker(0, 10)], [claim(0, "verdadeiro"), claim(0, "verdadeiro"), claim(0, "falso"), claim(1, "verdadeiro"), claim(1, "enganoso")], []);
    expect(rows.map((r) => [r.speaker, r.points])).toEqual([[0, 1], [1, 1]]);
  });
});

describe("blind judge", () => {
  it("the prompt carries the claim and the evidence, never who said it", () => {
    const prompt = buildJudgePrompt({ quote: "a inflação passou de 15%", utterance: "a inflação passou de 15%", results: [res("https://www.ibge.gov.br/ipca", "IPCA")], today: "2026-10-23" });
    expect(prompt).toContain("(fonte oficial) IPCA");
    expect(prompt).not.toMatch(/Afirmação de /);
  });

  it("a verdict that cites no source is demoted and does not score", () => {
    const results = [res("https://a.example/1")];
    expect(groundJudgement({ verdict: "falso", explanation: "x", confidence: 0.9, sources: [] }, results)).toMatchObject({ verdict: "sem evidência", sources: [] });
    expect(groundJudgement({ verdict: "falso", explanation: "x", confidence: 0.9, sources: [7] }, results).verdict).toBe("sem evidência");
    const ok = groundJudgement({ verdict: "falso", explanation: " x ", confidence: 2, sources: [1, 1] }, results);
    expect(ok).toMatchObject({ verdict: "falso", explanation: "x", confidence: 1 });
    expect(ok.sources).toEqual(results);
  });

  it("an honest 'sem evidência' keeps no invented sources", () => {
    expect(groundJudgement({ verdict: "sem evidência", explanation: "x", confidence: 0.3, sources: [] }, [res("https://a.example/1")]).sources).toEqual([]);
  });
});

describe("evidence mix", () => {
  it("the same page, tracked or not, and the same headline count once", () => {
    const out = diversify([[res("https://a.example/x?utm_source=z", "Inflação sobe")], [res("https://www.a.example/x/", "Outra"), res("https://b.example/y", "Inflação sobe!")]]);
    expect(out.map((r) => r.url)).toEqual(["https://a.example/x?utm_source=z"]);
  });

  it("an outlet fills at most two slots, even when its news links share one host", () => {
    const news = (n: number, outlet: string) => res(`https://news.google.com/rss/articles/${n}`, `t${n}`, { outlet, snippet: "Notícia" });
    const out = diversify([[news(1, "Jornal"), news(2, "Jornal"), news(3, "Jornal"), news(4, "Outro")]]);
    expect(out.map((r) => r.title)).toEqual(["t1", "t2", "t4"]);
  });

  it("official sources lead and the lists alternate instead of one owning the top", () => {
    const out = diversify([[res("https://a1.example/"), res("https://a2.example/")], [res("https://b1.example/"), res("https://www.ibge.gov.br/ipca")]]);
    expect(out.map((r) => r.url)).toEqual(["https://www.ibge.gov.br/ipca", "https://a1.example/", "https://b1.example/", "https://a2.example/"]);
    expect(sourceKind(res("https://www.bcb.gov.br/x"))).toBe("oficial");
    expect(sourceKind(res("https://www.imf.org/x"))).toBe("oficial");
    expect(sourceKind(res("https://blog.example/gov.br"))).toBe("web");
    expect(sourceKind(res("https://news.google.com/rss/articles/1", "t", { outlet: "Folha" }))).toBe("notícia");
  });
});

describe("fallacies are only as strong as the judgement behind them", () => {
  it("an unsure ad hominem call does not cost points", () => {
    const text = "O senhor nunca trabalhou na vida e ninguém aqui confia no senhor";
    const mk = (confidence?: number) => groundAnalysis(text, { claims: [], fallacies: [{ kind: "ad hominem", quote: "O senhor nunca trabalhou na vida", explanation: "ataca a pessoa", confidence }] }).fallacies;
    expect(mk(0.4)).toEqual([]);
    expect(mk(0.9)).toHaveLength(1);
  });
});

describe("claim search", () => {
  const baseDeps = (search: (q: string) => Promise<SearchResult[]>, judged: { results: SearchResult[] }[]) => ({
    transcribe: async () => "",
    analyze: async () => ({ claims: [], fallacies: [] }),
    search,
    judge: async (i: { results: SearchResult[] }) => {
      judged.push(i);
      return { verdict: "verdadeiro" as const, explanation: "x", confidence: 0.9, sources: i.results };
    },
    today: "2026-10-23",
  });
  const run = async (c: Partial<Claim>, search: (q: string) => Promise<SearchResult[]>) => {
    const judged: { results: SearchResult[] }[] = [];
    const s = new DebateSession(baseDeps(search, judged) as never, { nameAfterTurns: 0 });
    const internals = s as unknown as { check(c: Claim, u: string): Promise<void>; state: { claims: Claim[] } };
    const full: Claim = { id: "c1", utteranceId: "u", speaker: 0, at: 0, quote: "q", query: "consulta", status: "searching", ...c };
    internals.state.claims = [full];
    await internals.check(full, "fala");
    return { judged, claim: internals.state.claims[0] };
  };

  it("searches the claim and the primary source, and judges the merged evidence", async () => {
    const asked: string[] = [];
    const { judged, claim: c } = await run({ counterQuery: "IBGE IPCA 2025" }, async (q) => {
      asked.push(q);
      return [res(q === "consulta" ? "https://jornal.example/a" : "https://www.ibge.gov.br/ipca")];
    });
    expect(asked.sort()).toEqual(["IBGE IPCA 2025", "consulta"]);
    expect(judged[0].results.map((r) => r.url)).toEqual(["https://www.ibge.gov.br/ipca", "https://jornal.example/a"]);
    expect(c.status).toBe("done");
  });

  it("one of the two searches failing still leaves evidence; both failing is an error", async () => {
    const partial = await run({ counterQuery: "oficial" }, async (q) => {
      if (q === "oficial") throw new Error("rate limited");
      return [res("https://jornal.example/a")];
    });
    expect(partial.claim.status).toBe("done");
    const both = await run({ counterQuery: "oficial" }, async () => {
      throw new Error("rate limited");
    });
    expect(both.claim).toMatchObject({ status: "error" });
  });
});
