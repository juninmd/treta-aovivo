/**
 * Stand-in for @tauri-apps/plugin-http: an in-page OpenAI-compatible LLM and
 * transcription server that answers from the fictional debate's fixture.
 */
import { CLAIMS, FALLACIES, LINES, NAMES, SUMMARY } from "../fixture";

interface ChatBody {
  messages: { role: string; content: string | { type: string; text?: string }[] }[];
  response_format?: { json_schema?: { name?: string } };
}

const textOf = (c: ChatBody["messages"][number]["content"]) => (typeof c === "string" ? c : c.map((p) => p.text ?? "").join("\n"));

function answer(schema: string | undefined, prompt: string): unknown {
  switch (schema) {
    case "analise": {
      const fala = prompt.match(/<fala>([\s\S]*?)<\/fala>/)?.[1] ?? "";
      return {
        claims: CLAIMS.filter((c) => fala.includes(c.quote)).map((c) => ({ quote: c.quote, query: c.query })),
        fallacies: FALLACIES.filter((f) => fala.includes(f.quote)),
      };
    }
    case "veredicto": {
      const c = CLAIMS.find((x) => prompt.includes(x.quote));
      if (!c) return { verdict: "sem evidência", explanation: "Sem fontes.", confidence: 0.2, sources: [] };
      return { verdict: c.verdict, explanation: c.explanation, confidence: c.confidence, sources: c.results.map((_, i) => i + 1) };
    }
    case "falantes":
      return { speakers: NAMES.map((name, i) => ({ speaker: i + 1, name, evidence: "apresentação no debate" })) };
    case "resumo":
      return SUMMARY;
  }
  throw new Error(`demo LLM has no answer for ${schema}`);
}

export async function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.endsWith("/models")) {
    const ids = url.port === "8765" ? ["large-v3-turbo"] : ["gemma4:12b-it-qat", "qwen3.5:9b"];
    return Response.json({ data: ids.map((id) => ({ id })) });
  }
  if (url.pathname.endsWith("/audio/transcriptions")) {
    const file = (init?.body as FormData).get("file") as Blob;
    const index = new DataView(await file.arrayBuffer()).getInt16(44, true);
    return Response.json({ text: LINES[index]?.text ?? "" });
  }
  if (url.pathname.endsWith("/chat/completions")) {
    const body = JSON.parse(String(init?.body)) as ChatBody;
    // The user message only: the system prompt also mentions <fala>, and the context holds earlier turns.
    const user = body.messages.filter((m) => m.role === "user").at(-1);
    const output = answer(body.response_format?.json_schema?.name, user ? textOf(user.content) : "");
    return Response.json({
      id: "demo",
      object: "chat.completion",
      created: 0,
      model: "demo",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
  // Every check's sources come through the DuckDuckGo page; the news feed is empty here.
  if (url.hostname === "news.google.com") return new Response("<rss><channel></channel></rss>");
  return new Response("not found", { status: 404 });
}
