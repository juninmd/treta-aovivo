export const VERDICTS = ["verdadeiro", "impreciso", "enganoso", "falso", "sem evidência"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const FALLACY_KINDS = [
  "ad hominem",
  "espantalho",
  "falso dilema",
  "apelo à emoção",
  "generalização apressada",
  "whataboutism",
  "ladeira escorregadia",
  "apelo à autoridade",
] as const;
export type FallacyKind = (typeof FALLACY_KINDS)[number];

/** Events emitted by the Rust voice engine (one JSON object each). */
export interface Portrait {
  image: string;
  score: number;
  faceWidth: number;
  hash: string;
}

export type EngineEvent =
  | { type: "status"; message: string }
  | { type: "started"; source: string }
  | { type: "activity"; t: number; speaking: boolean; level: number }
  | { type: "segment"; id: number; speaker: number; start: number; end: number; similarity: number; newSpeaker: boolean; overlap?: boolean; audio?: string | null }
  | { type: "face"; speaker: number; t: number; portrait: Portrait }
  | { type: "error"; message: string }
  | { type: "ended"; t: number };

export type SegmentEvent = Extract<EngineEvent, { type: "segment" }>;

export interface Speaker {
  id: number;
  name: string;
  /** Photo chosen by the user; always wins over captured portraits. */
  photo?: string;
  portraits: Portrait[];
  talkSeconds: number;
}

export interface Utterance {
  id: string;
  speaker: number;
  start: number;
  end: number;
  text: string;
  segmentIds: number[];
  /** Base64 WAV per segment, kept for "Ouvir" in highlights. */
  clips: string[];
  closed: boolean;
  /** The engine heard two voices at once in this turn. */
  overlap?: boolean;
  /** Seconds of speech in the turn (its segments, without the pauses between them). */
  speech?: number;
  /** Why the speaker of this turn is doubtful; its claims and fallacies don't score. */
  uncertain?: "overlap" | "self-address" | "short-voice";
  /** A person confirmed or corrected who said this; it always scores. */
  reviewed?: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface Claim {
  id: string;
  utteranceId: string;
  speaker: number;
  at: number;
  quote: string;
  query: string;
  /** Attribution doubtful (crosstalk); shown but not scored. */
  uncertain?: boolean;
  status: "searching" | "judging" | "done" | "error";
  verdict?: Verdict;
  explanation?: string;
  confidence?: number;
  sources?: SearchResult[];
  error?: string;
}

export interface Fallacy {
  id: string;
  utteranceId: string;
  speaker: number;
  at: number;
  kind: FallacyKind;
  quote: string;
  explanation: string;
  uncertain?: boolean;
}

export interface Timing {
  stage: "transcribe" | "analyze" | "factcheck";
  ms: number;
}
