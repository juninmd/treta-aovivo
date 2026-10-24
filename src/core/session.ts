import { APICallError, RetryError } from "ai";
import type { Analysis, AnalyzeInput } from "./analyze";
import type { Judgement, JudgeInput } from "./factcheck";
import { addressesSelf, reconcileNames } from "./attribution";
import { createLimiter } from "./limiter";
import { diversify } from "./search";
import { defaultName, type NameGuess } from "./names";
import { DEFAULT_TURN_POLICY, TurnBuilder, type TurnPolicy } from "./turns";
import type { Claim, EngineEvent, Fallacy, Portrait, SearchResult, SegmentEvent, Speaker, Timing, Utterance } from "./types";

export interface SessionDeps {
  transcribe(clipBase64: string, prompt: string): Promise<string>;
  analyze(input: AnalyzeInput): Promise<Analysis>;
  search(query: string): Promise<SearchResult[]>;
  judge(input: JudgeInput): Promise<Judgement>;
  suggestNames?(utterances: Utterance[], speakerIds: number[]): Promise<NameGuess[]>;
  today: string;
  clock?: () => number;
}

export interface SessionOptions {
  turnPolicy?: TurnPolicy;
  contextTurns?: number;
  analyzeConcurrency?: number;
  checkConcurrency?: number;
  /** Closed turns after which voices get auto-named (0 disables). */
  nameAfterTurns?: number;
  /** Retry naming every N closed turns while a voice that talks still has a placeholder name. */
  nameEvery?: number;
}

export interface SessionState {
  status: "idle" | "running" | "ended";
  source?: string;
  t: number;
  speaking: boolean;
  level: number;
  speakers: Speaker[];
  utterances: Utterance[];
  claims: Claim[];
  fallacies: Fallacy[];
  messages: string[];
  errors: string[];
  timings: Timing[];
  pending: number;
}

const MAX_PORTRAITS = 8;
/** Voices that barely talked (blips, applause) don't keep re-triggering name inference. */
const MIN_NAMED_TALK_SECS = 20;
/** Less speech than this on a voice is likely a fragment of another voice (a 3 s blip): its turns don't score yet. */
const MIN_SCORED_TALK_SECS = 10;
/** Error message; provider failures also carry the start of the response body ("Invalid JSON response" alone says nothing). */
export function errText(e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") return "o provedor não respondeu a tempo";
  const msg = e instanceof Error ? e.message : String(e);
  const last = RetryError.isInstance(e) ? e.lastError : e;
  if (!APICallError.isInstance(last) || !last.responseBody) return msg;
  const cause = last.cause instanceof Error ? ` (${last.cause.message.replace(/\s+/g, " ").slice(0, 120)})` : "";
  return `${msg}${cause} — resposta: ${last.responseBody.replace(/\s+/g, " ").slice(0, 160)}`;
}

export class DebateSession {
  private state: SessionState = {
    status: "idle", t: 0, speaking: false, level: 0, speakers: [], utterances: [], claims: [], fallacies: [], messages: [], errors: [], timings: [], pending: 0,
  };
  private listeners = new Set<() => void>();
  private turns: TurnBuilder;
  private asr = createLimiter(1);
  private analysisQueue: ReturnType<typeof createLimiter>;
  private checkQueue: ReturnType<typeof createLimiter>;
  private asrPending = 0;
  private closedTurns = 0;
  private namedByUser = new Set<number>();
  private naming = false;
  /** Merged voice ids: segments already queued under the old id must not revive it. */
  private alias = new Map<number, number>();
  private idleWaiters: (() => void)[] = [];
  private seq = 0;
  private readonly clock: () => number;

  constructor(private deps: SessionDeps, private opts: SessionOptions = {}) {
    this.turns = new TurnBuilder(opts.turnPolicy ?? DEFAULT_TURN_POLICY);
    this.analysisQueue = createLimiter(opts.analyzeConcurrency ?? 1);
    this.checkQueue = createLimiter(opts.checkConcurrency ?? 2);
    this.clock = deps.clock ?? (() => Date.now());
  }

  getState = (): SessionState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  nameOf(id: number): string {
    return this.state.speakers.find((s) => s.id === id)?.name ?? defaultName(id);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.set({ pending: this.state.pending + 1 });
    return p.finally(() => {
      this.set({ pending: this.state.pending - 1 });
      if (this.state.pending === 0) this.idleWaiters.splice(0).forEach((w) => w());
    });
  }

