import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/tauri", () => ({ secrets: { get: vi.fn(async () => null), set: vi.fn(async () => {}) } }));

const { DEFAULT_SETTINGS, loadSettings } = await import("./settings");

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
