import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { languageModel, type Endpoint } from "./providers";

async function sentBody(ep: Endpoint): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const fake = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: ep.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  await generateText({ model: languageModel(ep, fake), prompt: "oi" });
  return body;
}

describe("reasoning effort", () => {
  it("turns thinking off by default on Ollama so live analysis stays fast", async () => {
    const body = await sentBody({ preset: "ollama", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b" });
    expect(body.reasoning_effort).toBe("none");
  });
  it("leaves hosted providers alone unless asked (OpenAI rejects the field on non-reasoning models)", async () => {
    expect((await sentBody({ preset: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "k" })).reasoning_effort).toBeUndefined();
    expect((await sentBody({ preset: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "m", reasoning: "low" })).reasoning_effort).toBe("low");
  });
});
