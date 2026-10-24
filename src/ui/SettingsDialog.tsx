import { useEffect, useRef, useState } from "react";
import type { Settings } from "../app/settings";

import { EndpointFields } from "./ModelPicker";

const VOICE_MODELS = [
  ["3dspeaker-campplus", "CAM++ (rápido, multilíngue)"],
  ["wespeaker-resnet34", "WeSpeaker ResNet34 (mais pesado)"],
  ["nemo-titanet-small", "NeMo TitaNet small"],
] as const;

export function SettingsDialog({ open, settings, onClose, onSave }: { open: boolean; settings: Settings; onClose: () => void; onSave: (s: Settings) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      ref.current?.showModal();
    } else ref.current?.close();
  }, [open, settings]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="cfg-title">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); onSave(draft); onClose(); }}>
        <h3 id="cfg-title">Configuração</h3>
        <EndpointFields legend="LLM (OpenAI-compatible)" reasoning value={draft.llm} presets={["ollama", "litellm", "openrouter", "openai", "groq", "custom"]} filter={(m) => !/embed|whisper|transcri/i.test(m)} onChange={(llm) => set("llm", llm)} />
        <EndpointFields legend="Transcrição (OpenAI-compatible)" value={draft.asr} presets={["whisperLocal", "groq", "openai", "litellm", "custom"]} filter={(m) => /whisper|transcri|turbo|large|medium|small/i.test(m)} onChange={(asr) => set("asr", { ...draft.asr, ...asr })} />
        <fieldset>
          <legend>Busca na web</legend>
          <label className="wide">
            Provedor
            <select id="search-provider" value={draft.search.provider} onChange={(e) => set("search", { ...draft.search, provider: e.target.value as Settings["search"]["provider"] })}>
              <option value="google">Google Custom Search</option>
              <option value="serper">Serper (resultados do Google)</option>
              <option value="duckduckgo">DuckDuckGo (sem chave)</option>
            </select>
          </label>
          {draft.search.provider === "google" && (
            <>
              <label>API key<input id="g-key" type="password" autoComplete="off" value={draft.search.googleKey} onChange={(e) => set("search", { ...draft.search, googleKey: e.target.value })} /></label>
              <label>Search engine ID (cx)<input id="g-cx" value={draft.search.googleCx} onChange={(e) => set("search", { ...draft.search, googleCx: e.target.value })} /></label>
            </>
          )}
          {draft.search.provider === "serper" && (
            <label className="wide">Serper API key<input id="serper-key" type="password" autoComplete="off" value={draft.search.serperKey} onChange={(e) => set("search", { ...draft.search, serperKey: e.target.value })} /></label>
          )}
          <p className="hint">Chaves ficam no cofre do sistema operacional, não em arquivo.</p>
        </fieldset>
        <fieldset>
          <legend>Vozes e fotos</legend>
          <label className="wide">
            Participantes (opcional)
            <input id="participants" maxLength={300} value={draft.participants} placeholder="Ex.: Lula; Flávio Bolsonaro; Adriana Araújo (mediadora)" onChange={(e) => set("participants", e.target.value)} />
          </label>
          <label className="wide">
            Modelo de voz
            <select id="voice-model" value={draft.voice.voiceModel} onChange={(e) => set("voice", { ...draft.voice, voiceModel: e.target.value })}>
              {VOICE_MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>
            Limiar de voz ({draft.voice.threshold.toFixed(2)})
            <input id="voice-thr" type="range" min="0.3" max="0.9" step="0.01" value={draft.voice.threshold} onChange={(e) => set("voice", { ...draft.voice, threshold: Number(e.target.value) })} />
          </label>
          <label>
            Máx. falantes
            <input id="voice-max" type="number" min="2" max="8" value={draft.voice.maxSpeakers} onChange={(e) => set("voice", { ...draft.voice, maxSpeakers: Math.min(8, Math.max(2, Number(e.target.value) || 2)) })} />
          </label>
          <label className="check-row wide">
            <input id="voice-faces" type="checkbox" checked={draft.voice.captureFaces} onChange={(e) => set("voice", { ...draft.voice, captureFaces: e.target.checked })} />
            Capturar fotos de quem fala a partir do vídeo (link ou arquivo)
          </label>
          <p className="hint">Participantes ajudam a dar nome às vozes (o nome só é usado com pista na fala). Limiar maior separa mais vozes; menor junta vozes parecidas.</p>
        </fieldset>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary">Salvar</button>
        </div>
      </form>
    </dialog>
  );
}
