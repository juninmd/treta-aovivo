import type { LanguageModel } from "ai";
import { analyzeUtterance } from "./analyze";
import { judgeClaim } from "./factcheck";
import { suggestSpeakerNames } from "./names";
import { languageModel, transcriptionModel, type Endpoint, type FetchFn } from "./providers";
import { createSearch, type SearchSettings } from "./search";
import { DebateSession, type SessionOptions } from "./session";
import { transcribeClip } from "./transcribe";

export interface PipelineConfig {
  llm: Endpoint;
  asr: Endpoint & { language: string };
  search: SearchSettings;
  today: string;
  /** Names the user expects in the debate; steers speaker naming. */
  participants?: string[];
}

/** Upper bounds per call: the queues run one task at a time, so one hung request would stall the debate. */
export interface CallLimits {
  asrMs: number;
  llmMs: number;
  searchMs: number;
  namesMs: number;
}

export const CALL_LIMITS: CallLimits = { asrMs: 60_000, llmMs: 90_000, searchMs: 45_000, namesMs: 120_000 };

/** Wires AI SDK models and the search provider into a session (same code in app and CLI). */
export function createDebateSession(
  cfg: PipelineConfig,
  fetchFn: FetchFn,
  opts: SessionOptions = {},
  limits: CallLimits = CALL_LIMITS,
): { session: DebateSession; llm: LanguageModel } {
  const llm = languageModel(cfg.llm, fetchFn);
  const asr = transcriptionModel(cfg.asr, fetchFn);
  const search = createSearch(cfg.search, fetchFn);
  const session = new DebateSession(
    {
      today: cfg.today,
      transcribe: (clip, prompt) => transcribeClip(asr, clip, { language: cfg.asr.language, prompt, abortSignal: AbortSignal.timeout(limits.asrMs) }),
      analyze: (input) => analyzeUtterance(llm, input, AbortSignal.timeout(limits.llmMs)),
      search: (q) => search.search(q, AbortSignal.timeout(limits.searchMs)),
      judge: (input) => judgeClaim(llm, input, AbortSignal.timeout(limits.llmMs)),
      suggestNames: (utterances, ids) => suggestSpeakerNames(llm, utterances, ids, cfg.participants, AbortSignal.timeout(limits.namesMs)),
    },
    { nameAfterTurns: 8, ...opts },
  );
  return { session, llm };
}

/** Local calendar date (a debate at 22h in Brazil is still "today"). */
export const todayISO = (d = new Date()) => d.toLocaleDateString("sv-SE");
