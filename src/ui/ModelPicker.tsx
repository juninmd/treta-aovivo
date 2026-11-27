import { Button } from "@juninmd/sonido";
import { useEffect, useRef, useState } from "react";
import { defaultReasoning, listModels, PRESETS, REASONING, type Endpoint, type PresetId, type Reasoning } from "../core/providers";
import { httpFetch } from "../platform/tauri";
import { count } from "./common";

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

const NO_MODELS: string[] = [];

const REASONING_LABEL: Record<Reasoning, string> = { default: "padrão do provedor", none: "desligado (mais rápido)", low: "baixo", medium: "médio", high: "alto" };

export function EndpointFields({ legend, value, presets, onChange, filter = () => true, reasoning = false }: Props) {
  // The list remembers which endpoint it came from: after a provider switch the old
  // provider's models must not be shown or auto-picked for the new base URL.
  const [listed, setListed] = useState({ baseURL: "", models: NO_MODELS });
  const models = listed.baseURL === value.baseURL ? listed.models : NO_MODELS;
  const latestRequest = useRef(0);
  const [status, setStatus] = useState("");
  const id = legend.replace(/\W+/g, "-").toLowerCase();

  async function refresh(ep = value) {
    if (!ep.baseURL) return setStatus("Informe a base URL.");
    const request = ++latestRequest.current;
    setStatus("Lendo modelos…");
    try {
      const list = (await listModels(ep, httpFetch)).filter(filter);
      if (request !== latestRequest.current) return; // a newer endpoint/key is being listed
      setListed({ baseURL: ep.baseURL, models: list });
      setStatus(list.length ? `${count(list.length, "modelo", "modelos")} em ${ep.baseURL}/models` : "O endpoint não listou modelos; digite o nome.");
    } catch (e) {
      if (request !== latestRequest.current) return;
      setListed({ baseURL: ep.baseURL, models: NO_MODELS });
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
        <Button size="xs" appearance="outline" onClick={() => void refresh()}>Atualizar lista</Button>
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
