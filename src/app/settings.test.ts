import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/tauri", () => ({ secrets: { get: vi.fn(async () => null), set: vi.fn(async () => {}) } }));

const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import("./settings");
const { secrets } = await import("../platform/tauri");

const withStored = (raw: string | null) => {
  vi.stubGlobal("localStorage", { getItem: () => raw, setItem: () => {} });
};

afterEach(() => vi.unstubAllGlobals());

describe("loadSettings", () => {
  it.each(["null", "42", '"texto"', "[1,2]", "{quebrado"])("falls back to defaults when the stored value is %s", async (raw) => {
    withStored(raw);
    const s = await loadSettings();
    expect(s.llm.baseURL).toBe(DEFAULT_SETTINGS.llm.baseURL);
    expect(s.voice).toEqual(DEFAULT_SETTINGS.voice);
    expect(s.participants).toBe("");
  });

  it("keeps valid stored preferences", async () => {
    withStored(JSON.stringify({ llm: { preset: "ollama", baseURL: "http://x:1/v1", model: "m" }, participants: "Ana; Bia" }));
    const s = await loadSettings();
    expect(s.llm.baseURL).toBe("http://x:1/v1");
    expect(s.participants).toBe("Ana; Bia");
  });
});

describe("saveSettings", () => {
  it("writes to the credential store only the secrets that changed", async () => {
    withStored(null);
    const s = await loadSettings();
    const set = vi.mocked(secrets.set);
    set.mockClear();
    // Typing a 60-character URL saves the settings once per keystroke.
    const url = "https://www.youtube.com/watch?v=abcdefghijk&t=120s&list=xyz";
    for (let i = 1; i <= url.length; i++) await saveSettings({ ...s, source: { kind: "url", url: url.slice(0, i), speed: 1 } });
    expect(set).not.toHaveBeenCalled();

    await saveSettings({ ...s, llm: { ...s.llm, apiKey: "sk-1" } });
    expect(set.mock.calls).toEqual([["llm.apiKey", "sk-1"]]);
  });

  it("retries a secret whose write failed", async () => {
    withStored(null);
    const s = await loadSettings();
    const set = vi.mocked(secrets.set);
    set.mockClear();
    set.mockRejectedValueOnce(new Error("locked"));
    const next = { ...s, asr: { ...s.asr, apiKey: "k" } };
    await expect(saveSettings(next)).rejects.toThrow("locked");
    await saveSettings(next);
    expect(set.mock.calls).toEqual([["asr.apiKey", "k"], ["asr.apiKey", "k"]]);
  });
});
