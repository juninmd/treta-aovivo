import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { toSnapshot } from "./archive";
import { DebateSession, errText, type SessionDeps } from "./session";
import type { EngineEvent } from "./types";

function fakeDeps(overrides: Partial<SessionDeps> = {}): SessionDeps & { calls: string[] } {
  const calls: string[] = [];
  const texts: Record<string, string> = {
    A: "Boa noite, candidato Silva, sua pergunta.",
    B: "O senhor nunca trabalhou na vida e a inflação passou de 15% no ano passado.",
    C: "Isso é mentira.",
  };
  return {
    calls,
    today: "2026-10-23",
    transcribe: async (clip) => {
      calls.push(`asr:${clip}`);
      return texts[clip] ?? "";
    },
    analyze: async (input) => {
      calls.push(`analyze:${input.speakerName}`);
      return input.text.includes("15%")
        ? {
            claims: [{ quote: "a inflação passou de 15% no ano passado", query: "inflação 2025" }],
            fallacies: [{ kind: "ad hominem", quote: "O senhor nunca trabalhou na vida", explanation: "ataca a pessoa" }],
          }
        : { claims: [], fallacies: [] };
    },
    search: async (q) => {
      calls.push(`search:${q}`);
      return [{ title: "IPCA", url: "https://example.org", snippet: "inflação de 4,8%" }];
    },
    judge: async (i) => ({ verdict: "falso", explanation: `fontes: ${i.results.length}`, confidence: 0.9, sources: i.results }),
    suggestNames: async () => [{ speaker: 1, name: "Silva", evidence: "candidato Silva" }],
    ...overrides,
  };
}

const seg = (id: number, speaker: number, start: number, end: number, audio: string): EngineEvent => ({
  type: "segment", id, speaker, start, end, similarity: 0.8, newSpeaker: false, audio,
});

async function play(s: DebateSession, events: EngineEvent[]) {
  events.forEach((e) => s.handle(e));
  await new Promise((r) => setTimeout(r, 0));
  await s.whenIdle();
}

describe("DebateSession", () => {
  it("turns voice segments into a scored, fact-checked debate", async () => {
    const deps = fakeDeps();
    const s = new DebateSession(deps, { nameAfterTurns: 0 });
    await play(s, [
      { type: "started", source: "test" },
      seg(1, 0, 0, 3, "A"),
      seg(2, 1, 3.2, 9, "B"),
      seg(3, 0, 9.5, 11, "C"),
      { type: "ended", t: 11 },
    ]);
    const st = s.getState();
    expect(st.status).toBe("ended");
    expect(st.utterances.map((u) => [u.speaker, u.closed])).toEqual([[0, true], [1, true], [0, true]]);
    expect(st.fallacies).toMatchObject([{ speaker: 1, kind: "ad hominem" }]);
    expect(st.claims).toMatchObject([{ speaker: 1, status: "done", verdict: "falso", explanation: "fontes: 1" }]);
    expect(st.speakers.map((sp) => Math.round(sp.talkSeconds))).toEqual([5, 6]);
    expect(st.pending).toBe(0);
    // Transcription stays in order even though it is async.
    expect(deps.calls.filter((c) => c.startsWith("asr")).join()).toBe("asr:A,asr:B,asr:C");
  });

  it("records failures per stage without stopping the rest of the pipeline", async () => {
    const s = new DebateSession(fakeDeps({ search: async () => Promise.reject(new Error("rate limited")) }), { nameAfterTurns: 0 });
    await play(s, [seg(1, 1, 0, 6, "B"), seg(2, 0, 6.5, 8, "C"), { type: "ended", t: 8 }]);
    const st = s.getState();
    expect(st.claims[0]).toMatchObject({ status: "error", error: "rate limited" });
    expect(st.fallacies).toHaveLength(1);
  });

  it("auto-names voices but never overrides a name the user typed", async () => {
    const s = new DebateSession(fakeDeps({ suggestNames: async () => [{ speaker: 0, name: "Mediador", evidence: "" }, { speaker: 1, name: "Silva", evidence: "" }] }));
    s.handle(seg(1, 0, 0, 3, "A"));
    s.handle(seg(2, 1, 3.2, 9, "B"));
    await new Promise((r) => setTimeout(r, 0));
    s.renameSpeaker(0, "Ana Paula");
    await play(s, [{ type: "ended", t: 9 }]);
    expect(s.getState().speakers.map((x) => x.name)).toEqual(["Ana Paula", "Silva"]);
  });

  it("merging voices moves turns, claims and talk time to the survivor", async () => {
    const s = new DebateSession(fakeDeps(), { nameAfterTurns: 0 });
    await play(s, [seg(1, 0, 0, 3, "A"), seg(2, 2, 3.2, 9, "B"), { type: "ended", t: 9 }]);
    s.mergeSpeakers(2, 0);
    const st = s.getState();
    expect(st.speakers.map((x) => x.id)).toEqual([0]);
    expect(st.claims.every((c) => c.speaker === 0) && st.fallacies.every((f) => f.speaker === 0)).toBe(true);
    expect(Math.round(st.speakers[0].talkSeconds)).toBe(9);
  });

  it("keeps captured portraits per voice, largest faces first", () => {
    const s = new DebateSession(fakeDeps());
    const face = (w: number): EngineEvent => ({ type: "face", speaker: 1, t: 1, portrait: { image: `img${w}`, score: 3, faceWidth: w, hash: "00" } });
    s.handle(face(0.1));
    s.handle(face(0.3));
    expect(s.getState().speakers[0].portraits.map((p) => p.image)).toEqual(["img0.3", "img0.1"]);
  });
});

