import { Channel, invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { Snapshot } from "../core/archive";
import type { EngineEvent } from "../core/types";

export type SourceSpec =
  | { kind: "url"; url: string; speed?: number }
  | { kind: "file"; path: string; speed?: number }
  | { kind: "mic" }
  | { kind: "system" };

export interface VoiceConfig {
  voiceModel: string;
  threshold: number;
  maxSpeakers: number;
  captureFaces: boolean;
}

/** HTTP through the Rust side: no CORS, so local Ollama/LiteLLM work without extra flags. */
const SEARCH_PAGE = "https://html.duckduckgo.com/html/";

/**
 * The HTTP plugin always sends an Origin header and DuckDuckGo answers that with
 * 403, so its result pages go through a Rust command limited to that endpoint.
 */
export const httpFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(SEARCH_PAGE)) return tauriFetch(input, init);
  const page = await invoke<{ status: number; body: string }>("search_page", { url });
  return new Response(page.body, { status: page.status, headers: { "content-type": "text/html; charset=utf-8" } });
};

export async function startEngine(source: SourceSpec, config: VoiceConfig, onEvent: (e: EngineEvent) => void): Promise<void> {
  const channel = new Channel<EngineEvent>();
  channel.onmessage = onEvent;
  await invoke("start_engine", { source, config, onEvent: channel });
}

export const stopEngine = () => invoke<void>("stop_engine");
export const mergeVoices = (from: number, into: number) => invoke<boolean>("merge_speakers", { from, into });
export const checkTools = () => invoke<{ ytDlp: boolean; ffmpeg: boolean }>("check_tools");

export const secrets = {
  get: (key: string) => invoke<string | null>("secret_get", { key }),
  set: (key: string, value: string) => invoke<void>("secret_set", { key, value }),
};

/** Writes the debate to the SQLite archive; resolves to the database path. */
export const saveDebate = (snapshot: Snapshot) => invoke<string>("save_debate", { snapshot });
