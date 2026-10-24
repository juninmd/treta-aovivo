/** Finds where a model-quoted snippet sits in the original transcript text. */

function fold(ch: string): string {
  return ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Normalised text plus, for each normalised char, its index in the original. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const c = fold(text[i]);
    if (/[a-z0-9]/.test(c)) {
      norm += c;
      map.push(i);
      lastSpace = false;
    } else if (!lastSpace) {
      norm += " ";
      map.push(i);
      lastSpace = true;
    }
  }
  return { norm: norm.trimEnd(), map };
}

export interface QuoteMatch {
  start: number;
  end: number;
  text: string;
}

/** Exact match after folding case, accents and punctuation. */
export function locateQuote(text: string, quote: string): QuoteMatch | null {
  const t = normalizeWithMap(text);
  const q = normalizeWithMap(quote).norm.trim();
  if (q.length < 3) return null;
  const at = t.norm.indexOf(q);
  if (at < 0) return null;
  const start = t.map[at];
  let end = t.map[at + q.length - 1] + 1;
  // Folding drops symbols, so "14%" would come back as "14": keep a unit glued to a final number.
  if (/\d/.test(text[end - 1]) && /[%‰°ºª]/.test(text[end] ?? "")) end++;
  return { start, end, text: text.slice(start, end) };
}

/** Share of the quote's words that appear in the text (0..1). */
export function quoteOverlap(text: string, quote: string): number {
  const words = (s: string) => normalizeWithMap(s).norm.split(" ").filter((w) => w.length > 2);
  const have = new Set(words(text));
  const q = words(quote);
  if (!q.length) return 0;
  return q.filter((w) => have.has(w)).length / q.length;
}