describe("errText", () => {
  it("shows what the provider actually returned when its body is not the expected JSON", () => {
    const e = new APICallError({ message: "Invalid JSON response", url: "http://x/v1/chat/completions", requestBodyValues: {}, responseBody: '{"error":\n "model crashed"}', cause: new Error("Unexpected token") });
    const text = errText(e);
    expect(text).toContain("Invalid JSON response (Unexpected token)");
    expect(text).toContain('resposta: {"error": "model crashed"}');
    expect(errText(new Error("plain"))).toBe("plain");
  });
});

describe("live-length sessions", () => {
  it("keeps re-trying names while a talking voice is still a placeholder, and drops audio of turns with nothing to replay", async () => {
    let namingCalls = 0;
    const s = new DebateSession(
      {
        today: "2026-10-23",
        transcribe: async (clip) => `fala ${clip}`,
        analyze: async () => ({ claims: [], fallacies: [] }),
        search: async () => [],
        judge: async () => { throw new Error("unused"); },
        suggestNames: async () => { namingCalls++; return namingCalls < 2 ? [] : [{ speaker: 0, name: "Lula", evidence: "Candidato Lula" }]; },
      },
      { nameAfterTurns: 2, nameEvery: 2 },
    );
    const events: EngineEvent[] = [];
    for (let i = 0; i < 8; i++) events.push(seg(i + 1, i % 2, i * 12, i * 12 + 11, `c${i}`));
    events.push({ type: "ended", t: 100 });
    await play(s, events);
    const st = s.getState();
    expect(namingCalls).toBeGreaterThanOrEqual(2);
    expect(st.speakers.find((x) => x.id === 0)?.name).toBe("Lula");
    expect(st.utterances.every((u) => u.clips.length === 0)).toBe(true);
  });
});