  /** Resolves when every queued transcription, analysis and check has finished. */
  whenIdle(): Promise<void> {
    return this.state.pending === 0 ? Promise.resolve() : new Promise((r) => this.idleWaiters.push(r));
  }

  handle(ev: EngineEvent): void {
    switch (ev.type) {
      case "status":
        return this.set({ messages: [...this.state.messages, ev.message] });
      case "started":
        return this.set({ status: "running", source: ev.source });
      case "activity": {
        // The UI shows whole seconds and the speaking wave; every audio chunk would re-render the whole transcript.
        if (Math.floor(ev.t) !== Math.floor(this.state.t) || ev.speaking !== this.state.speaking) this.set({ t: ev.t, speaking: ev.speaking, level: ev.level });
        if (this.asrPending === 0) {
          const closed = this.turns.tick(ev.t);
          if (closed) this.onClosed(closed);
        }
        return;
      }
      case "segment":
        return this.onSegment(ev);
      case "face":
        return this.onFace(ev.speaker, ev.portrait);
      case "error":
        return this.set({ errors: [...this.state.errors, ev.message] });
      case "ended":
        // Queued behind pending transcriptions; follow-up work is tracked before this task settles.
        void this.track(
          this.asr(async () => {
            const closed = this.turns.close();
            if (closed) this.onClosed(closed);
            this.set({ status: "ended" });
            if (this.opts.nameAfterTurns !== 0) void this.autoName();
          }),
        );
        return;
    }
  }

  private ensureSpeaker(id: number): Speaker[] {
    if (this.state.speakers.some((s) => s.id === id)) return this.state.speakers;
    return [...this.state.speakers, { id, name: defaultName(id), portraits: [], talkSeconds: 0 }].sort((a, b) => a.id - b.id);
  }

  private canonical(id: number): number {
    let seen = 0;
    while (this.alias.has(id) && seen++ < 64) id = this.alias.get(id)!;
    return id;
  }

  private onSegment(raw: SegmentEvent) {
    const seg = { ...raw, speaker: this.canonical(raw.speaker) };
    const before = this.talkOf(seg.speaker);
    const speakers = this.ensureSpeaker(seg.speaker).map((s) => (s.id === seg.speaker ? { ...s, talkSeconds: s.talkSeconds + (seg.end - seg.start) } : s));
    this.set({ speakers, t: Math.max(this.state.t, seg.end) });
    if (before < MIN_SCORED_TALK_SECS && this.talkOf(seg.speaker) >= MIN_SCORED_TALK_SECS) this.refreshAttribution();
    if (!seg.audio) return;
    const clip = seg.audio;
    this.asrPending++;
    void this.track(
      this.asr(async () => {
        const started = this.clock();
        const prompt = this.state.utterances.map((u) => u.text).join(" ").slice(-300);
        try {
          const text = await this.deps.transcribe(clip, prompt);
          this.timing("transcribe", started);
          // A merge may have happened while this segment waited in the queue.
          const { closed, current } = this.turns.add({ id: seg.id, speaker: this.canonical(seg.speaker), start: seg.start, end: seg.end, text, clip, overlap: seg.overlap });
          if (closed) this.onClosed(closed);
          if (current) this.upsertUtterance(current);
        } catch (e) {
          this.set({ errors: [...this.state.errors, `Transcrição falhou (${seg.start.toFixed(0)}s): ${errText(e)}`] });
        } finally {
          this.asrPending--;
        }
      }),
    );
  }

  private onFace(raw: number, portrait: Portrait) {
    const speaker = this.canonical(raw);
    const speakers = this.ensureSpeaker(speaker).map((s) => {
      if (s.id !== speaker) return s;
      const portraits = [...s.portraits, portrait].sort((a, b) => b.faceWidth - a.faceWidth).slice(0, MAX_PORTRAITS);
      return { ...s, portraits };
    });
    this.set({ speakers });
  }

  private timing(stage: Timing["stage"], started: number) {
    this.set({ timings: [...this.state.timings, { stage, ms: this.clock() - started }] });
  }

  private upsertUtterance(u: Utterance) {
    const list = this.state.utterances;
    const i = list.findIndex((x) => x.id === u.id);
    this.set({ utterances: i < 0 ? [...list, u] : list.map((x, j) => (j === i ? u : x)) });
  }

  private talkOf(id: number): number {
    return this.state.speakers.find((s) => s.id === id)?.talkSeconds ?? 0;
  }

