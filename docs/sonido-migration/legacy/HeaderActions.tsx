/**
 * OLD markup, kept for the before/after preview only.
 * Source: `git show origin/main:src/App.tsx` @ 1f79fa1 — header actions (lines
 * 72-79) and the inline "fechar" of the error banner (line 90).
 * No app code imports this file.
 */
export function LegacyHeaderActions() {
  return (
    <div className="source">
      <button type="button" className="btn primary">Iniciar</button>
      <button type="button" className="btn" disabled>Melhores momentos</button>
      <button type="button" className="btn">Configurar</button>
      <p className="banner err" role="alert">
        Não consegui abrir o link do debate. <button type="button" className="link">fechar</button>
      </p>
    </div>
  );
}
