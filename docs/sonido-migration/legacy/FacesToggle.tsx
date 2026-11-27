/**
 * OLD markup, kept for the before/after preview only.
 * Source: `git show origin/main:src/ui/SettingsDialog.tsx` @ 1f79fa1 — the
 * "capturar fotos" row (`<label className="check-row wide">`, lines 72-75).
 * No app code imports this file.
 */
export function LegacyFacesToggle() {
  return (
    <div className="pv-field">
      <label className="check-row wide">
        <input id="pv-voice-faces" type="checkbox" defaultChecked readOnly />
        Capturar fotos de quem fala a partir do vídeo (link ou arquivo)
      </label>
    </div>
  );
}
