/**
 * OLD markup, kept for the before/after preview only.
 * Source: `git show origin/main:src/ui/Checks.tsx` @ 1f79fa1 — the verdict badge
 * (`<span className="stamp" data-v=…>`, lines 26-28).
 * No app code imports this file.
 */
const VERDICTS = ["verdadeiro", "impreciso", "enganoso", "falso", "sem evidência"] as const;

export function LegacyVerdictStamps() {
  return (
    <div className="pv-stack">
      <article className="check">
        <header>
          <span className="who-line"><span className="spk">Helena Prado · 00:19</span></span>
          <span className="stamp" data-v="falso">falso</span>
        </header>
        <blockquote>“O desemprego em Vila Aurora é o maior da região, 14%.”</blockquote>
      </article>
      <div className="pv-chips">
        {VERDICTS.map((v) => <span key={v} className="stamp" data-v={v}>{v}</span>)}
        <span className="stamp" data-v="checando">buscando…</span>
        <span className="stamp" data-v="erro">falhou</span>
      </div>
    </div>
  );
}
