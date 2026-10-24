/**
 * Stand-in for @tauri-apps/api/core while capturing README screenshots: a scripted
 * engine plays the fictional debate and the other commands answer with canned data.
 */
import type { EngineEvent } from "../../../src/core/types";
import { CLAIMS, LINES } from "../fixture";
import { portraitsFor } from "../portraits";

export class Channel<T> {
  onmessage: (message: T) => void = () => {};
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A short silent WAV whose first sample is the line index; the fake transcription reads it back. */
export function lineWav(index: number): string {
  const samples = 160;
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
  b.setInt16(44, index, true);
  return btoa(String.fromCharCode(...new Uint8Array(b.buffer)));
}

async function playDebate(channel: Channel<EngineEvent>) {
  const emit = (e: EngineEvent) => channel.onmessage(e);
  emit({ type: "started", source: "demo" });
  const seen = new Set<number>();
  for (const [i, line] of LINES.entries()) {
    const first = !seen.has(line.speaker);
    if (first) {
      seen.add(line.speaker);
      portraitsFor(line.speaker).forEach((portrait) => emit({ type: "face", speaker: line.speaker, t: line.start, portrait }));
    }
    for (let t = line.start; t < line.end; t += 1) emit({ type: "activity", t, speaking: true, level: 0.4 });
    emit({ type: "segment", id: i + 1, speaker: line.speaker, start: line.start, end: line.end, similarity: 0.82, newSpeaker: first, overlap: line.overlap, audio: lineWav(i) });
    await wait(150);
  }
  // Silence after the last line closes the open turn.
  const last = LINES[LINES.length - 1].end;
  for (let t = last; t <= last + 6; t += 1) {
    emit({ type: "activity", t, speaking: false, level: 0 });
    await wait(200);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** DuckDuckGo-shaped result page for a claim's query (or its quote, the fallback search). */
function ddgPage(q: string): string {
  const claim = CLAIMS.find((c) => c.query === q || c.quote === q);
  const blocks = (claim?.results ?? []).map(
    (r) =>
      `<div class="result results_links results_links_deep web-result "><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}">${esc(r.title)}</a></h2><a class="result__snippet" href="#">${esc(r.snippet)}</a></div>`,
  );
  return `<div id="links" class="results">${blocks.join("")}</div>`;
}

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const answer = (v: unknown) => v as T;
  switch (cmd) {
    case "start_engine":
      void playDebate(args.onEvent as Channel<EngineEvent>);
      return answer(undefined);
    case "stop_engine":
    case "secret_set":
      return answer(undefined);
    case "merge_speakers":
      return answer(true);
    case "check_tools":
      return answer({ ytDlp: true, ffmpeg: true });
    case "secret_get":
      return answer(null);
    case "save_debate":
      return answer("treta.sqlite");
    case "search_page":
      return answer({ status: 200, body: ddgPage(new URL(String(args.url)).searchParams.get("q") ?? "") });
  }
  throw new Error(`demo has no command ${cmd}`);
}
