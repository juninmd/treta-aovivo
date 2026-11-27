/**
 * OLD markup, kept for the before/after preview only.
 * Source: `git show origin/main:src/ui/Transcript.tsx` @ 1f79fa1 — the speaker
 * filter (lines 79-84), the empty note (87-89) and the speaking wave (120, 139).
 * No app code imports this file.
 */
export function LegacySpeakerFilter() {
  return (
    <div className="filters" role="group" aria-label="Filtrar por falante">
      <button type="button" aria-pressed="false">Todos</button>
      <button type="button" aria-pressed="true">Marta Lins</button>
      <button type="button" aria-pressed="false">Helena Prado</button>
      <button type="button" aria-pressed="false">Rafael Teixeira</button>
    </div>
  );
}

export function LegacyEmptyNote() {
  return <p className="empty">Ouvindo… a primeira fala aparece alguns segundos depois de terminar.</p>;
}

export function LegacySpeakingWave() {
  return (
    <div className="turn" style={{ ["--c" as string]: "var(--s2)" }}>
      <div className="side"><span className="t">00:19</span></div>
      <div>
        <span className="who">Helena Prado</span>
        <span className="wave" aria-hidden="true"><span /><span /><span /><span /></span>
        <p>…a tarifa de ônibus subiu 30% em dois anos.</p>
      </div>
    </div>
  );
}
