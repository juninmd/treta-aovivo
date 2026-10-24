import type { Claim, Fallacy, Portrait, Speaker, Verdict } from "./types";

export const POINTS: Record<Verdict, number> & { adHominem: number; otherFallacy: number } = {
  verdadeiro: 2,
  impreciso: 0,
  enganoso: -1,
  "sem evidência": -1,
  falso: -3,
  adHominem: -2,
  otherFallacy: -1,
};

export interface BoardRow {
  speaker: number;
  points: number;
  lies: number;
  misleading: number;
  imprecise: number;
  truths: number;
  unproven: number;
  adHominem: number;
  otherFallacies: number;
  talkSeconds: number;
}

export function scoreboard(speakers: Speaker[], claims: Claim[], fallacies: Fallacy[]): BoardRow[] {
  const rows = new Map<number, BoardRow>(
    speakers.map((s) => [
      s.id,
      { speaker: s.id, points: 0, lies: 0, misleading: 0, imprecise: 0, truths: 0, unproven: 0, adHominem: 0, otherFallacies: 0, talkSeconds: s.talkSeconds },
    ]),
  );
  for (const c of claims) {
    const r = rows.get(c.speaker);
    if (!r || c.status !== "done" || !c.verdict || c.uncertain) continue;
    r.points += POINTS[c.verdict];
    if (c.verdict === "falso") r.lies++;
    else if (c.verdict === "enganoso") r.misleading++;
    else if (c.verdict === "impreciso") r.imprecise++;
    else if (c.verdict === "verdadeiro") r.truths++;
    else r.unproven++;
  }
  for (const f of fallacies) {
    const r = rows.get(f.speaker);
    if (!r || f.uncertain) continue;
    if (f.kind === "ad hominem") {
      r.adHominem++;
      r.points += POINTS.adHominem;
    } else {
      r.otherFallacies++;
      r.points += POINTS.otherFallacy;
    }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.talkSeconds - a.talkSeconds);
}

function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Portrait most similar to the others (medoid by perceptual hash): cutaways
 * to the opponent or the audience are outliers, the speaker's own shot repeats.
 */
/**
 * Below this many shots a voice gets no automatic photo: moderators talk over
 * cutaways to the candidates, and with one or two shots a cutaway can't be
 * outvoted. The shots stay available as suggestions in the speaker dialog.
 */
export const MIN_AUTO_PORTRAITS = 3;

export function bestPortrait(portraits: Portrait[]): Portrait | undefined {
  if (portraits.length < MIN_AUTO_PORTRAITS) return undefined;
  let best: Portrait | undefined;
  let bestCost = Infinity;
  for (const p of portraits) {
    const cost = portraits.reduce((sum, q) => sum + (q === p ? 0 : hamming(p.hash, q.hash)), 0) - p.faceWidth;
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
  }
  return best;
}

export const speakerPhoto = (s: Speaker): string | undefined => s.photo ?? bestPortrait(s.portraits)?.image;