  private doubtOf(u: Utterance): Utterance["uncertain"] {
    if (u.reviewed) return undefined;
    if (u.overlap) return "overlap";
    if (addressesSelf(u.text, this.nameOf(u.speaker))) return "self-address";
    return this.talkOf(u.speaker) < MIN_SCORED_TALK_SECS ? "short-voice" : undefined;
  }

  /** Self-address depends on names, which change during a debate: recheck closed turns. */
  private refreshAttribution() {
    const doubt = new Map<string, boolean>();
    const utterances = this.state.utterances.map((u) => {
      if (!u.closed) return u;
      const uncertain = this.doubtOf(u);
      doubt.set(u.id, !!uncertain);
      return uncertain === u.uncertain ? u : { ...u, uncertain };
    });
    const mark = <T extends { utteranceId: string; uncertain?: boolean }>(x: T): T => {
      const v = doubt.get(x.utteranceId) ?? !!x.uncertain;
      return v === !!x.uncertain ? x : { ...x, uncertain: v };
    };
    this.set({ utterances, claims: this.state.claims.map(mark), fallacies: this.state.fallacies.map(mark) });
  }

  private onClosed(closed: Utterance) {
    const uncertain = this.doubtOf(closed);
    const u: Utterance = uncertain ? { ...closed, uncertain } : closed;
    this.upsertUtterance(u);
    this.closedTurns++;
    if (this.namingDue()) void this.autoName();
    const prior = this.state.utterances.filter((x) => x.closed && x.id !== u.id).slice(-(this.opts.contextTurns ?? 4));
    void this.track(
      this.analysisQueue(async () => {
        const started = this.clock();
        try {
          // Read when the task runs: a merge or review may have moved the turn while it waited.
          const a = await this.deps.analyze({
            speakerName: this.nameOf(this.currentSpeaker(u.id) ?? u.speaker),
            text: u.text,
            context: prior.map((p) => ({ name: this.nameOf(this.currentSpeaker(p.id) ?? p.speaker), text: p.text })),
            today: this.deps.today,
          });
          this.timing("analyze", started);
          const speaker = this.currentSpeaker(u.id) ?? u.speaker;
          const latest = this.state.utterances.find((x) => x.id === u.id) ?? u;
          const flag = this.doubtOf(latest) ? { uncertain: true } : {};
          const fallacies: Fallacy[] = a.fallacies.map((f) => ({ ...f, ...flag, id: `f${++this.seq}`, utteranceId: u.id, speaker, at: u.start }));
          const claims: Claim[] = a.claims.map((c) => ({ ...c, ...flag, id: `c${++this.seq}`, utteranceId: u.id, speaker, at: u.start, status: "searching" }));
          this.set({ fallacies: [...this.state.fallacies, ...fallacies], claims: [...this.state.claims, ...claims] });
          // Audio is only replayed for moments; a live debate would otherwise keep hours of it in memory.
          if (!claims.length && !fallacies.length) this.dropClips(u.id);
          claims.forEach((c) => void this.track(this.checkQueue(() => this.check(c, u.text))));
        } catch (e) {
          this.set({ errors: [...this.state.errors, `Análise falhou (${u.start.toFixed(0)}s): ${errText(e)}`] });
        }
      }),
    );
  }

  private dropClips(utteranceId: string) {
    this.set({ utterances: this.state.utterances.map((x) => (x.id === utteranceId && x.closed ? { ...x, clips: [] } : x)) });
  }

  private namingDue(): boolean {
    const { nameAfterTurns: first = 0, nameEvery = 20 } = this.opts;
    const n = this.closedTurns;
    if (!first || n < first) return false;
    // Later runs see more of the debate and may correct an early guess.
    const unsettled = this.state.speakers.some((s) => !this.namedByUser.has(s.id) && s.talkSeconds >= MIN_NAMED_TALK_SECS);
    return n === first || (unsettled && (n - first) % nameEvery === 0);
  }

  private currentSpeaker(utteranceId: string): number | undefined {
    return this.state.utterances.find((x) => x.id === utteranceId)?.speaker;
  }

