import { useEffect, useState } from "react";
import { defaultReasoning, listModels, PRESETS, REASONING, type Endpoint, type PresetId, type Reasoning } from "../core/providers";
import { httpFetch } from "../platform/tauri";

interface Props {
  legend: string;
  /** Shows the reasoning-effort control (chat models only). */
  reasoning?: boolean;
  value: Endpoint;
  presets: PresetId[];
  onChange: (e: Endpoint) => void;
  /** Hides models that cannot do this job (e.g. embeddings for chat). */
  filter?: (id: string) => boolean;
}

const REASONING_LABEL: Record<Reasoning, string> = { default: "padrão do provedor", none: "desligado (mais rápido)", low: "baixo", medium: "médio", high: "alto" };

export function EndpointFields({ legend, value, presets, onChange, filter = () => true, reasoning = false }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const id = legend.replace(/\W+/g, "-").toLowerCase();

  async function refresh(ep = value) {
    if (!ep.baseURL) return setStatus("Informe a base URL.");
    setStatus("Lendo modelos…");
    try {
      const list = (await listModels(ep, httpFetch)).filter(filter);
      setModels(list);
      setStatus(list.length ? `${list.length} modelos em ${ep.baseURL}/models` : "O endpoint não listou modelos; digite o nome.");
    } catch (e) {
      setModels([]);
      setStatus(`Não consegui listar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  useEffect(() => {
    // Refresh only when the endpoint itself changes, not on every model pick.
    void refresh();
  }, [value.baseURL, value.apiKey]);

  useEffect(() => {
    // "Use whatever is available": the first listed model fills an empty choice,
    // also after the parent resets its draft.
    if (!value.model && models[0]) onChange({ ...value, model: models[0] });
  }, [models, value.model]);

  return (
    <fieldset>
      <legend>{legend}</legend>
      <label>
        Provedor
        <select id={`${id}-preset`} value={value.preset} onChange={(e) => {
          const preset = e.target.value as PresetId;
          onChange({ ...value, preset, baseURL: PRESETS[preset].baseURL || value.baseURL, model: "", reasoning: undefined });
        }}>
          {presets.map((p) => <option key={p} value={p}>{PRESETS[p].label}</option>)}
        </select>
      </label>
      <label>
        API key
        <input id={`${id}-key`} type="password" autoComplete="off" value={value.apiKey ?? ""} placeholder={PRESETS[value.preset].needsKey ? "obrigatória" : "opcional"} onChange={(e) => onChange({ ...value, apiKey: e.target.value })} />
      </label>
      <label className="wide">
        Base URL
        <input id={`${id}-url`} value={value.baseURL} onChange={(e) => onChange({ ...value, baseURL: e.target.value, preset: "custom" })} />
      </label>
      <div className="model-row">
        <label>
          Modelo
          {models.length ? (
            <select id={`${id}-model`} value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}>
              {!models.includes(value.model) && <option value={value.model}>{value.model || "escolha um modelo"}</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input id={`${id}-model`} value={value.model} placeholder="nome do modelo" onChange={(e) => onChange({ ...value, model: e.target.value })} />
          )}
        </label>
        <button type="button" className="btn" onClick={() => void refresh()}>Atualizar lista</button>
      </div>
      {reasoning && (
        <label className="wide">
          Raciocínio (reasoning_effort)
          <select id={`${id}-reasoning`} value={value.reasoning ?? defaultReasoning(value.preset)} onChange={(e) => onChange({ ...value, reasoning: e.target.value as Reasoning })}>
            {REASONING.map((r) => <option key={r} value={r}>{REASONING_LABEL[r]}</option>)}
          </select>
        </label>
      )}
      <p className="hint">{status}</p>
    </fieldset>
  );
}
