import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, TranscriptionModel } from "ai";

export type FetchFn = typeof globalThis.fetch;

export const PRESETS = {
  ollama: { label: "Ollama (local)", baseURL: "http://localhost:11434/v1", needsKey: false },
  litellm: { label: "LiteLLM proxy", baseURL: "http://localhost:4000/v1", needsKey: false },
  openrouter: { label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", needsKey: true },
  openai: { label: "OpenAI", baseURL: "https://api.openai.com/v1", needsKey: true },
  groq: { label: "Groq", baseURL: "https://api.groq.com/openai/v1", needsKey: true },
  whisperLocal: { label: "Whisper local (tools/whisper-server)", baseURL: "http://127.0.0.1:8765/v1", needsKey: false },
  custom: { label: "Personalizado", baseURL: "", needsKey: false },
} as const;
export type PresetId = keyof typeof PRESETS;

export const REASONING = ["default", "none", "low", "medium", "high"] as const;
export type Reasoning = (typeof REASONING)[number];

export interface Endpoint {
  preset: PresetId;
  baseURL: string;
  model: string;
  apiKey?: string;
  /** Sent as reasoning_effort; "none" keeps thinking models fast enough for live use. */
  reasoning?: Reasoning;
}

/** Thinking models (qwen3.x, gpt-oss…) on Ollama spend minutes per call unless told not to. */
export const defaultReasoning = (preset: PresetId): Reasoning => (preset === "ollama" ? "none" : "default");

export function normalizeBaseURL(url: string): string {
  const u = new URL(url.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("A URL precisa começar com http:// ou https://");
  return u.toString().replace(/\/+$/, "");
}

/** Lists model ids from an OpenAI-compatible GET /models. */
export async function listModels(ep: Pick<Endpoint, "baseURL" | "apiKey">, fetchFn: FetchFn = fetch): Promise<string[]> {
  const res = await fetchFn(`${normalizeBaseURL(ep.baseURL)}/models`, {
    headers: ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`GET /models respondeu ${res.status}`);
  const body = (await res.json()) as { data?: { id?: unknown }[] };
  const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function languageModel(ep: Endpoint, fetchFn: FetchFn = fetch): LanguageModel {
  if (!ep.model) throw new Error("Escolha um modelo de LLM nas configurações");
  const effort = ep.reasoning ?? defaultReasoning(ep.preset);
  return createOpenAICompatible({
    name: ep.preset,
    baseURL: normalizeBaseURL(ep.baseURL),
    apiKey: ep.apiKey || undefined,
    fetch: fetchFn,
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => (effort && effort !== "default" ? { ...body, reasoning_effort: effort } : body),
  }).chatModel(ep.model);
}

export function transcriptionModel(ep: Endpoint, fetchFn: FetchFn = fetch): TranscriptionModel {
  if (!ep.model) throw new Error("Escolha um modelo de transcrição nas configurações");
  // The OpenAI provider implements /audio/transcriptions; any compatible server works with a baseURL.
  return createOpenAI({ baseURL: normalizeBaseURL(ep.baseURL), apiKey: ep.apiKey || "not-needed", fetch: fetchFn }).transcription(ep.model);
}