  private patchClaim(id: string, patch: Partial<Claim>) {
    this.set({ claims: this.state.claims.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }

  /**
   * Evidence from the claim's own search and from a second one aimed at the primary source, so
   * that pages repeating the claim don't decide alone. One of them failing still leaves evidence.
   */
  private async gather(c: Claim): Promise<SearchResult[]> {
    const queries = [c.query, c.counterQuery?.trim()].filter((q, i, all): q is string => !!q && all.indexOf(q) === i);
    const settled = await Promise.allSettled(queries.map((q) => this.deps.search(q)));
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
    return diversify(ok);
  }

  private async check(c: Claim, utterance: string) {
    const started = this.clock();
    try {
      let results = await this.gather(c);
      if (!results.length) results = await this.deps.search(c.quote);
      this.patchClaim(c.id, { status: "judging" });
      const j = await this.deps.judge({ quote: c.quote, utterance, results, today: this.deps.today });
      this.patchClaim(c.id, { status: "done", verdict: j.verdict, explanation: j.explanation, confidence: j.confidence, sources: j.sources });
      this.timing("factcheck", started);
    } catch (e) {
      this.patchClaim(c.id, { status: "error", error: errText(e) });
    }
  }

  private async autoName() {
    if (!this.deps.suggestNames || this.naming) return;
    const ids = this.state.speakers.map((s) => s.id).filter((id) => !this.namedByUser.has(id));
    const closed = this.state.utterances.filter((u) => u.closed);
    if (!ids.length || !closed.length) return;
    this.naming = true;
    try {
      const guesses = reconcileNames(await this.track(this.deps.suggestNames(closed, ids)), closed);
      const byId = new Map(guesses.map((g) => [g.speaker, g.name]));
      this.set({ speakers: this.state.speakers.map((s) => (byId.has(s.id) && !this.namedByUser.has(s.id) ? { ...s, name: byId.get(s.id)! } : s)) });
      this.refreshAttribution();
    } catch (e) {
      this.set({ errors: [...this.state.errors, `Sugestão de nomes falhou: ${errText(e)}`] });
    } finally {
      this.naming = false;
    }
  }

  suggestNamesNow(): Promise<void> {
    return this.autoName();
  }

  renameSpeaker(id: number, name: string) {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    this.namedByUser.add(id);
    this.set({ speakers: this.state.speakers.map((s) => (s.id === id ? { ...s, name: n } : s)) });
    this.refreshAttribution();
  }

  setPhoto(id: number, photo: string | undefined) {
    this.set({ speakers: this.state.speakers.map((s) => (s.id === id ? { ...s, photo } : s)) });
  }

  /** Human review of who said a closed turn: moves it (and its checks) and makes it count. */
  reassignTurn(utteranceId: string, speaker: number) {
    const u = this.state.utterances.find((x) => x.id === utteranceId);
    if (!u?.closed || !this.state.speakers.some((s) => s.id === speaker)) return;
    const secs = u.speech ?? u.end - u.start;
    const move = <T extends { utteranceId: string; speaker: number; uncertain?: boolean }>(x: T): T => (x.utteranceId === utteranceId ? { ...x, speaker, uncertain: false } : x);
    this.set({
      speakers: this.state.speakers.map((s) =>
        s.id === u.speaker && s.id !== speaker ? { ...s, talkSeconds: Math.max(0, s.talkSeconds - secs) } : s.id === speaker && u.speaker !== speaker ? { ...s, talkSeconds: s.talkSeconds + secs } : s,
      ),
      utterances: this.state.utterances.map((x) => (x.id === utteranceId ? { ...x, speaker, uncertain: undefined, reviewed: true } : x)),
      claims: this.state.claims.map(move),
      fallacies: this.state.fallacies.map(move),
    });
  }

  /** Folds voice `from` into `into` everywhere (the engine is told separately). */
  mergeSpeakers(from: number, into: number) {
    const a = this.state.speakers.find((s) => s.id === from);
    const b = this.state.speakers.find((s) => s.id === into);
    if (!a || !b || from === into) return;
    this.alias.set(from, into);
    this.turns.remap(from, into);
    const re = <T extends { speaker: number }>(x: T): T => (x.speaker === from ? { ...x, speaker: into } : x);
    this.set({
      speakers: this.state.speakers
        .filter((s) => s.id !== from)
        .map((s) => (s.id === into ? { ...s, talkSeconds: s.talkSeconds + a.talkSeconds, portraits: [...s.portraits, ...a.portraits].slice(0, MAX_PORTRAITS) } : s)),
      utterances: this.state.utterances.map(re),
      claims: this.state.claims.map(re),
      fallacies: this.state.fallacies.map(re),
    });
    this.refreshAttribution();
  }
}
