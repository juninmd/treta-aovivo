const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GENERIC = new Set(["falante", "mediador", "mediadora", "candidato", "candidata", "senador", "presidente"]);

/**
 * True when the text addresses the speaker by name ("…está repreendido, Lula."):
 * people don't call themselves, so the turn likely holds someone else's words.
 */
export interface NamedVoice {
  speaker: number;
  name: string;
}

/**
 * Checks name guesses against how each voice talks: people call others by name,
 * not themselves. The usual slip is swapping the two debaters (the voices that
 * talk most), so they swap when that contradicts the transcript less. Then a
 * guess is dropped when its voice is the one calling that name the most.
 */
export function reconcileNames<T extends NamedVoice>(guesses: T[], turns: { speaker: number; text: string; start: number; end: number }[]): T[] {
  const calls = (speaker: number, name: string) => turns.filter((t) => t.speaker === speaker && addressesSelf(t.text, name)).length;
  const talk = (speaker: number) => turns.reduce((sum, t) => sum + (t.speaker === speaker ? t.end - t.start : 0), 0);
  const voices = [...new Set(turns.map((t) => t.speaker))];
  const out = guesses.map((g) => ({ ...g }));
  const [x, y] = [...out].sort((a, b) => talk(b.speaker) - talk(a.speaker));
  if (x && y && calls(x.speaker, y.name) + calls(y.speaker, x.name) < calls(x.speaker, x.name) + calls(y.speaker, y.name)) {
    [x.name, y.name] = [y.name, x.name];
  }
  const contradicted = (g: NamedVoice) => {
    const own = calls(g.speaker, g.name);
    return own > 0 && voices.every((v) => v === g.speaker || calls(v, g.name) <= own);
  };
  return out.filter((g) => !contradicted(g));
}

export function addressesSelf(text: string, speakerName: string): boolean {
  const body = fold(text);
  return fold(speakerName)
    .split(/[^\p{L}]+/u)
    .filter((tok) => tok.length >= 3 && !GENERIC.has(tok))
    // "Eu, Lula, fiz…" introduces oneself; it is not someone else calling Lula.
    .some((tok) => new RegExp(`(?<!\\b(?:eu|sou)\\s*)(?:^|[,.!?;:]\\s*)${escape(tok)}\\s*(?=[,.!?;:]|$)`, "u").test(body));
}
