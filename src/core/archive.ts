import { speakerPhoto } from "./score";
import type { SessionState } from "./session";

export interface DebateMeta {
  id: string;
  source: string;
  startedAt: string;
}

/** A session that never heard a voice (failed start, double click) is not a debate worth a row. */
export const worthArchiving = (st: SessionState) => st.speakers.length > 0;

/** Everything needed to review a debate later (no audio): what the SQLite archive stores. */
export function toSnapshot(meta: DebateMeta, st: SessionState, now = new Date()) {
  return {
    ...meta,
    savedAt: now.toISOString(),
    ended: st.status === "ended",
    duration: st.t,
    speakers: st.speakers.map((s) => ({ id: s.id, name: s.name, photo: speakerPhoto(s) ?? null, talkSeconds: s.talkSeconds })),
    utterances: st.utterances
      .filter((u) => u.closed)
      .map((u) => ({ id: u.id, speaker: u.speaker, start: u.start, end: u.end, text: u.text, uncertain: u.uncertain ?? null, reviewed: !!u.reviewed })),
    claims: st.claims.map((c) => ({
      id: c.id, utteranceId: c.utteranceId, speaker: c.speaker, at: c.at, quote: c.quote, query: c.query, status: c.status,
      verdict: c.verdict ?? null, explanation: c.explanation ?? null, confidence: c.confidence ?? null, sources: c.sources ?? [], uncertain: !!c.uncertain,
    })),
    fallacies: st.fallacies.map((f) => ({
      id: f.id, utteranceId: f.utteranceId, speaker: f.speaker, at: f.at, kind: f.kind, quote: f.quote, explanation: f.explanation, uncertain: !!f.uncertain,
    })),
  };
}

export type Snapshot = ReturnType<typeof toSnapshot>;
