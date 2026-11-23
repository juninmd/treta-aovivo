import type { Endpoint } from "../core/providers";
import type { SearchSettings } from "../core/search";
import { secrets, type SourceSpec, type VoiceConfig } from "../platform/tauri";

export interface Settings {
  llm: Endpoint;
  asr: Endpoint & { language: string };
  search: { provider: SearchSettings["provider"]; googleKey: string; googleCx: string; serperKey: string };
  voice: VoiceConfig;
  source: SourceSpec;
  /** Who is expected in the debate, separated by ";" or ","; helps name the voices. */
  participants: string;
}

export const DEFAULT_SETTINGS: Settings = {
  llm: { preset: "ollama", baseURL: "http://localhost:11434/v1", model: "" },
  asr: { preset: "whisperLocal", baseURL: "http://127.0.0.1:8765/v1", model: "", language: "pt" },
  search: { provider: "duckduckgo", googleKey: "", googleCx: "", serperKey: "" },
  voice: { voiceModel: "3dspeaker-campplus", threshold: 0.55, maxSpeakers: 4, captureFaces: true },
  source: { kind: "url", url: "", speed: 1 },
  participants: "",
};

const STORE_KEY = "treta.settings.v1";
// Secrets go to the OS credential store; everything else is plain preferences.
const SECRET_KEYS = { llmKey: "llm.apiKey", asrKey: "asr.apiKey", googleKey: "search.googleKey", serperKey: "search.serperKey" } as const;

// Last value known to be in the credential store, per key. saveSettings runs on every
// keystroke of any field; only secrets that actually changed cost an IPC write.
const persistedSecrets = new Map<string, string>();

async function writeSecret(key: string, value: string): Promise<void> {
  if (persistedSecrets.get(key) === value) return;
  await secrets.set(key, value);
  persistedSecrets.set(key, value);
}

type Stored = Omit<Settings, "llm" | "asr" | "search"> & {
  llm: Omit<Endpoint, "apiKey">;
  asr: Omit<Settings["asr"], "apiKey">;
  search: Pick<Settings["search"], "provider" | "googleCx">;
};

export async function loadSettings(): Promise<Settings> {
  let stored: Partial<Stored> = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    // "null" or a non-object would throw below and lock the app out of its own settings.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Partial<Stored>;
  } catch {
    stored = {};
  }
  const s: Settings = {
    llm: { ...DEFAULT_SETTINGS.llm, ...stored.llm },
    asr: { ...DEFAULT_SETTINGS.asr, ...stored.asr },
    search: { ...DEFAULT_SETTINGS.search, ...stored.search },
    voice: { ...DEFAULT_SETTINGS.voice, ...stored.voice },
    source: stored.source ?? DEFAULT_SETTINGS.source,
    participants: stored.participants ?? "",
  };
  const [llmKey, asrKey, googleKey, serperKey] = await Promise.all(
    Object.values(SECRET_KEYS).map((k) =>
      secrets.get(k).then(
        (value) => {
          persistedSecrets.set(k, value ?? "");
          return value;
        },
        () => null,
      ),
    ),
  );
  s.llm.apiKey = llmKey ?? "";
  s.asr.apiKey = asrKey ?? "";
  s.search.googleKey = googleKey ?? "";
  s.search.serperKey = serperKey ?? "";
  return s;
}

export async function saveSettings(s: Settings): Promise<void> {
  const stored: Stored = {
    llm: { preset: s.llm.preset, baseURL: s.llm.baseURL, model: s.llm.model, reasoning: s.llm.reasoning },
    asr: { preset: s.asr.preset, baseURL: s.asr.baseURL, model: s.asr.model, language: s.asr.language },
    search: { provider: s.search.provider, googleCx: s.search.googleCx },
    voice: s.voice,
    source: s.source,
    participants: s.participants,
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(stored));
  } catch {
    // Preferences are a convenience; secrets below are what must persist.
  }
  await Promise.all([
    writeSecret(SECRET_KEYS.llmKey, s.llm.apiKey ?? ""),
    writeSecret(SECRET_KEYS.asrKey, s.asr.apiKey ?? ""),
    writeSecret(SECRET_KEYS.googleKey, s.search.googleKey),
    writeSecret(SECRET_KEYS.serperKey, s.search.serperKey),
  ]);
}

export function searchSettings(s: Settings["search"]): SearchSettings {
  if (s.provider === "google") return { provider: "google", apiKey: s.googleKey, cx: s.googleCx };
  if (s.provider === "serper") return { provider: "serper", apiKey: s.serperKey };
  return { provider: "duckduckgo" };
}

export const participantList = (raw: string): string[] =>
  raw
    .split(/[;,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
