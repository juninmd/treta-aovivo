/**
 * OLD markup, kept for the before/after preview only.
 * Source: `git show origin/main:src/App.tsx` @ 1f79fa1 — the `<div className="chips">`
 * row (lines 81-88); one of the chips carries `className="chip err"`.
 * No app code imports this file.
 */
export function LegacyStatusChips() {
  return (
    <div className="chips">
      <span className="chip">LLM <b>qwen3.5:9b</b> · Ollama (local)</span>
      <span className="chip">transcrição <b>large-v3-turbo</b> · Whisper local</span>
      <span className="chip">busca <b>DuckDuckGo</b> + notícias</span>
      <span className="chip">vozes <b>3</b></span>
      <span className="chip" title="~/treta/2026-11-27.json">salvo <b>21:14:02</b></span>
      <span className="chip err" title="disco cheio">não salvou no arquivo</span>
    </div>
  );
}
