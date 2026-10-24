import type { Utterance } from "./types";

export interface TurnPolicy {
  /** Max silence (s) between two segments of the same voice to keep one turn. */
  maxGap: number;
  /** Turns longer than this (s) are closed so analysis does not lag behind. */
  maxDuration: number;
  /** Audio time (s) without new speech after which the open turn closes. */
  idleClose: number;
}

export const DEFAULT_TURN_POLICY: TurnPolicy = { maxGap: 1.5, maxDuration: 30, idleClose: 3 };

export interface SegmentText {
  id: number;
  speaker: number;
  start: number;
  end: number;
  text: string;
  clip?: string | null;
  overlap?: boolean;
}

export interface TurnUpdate {
  closed?: Utterance;
  current?: Utterance;
}

/** Groups consecutive transcribed segments of the same voice into turns. */
export class TurnBuilder {
  private open?: Utterance;
  private seq = 0;

  constructor(private readonly policy: TurnPolicy = DEFAULT_TURN_POLICY) {}

  add(seg: SegmentText): TurnUpdate {
    if (!seg.text.trim()) return { current: this.open };
    const o = this.open;
    const joins =
      o && o.speaker === seg.speaker && seg.start - o.end <= this.policy.maxGap && seg.end - o.start <= this.policy.maxDuration;
    if (o && joins) {
      this.open = {
        ...o,
        end: Math.max(o.end, seg.end),
        speech: (o.speech ?? 0) + (seg.end - seg.start),
        text: `${o.text} ${seg.text.trim()}`,
        segmentIds: [...o.segmentIds, seg.id],
        clips: seg.clip ? [...o.clips, seg.clip] : o.clips,
        overlap: o.overlap || seg.overlap,
      };
      return { current: this.open };
    }
    const closed = this.close();
    this.open = {
      id: `u${++this.seq}`,
      speaker: seg.speaker,
      start: seg.start,
      end: seg.end,
      speech: seg.end - seg.start,
      text: seg.text.trim(),
      segmentIds: [seg.id],
      clips: seg.clip ? [seg.clip] : [],
      closed: false,
      overlap: seg.overlap,
    };
    return { closed, current: this.open };
  }

  /** Closes the open turn when the audio clock moved past it with no new speech. */
  tick(t: number): Utterance | undefined {
    return this.open && t - this.open.end >= this.policy.idleClose ? this.close() : undefined;
  }

  close(): Utterance | undefined {
    const o = this.open;
    this.open = undefined;
    return o ? { ...o, closed: true } : undefined;
  }

  /** Rewrites speaker ids after a merge so the open turn keeps up. */
  remap(from: number, into: number): void {
    if (this.open?.speaker === from) this.open = { ...this.open, speaker: into };
  }
}
