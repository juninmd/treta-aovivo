import { describe, expect, it } from "vitest";
import { groundAnalysis } from "./analyze";
import { worthArchiving } from "./archive";
import { reconcileNames } from "./attribution";
import { scoreboard } from "./score";
import { DebateSession, type SessionDeps } from "./session";
import type { EngineEvent } from "./types";

const seg = (id: number, speaker: number, start: number, end: number, audio: string, overlap = false): EngineEvent => ({
  type: "segment", id, speaker, start, end, similarity: 0.8, newSpeaker: false, audio, overlap,
});

const settle = () => new Promise((r) => setTimeout(r, 0));

function deps(texts: Record<string, string>, overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    today: "2026-10-24",
    transcribe: async (clip) => texts[clip] ?? "",
    analyze: async (i) =>
      i.text.includes("nunca trabalhou")
        ? { claims: [{ quote: "a inflação passou de 15%", query: "inflação 2025" }], fallacies: [{ kind: "ad hominem", quote: "O senhor nunca trabalhou na vida", explanation: "ataca a pessoa" }] }
        : { claims: [], fallacies: [] },
    search: async () => [{ title: "IPCA", url: "https://example.org", snippet: "4,8%" }],
    judge: async () => ({ verdict: "falso", explanation: "x", confidence: 0.9, sources: [] }),
    ...overrides,
  };
}

const ATTACK = "O senhor nunca trabalhou na vida e a inflação passou de 15%.";

describe("work queued before a merge", () => {
  it("is analysed under the surviving voice's name and judged without any name", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const analyzed: string[] = [];
    const judged: unknown[] = [];
    const base = deps({ A: "Boa noite a todos, começa o debate.", B: ATTACK, C: "Tempo." });
    const s = new DebateSession(
      { ...base, analyze: async (i) => { analyzed.push(i.speakerName); await gate; return base.analyze(i); }, judge: async (i) => { judged.push(i); return base.judge(i); } },
      { nameAfterTurns: 0 },
    );
    [{ type: "started", source: "t" } as EngineEvent, seg(1, 0, 0, 3, "A"), seg(2, 1, 3.5, 9, "B"), seg(3, 0, 9.5, 11, "C")].forEach((e) => s.handle(e));
    await settle();
    s.renameSpeaker(0, "Lula");
    s.mergeSpeakers(1, 0);
    release();
    s.handle({ type: "ended", t: 11 });
    await settle();
    await s.whenIdle();
    expect(analyzed.slice(1)).toEqual(["Lula", "Lula"]);
    expect(judged).toHaveLength(1);
    expect(JSON.stringify(judged)).not.toContain("Lula");
  });
});

describe("human review of who spoke", () => {
  it("moving a turn moves only the speech in it, so total talk time is conserved", async () => {
    const s = new DebateSession(deps({ A: "Primeira parte.", A2: "Segunda parte.", C: "Resposta." }), { nameAfterTurns: 0 });
    // Two segments of one turn with a 1 s pause between them, then another voice.
    [{ type: "started", source: "t" } as EngineEvent, seg(1, 0, 0, 4, "A"), seg(2, 0, 5, 9, "A2"), seg(3, 1, 10, 11, "C"), { type: "ended", t: 11 } as EngineEvent].forEach((e) => s.handle(e));
    await settle();
    await s.whenIdle();
    const total = () => s.getState().speakers.reduce((n, sp) => n + sp.talkSeconds, 0);
    const before = total();
    s.reassignTurn(s.getState().utterances[0].id, 1);
    expect(total()).toBe(before);
    expect(s.getState().speakers.map((sp) => sp.talkSeconds)).toEqual([0, 9]);
  });
});

