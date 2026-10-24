import { describe, expect, it } from "vitest";
import { createDebateSession, type PipelineConfig } from "./pipeline";
import type { FetchFn } from "./providers";

/** 0.1 s of 16 kHz mono silence as a base64 WAV, the shape the engine sends. */
function silentWav(): string {
  const samples = 1600;
  const b = new DataView(new ArrayBuffer(44 + samples * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  b.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true);
  b.setUint32(28, 32000, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  text(36, "data");
  b.setUint32(40, samples * 2, true);
  return btoa(String.fromCharCode(...new Uint8Array(b.buffer)));
}

const cfg: PipelineConfig = {
  llm: { preset: "custom", baseURL: "http://llm.test/v1", model: "m" },
  asr: { preset: "custom", baseURL: "http://asr.test/v1", model: "w", language: "pt" },
  search: { provider: "duckduckgo" },
  today: "2026-10-24",
};

describe("providers that stop answering", () => {
  it("a hung LLM call times out and the debate keeps going instead of freezing", async () => {
    // Transcription answers; the LLM accepts the request and never replies (only an abort ends it).
    const fetchFn: FetchFn = async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes("/audio/transcriptions")) {
        return Response.json({ text: "A inflação passou de 15% no ano passado." });
      }
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    };
    const { session } = createDebateSession(cfg, fetchFn, { nameAfterTurns: 0 }, { asrMs: 2000, llmMs: 50, searchMs: 50, namesMs: 50 });
    session.handle({ type: "started", source: "test" });
    session.handle({ type: "segment", id: 1, speaker: 0, start: 0, end: 4, similarity: 0.9, newSpeaker: true, audio: silentWav() });
    session.handle({ type: "ended", t: 4 });
    await new Promise((r) => setTimeout(r, 0));
    await session.whenIdle();
    const st = session.getState();
    expect(st.utterances).toHaveLength(1);
    expect(st.errors.join(" ")).toMatch(/Análise falhou.*não respondeu a tempo/);
  });
});
