/**
 * OLD markup, kept for the before/after preview only.
 * Source: `git show origin/main:src/App.tsx` @ 1f79fa1 — the tally pill inside
 * `<header className={`bar ${d.running ? "live" : ""}`}>` (line 57).
 * No app code imports this file.
 */
export function LegacyLiveBadge({ running, ended }: { running: boolean; ended: boolean }) {
  return (
    <div className={running ? "live" : ""}>
      <span className="onair"><i />{running ? "AO VIVO" : ended ? "ENCERRADO" : "PARADO"}</span>
    </div>
  );
}