describe("crosstalk and names", () => {
  it("a crosstalk turn is no evidence against a voice's name", () => {
    const guesses = [{ speaker: 0, name: "Marta" }, { speaker: 1, name: "Helena" }, { speaker: 2, name: "Rafael" }];
    const turns = [
      { speaker: 0, text: "Candidata Helena, a pergunta é sua.", start: 0, end: 5 },
      { speaker: 1, text: "Boa noite, Marta. Rafael, a tarifa subiu.", start: 5, end: 40 },
      { speaker: 2, text: "Helena, você não respondeu.", start: 40, end: 90 },
      // Helena's words picked up on Rafael's voice while both talked.
      { speaker: 2, text: "Deixa eu terminar, Rafael.", start: 90, end: 93, overlap: true },
    ];
    expect(reconcileNames(guesses, turns).map((g) => g.name)).toEqual(["Marta", "Helena", "Rafael"]);
  });
});

describe("voices that barely spoke", () => {
  it("a few seconds on a voice of its own don't score until it talks more or a person confirms it", async () => {
    const s = new DebateSession(deps({ A: "Pergunta do mediador sobre segurança pública na cidade.", B: ATTACK, M: "Mais uma fala longa do mesmo falante sobre o tema." }), { nameAfterTurns: 0 });
    [{ type: "started", source: "t" } as EngineEvent, seg(1, 0, 0, 12, "A"), seg(2, 1, 12.5, 15, "B"), seg(3, 0, 16, 20, "A")].forEach((e) => s.handle(e));
    await settle();
    await s.whenIdle();
    let st = s.getState();
    expect(st.utterances[1].uncertain).toBe("short-voice");
    expect(scoreboard(st.speakers, st.claims, st.fallacies).find((r) => r.speaker === 1)?.points).toBe(0);
    // The voice keeps talking: it is a real participant and its earlier attack counts.
    [seg(4, 1, 21, 33, "M"), { type: "ended", t: 33 } as EngineEvent].forEach((e) => s.handle(e));
    await settle();
    await s.whenIdle();
    st = s.getState();
    expect(st.utterances[1].uncertain).toBeUndefined();
    expect(scoreboard(st.speakers, st.claims, st.fallacies).find((r) => r.speaker === 1)?.points).toBe(-5);
  });
});

describe("live rendering", () => {
  it("engine activity notifies the UI about once per second, not on every audio chunk", () => {
    const s = new DebateSession(deps({}), { nameAfterTurns: 0 });
    let renders = 0;
    s.subscribe(() => renders++);
    for (let t = 0; t < 10; t += 0.25) s.handle({ type: "activity", t, speaking: true, level: 0.3 });
    expect(renders).toBeLessThanOrEqual(11);
    expect(s.getState().t).toBeGreaterThanOrEqual(9);
  });
});

describe("archive", () => {
  it("a debate that never heard a voice (failed start, double click) leaves no row behind", async () => {
    const s = new DebateSession(deps({ A: "Boa noite." }), { nameAfterTurns: 0 });
    expect(worthArchiving(s.getState())).toBe(false);
    s.handle({ type: "started", source: "t" });
    s.handle({ type: "ended", t: 0 });
    await settle();
    await s.whenIdle();
    expect(worthArchiving(s.getState())).toBe(false);
    const heard = new DebateSession(deps({ A: "Boa noite." }), { nameAfterTurns: 0 });
    heard.handle(seg(1, 0, 0, 2, "A"));
    expect(worthArchiving(heard.getState())).toBe(true);
  });
});

describe("grounding fallacies", () => {
  it("a two-word fragment is not enough to accuse anyone of a fallacy", () => {
    const text = "Só você. Você é o único culpado por essa crise toda.";
    const raw = {
      claims: [],
      fallacies: [
        { kind: "ad hominem" as const, quote: "Só você", explanation: "chama de ladrão no contexto implícito" },
        { kind: "ad hominem" as const, quote: "Você é o único culpado por essa crise", explanation: "ataca a pessoa" },
      ],
    };
    expect(groundAnalysis(text, raw).fallacies.map((f) => f.quote)).toEqual(["Você é o único culpado por essa crise"]);
  });
});