describe("attribution after naming", () => {
  it("a turn that turns out to call its own speaker by name stops scoring once the name is known", async () => {
    const s = new DebateSession(
      {
        today: "2026-10-23",
        transcribe: async () => "Calma, Lula. Deixa eu te falar, Lula. O desemprego dobrou.",
        analyze: async () => ({ claims: [{ quote: "O desemprego dobrou", query: "desemprego" }], fallacies: [] }),
        search: async () => [],
        judge: async () => ({ verdict: "falso", explanation: "x", confidence: 0.9, sources: [] }),
      },
      { nameAfterTurns: 0 },
    );
    await play(s, [seg(1, 0, 0, 12, "a"), { type: "ended", t: 13 }]);
    expect(s.getState().claims[0].uncertain).toBeFalsy();
    s.renameSpeaker(0, "Lula");
    const st = s.getState();
    expect(st.utterances[0].uncertain).toBe("self-address");
    expect(st.claims[0].uncertain).toBe(true);
  });
});

describe("human review", () => {
  it("moving a doubtful turn to the right voice makes its checks count for that voice", async () => {
    const s = new DebateSession(
      {
        today: "2026-10-23",
        transcribe: async (clip) => (clip === "a" ? "Calma, Lula. O desemprego dobrou." : "Eu governei oito anos."),
        analyze: async (i) => (i.text.includes("desemprego") ? { claims: [{ quote: "O desemprego dobrou", query: "desemprego" }], fallacies: [] } : { claims: [], fallacies: [] }),
        search: async () => [{ title: "t", url: "https://x", snippet: "s" }],
        judge: async () => ({ verdict: "falso", explanation: "x", confidence: 0.9, sources: [] }),
      },
      { nameAfterTurns: 0 },
    );
    await play(s, [seg(1, 1, 0, 6, "b"), seg(2, 0, 7, 12, "a"), { type: "ended", t: 13 }]);
    s.renameSpeaker(0, "Lula");
    s.renameSpeaker(1, "Flávio");
    const doubtful = s.getState().utterances.find((u) => u.speaker === 0)!;
    expect(doubtful.uncertain).toBe("self-address");
    s.reassignTurn(doubtful.id, 1);
    const st = s.getState();
    expect(st.utterances.find((u) => u.id === doubtful.id)).toMatchObject({ speaker: 1, reviewed: true, uncertain: undefined });
    expect(st.claims[0]).toMatchObject({ speaker: 1, uncertain: false });
    expect(st.speakers.find((x) => x.id === 1)!.talkSeconds).toBeCloseTo(11);
    s.renameSpeaker(1, "Flávio Bolsonaro");
    expect(s.getState().utterances.find((u) => u.id === doubtful.id)!.uncertain).toBeUndefined();
  });
});

describe("archive snapshot", () => {
  it("keeps who said what, checks and photos, but no audio and no open turn", async () => {
    const s = new DebateSession(fakeDeps(), { nameAfterTurns: 0 });
    await play(s, [seg(1, 0, 0, 3, "A"), seg(2, 1, 3.2, 9, "B"), { type: "ended", t: 9 }]);
    const snap = toSnapshot({ id: "d1", source: "https://x", startedAt: "2026-10-23T21:00:00Z" }, s.getState(), new Date("2026-10-23T21:05:00Z"));
    expect(snap).toMatchObject({ id: "d1", ended: true, savedAt: "2026-10-23T21:05:00.000Z" });
    expect(snap.utterances.length).toBe(s.getState().utterances.filter((u) => u.closed).length);
    expect(JSON.stringify(snap)).not.toContain("clips");
    expect(snap.claims.every((c) => Array.isArray(c.sources))).toBe(true);
  });
});

describe("merging voices mid-debate", () => {
  it("segments already queued for the merged voice don't bring it back", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = new DebateSession({ ...fakeDeps(), transcribe: async (clip) => { await gate; return `fala ${clip}`; } }, { nameAfterTurns: 0 });
    s.handle(seg(1, 0, 0, 3, "A"));
    s.handle(seg(2, 1, 4, 8, "B"));
    s.handle(seg(3, 1, 9, 12, "C"));
    s.mergeSpeakers(1, 0);
    release();
    await play(s, [{ type: "ended", t: 13 }]);
    const st = s.getState();
    expect(st.speakers.map((x) => x.id)).toEqual([0]);
    expect(st.utterances.every((u) => u.speaker === 0)).toBe(true);
  });
});
