/**
 * Homologation / smoke test against a real debate video.
 * Runs the Rust voice engine (treta-engine) and the same TS core the app uses,
 * then writes homologation/report.{md,json} plus captured portraits.
 *
 *   pnpm homologate [--url <link>] [--file <path>] [--speed 2] [--limit-seconds 0]
 * Env: LLM_BASE_URL, LLM_MODEL, LLM_API_KEY, LLM_REASONING (default none), ASR_BASE_URL, ASR_MODEL, ASR_API_KEY,
 *      SEARCH=duckduckgo|google|serper, GOOGLE_API_KEY, GOOGLE_CSE_ID, SERPER_API_KEY, PARTICIPANTS ("A; B")
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { rankMoments, summarizeDebate } from "../src/core/highlights";
import { createDebateSession, todayISO } from "../src/core/pipeline";
import { listModels, type Reasoning } from "../src/core/providers";
import { bestPortrait, scoreboard } from "../src/core/score";
import type { SearchSettings } from "../src/core/search";
import type { EngineEvent } from "../src/core/types";
import { renderReport, type Latency } from "./report";

const DEFAULT_URL = "https://www.youtube.com/watch?v=dnFW2LLBwR0";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function pickModel(baseURL: string, apiKey: string | undefined, wanted: string | undefined, kind: string): Promise<string> {
  if (wanted) return wanted;
  const models = (await listModels({ baseURL, apiKey })).filter((m) => !/embed/i.test(m));
  if (!models.length) throw new Error(`nenhum modelo de ${kind} em ${baseURL}/models`);
  return models[0];
}

function searchFromEnv(): SearchSettings {
  const p = process.env.SEARCH ?? "duckduckgo";
  if (p === "google") return { provider: "google", apiKey: process.env.GOOGLE_API_KEY ?? "", cx: process.env.GOOGLE_CSE_ID ?? "" };
  if (p === "serper") return { provider: "serper", apiKey: process.env.SERPER_API_KEY ?? "" };
  return { provider: "duckduckgo" };
}

const percentile = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const out = resolve(root, arg("out", "homologation")!);
  mkdirSync(join(out, "portraits"), { recursive: true });
  const speed = arg("speed", "2")!;
  const limit = Number(arg("limit-seconds", "0"));
  const file = arg("file");
  const url = arg("url", DEFAULT_URL)!;

  const llmURL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
  const asrURL = process.env.ASR_BASE_URL ?? "http://127.0.0.1:8765/v1";
  const llmModel = await pickModel(llmURL, process.env.LLM_API_KEY, process.env.LLM_MODEL, "LLM");
  const asrModel = await pickModel(asrURL, process.env.ASR_API_KEY, process.env.ASR_MODEL, "transcrição");
  console.log(`LLM ${llmModel} @ ${llmURL} | ASR ${asrModel} @ ${asrURL} | busca ${searchFromEnv().provider}`);

  const { session, llm } = createDebateSession(
    {
      llm: { preset: "custom", baseURL: llmURL, model: llmModel, apiKey: process.env.LLM_API_KEY, reasoning: (process.env.LLM_REASONING as Reasoning | undefined) ?? "none" },
      asr: { preset: "custom", baseURL: asrURL, model: asrModel, apiKey: process.env.ASR_API_KEY, language: "pt" },
      search: searchFromEnv(),
      today: todayISO(),
      participants: (process.env.PARTICIPANTS ?? "").split(/[;,]/).map((p) => p.trim()).filter(Boolean),
    },
    fetch,
  );

  const exe = ["release", "debug"].map((p) => join(root, "src-tauri", "target", p, "treta-engine.exe")).find(existsSync)
    ?? join(root, "src-tauri", "target", "debug", "treta-engine");
  const source = file ? ["--file", file] : ["--url", url];
  const voiceArgs = ["--voice-model", process.env.VOICE_MODEL ?? "3dspeaker-campplus", "--threshold", process.env.VOICE_THRESHOLD ?? "0.55"];
  const engine = spawn(exe, [...source, "--speed", speed, "--models", join(root, "models"), ...voiceArgs], { stdio: ["ignore", "pipe", "pipe"] });
  engine.stderr.on("data", (d) => process.stderr.write(`[engine] ${d}`));

  const started = Date.now();
  const segReceived = new Map<number, number>();
  const latency: Latency[] = [];
  let lastLog = 0;
  session.subscribe(() => {
    const st = session.getState();
    for (const u of st.utterances) for (const id of u.segmentIds) {
      const at = segReceived.get(id);
      if (at !== undefined) {
        latency.push({ segment: id, transcriptMs: Date.now() - at });
        segReceived.delete(id);
      }
    }
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      console.log(`t=${st.t.toFixed(0)}s falas=${st.utterances.length} checagens=${st.claims.filter((c) => c.status === "done").length}/${st.claims.length} falácias=${st.fallacies.length} pendente=${st.pending} vozes=${st.speakers.length}`);
    }
  });

  const lines = createInterface({ input: engine.stdout });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line) as EngineEvent;
    if (ev.type === "segment") segReceived.set(ev.id, Date.now());
    if (ev.type === "error") console.error(`[engine error] ${ev.message}`);
    session.handle(ev);
    if (limit && ev.type === "activity" && ev.t >= limit) {
      engine.kill();
      session.handle({ type: "ended", t: ev.t });
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 50));
  await session.whenIdle();

  const st = session.getState();
  const names = Object.fromEntries(st.speakers.map((s) => [s.id, s.name]));
  const board = scoreboard(st.speakers, st.claims, st.fallacies);
  const moments = rankMoments(st.claims, st.fallacies);
  let summary = { resumo: "", momentoMaisQuente: "" };
  try {
    summary = await summarizeDebate(llm, { utterances: st.utterances.filter((u) => u.closed), names, moments, scoreLine: board.map((r) => `${names[r.speaker]} ${r.points}`).join(", ") });
  } catch (e) {
    console.error(`resumo falhou: ${(e as Error).message}`);
  }

  const portraits: Record<number, string> = {};
  for (const s of st.speakers) {
    const best = bestPortrait(s.portraits);
    if (!best) continue;
    const path = join(out, "portraits", `voz-${s.id + 1}.jpg`);
    writeFileSync(path, Buffer.from(best.image.split(",")[1], "base64"));
    portraits[s.id] = `portraits/voz-${s.id + 1}.jpg`;
  }

  const timings = (stage: string) => st.timings.filter((t) => t.stage === stage).map((t) => t.ms);
  const stats = {
    wallSeconds: Math.round((Date.now() - started) / 1000),
    audioSeconds: Math.round(st.t),
    speed: Number(speed),
    transcribeP50: percentile(timings("transcribe"), 0.5),
    analyzeP50: percentile(timings("analyze"), 0.5),
    factcheckP50: percentile(timings("factcheck"), 0.5),
    segmentToTextP50: percentile(latency.map((l) => l.transcriptMs), 0.5),
    segmentToTextP90: percentile(latency.map((l) => l.transcriptMs), 0.9),
  };
  const report = { source: file ?? url, models: { llm: llmModel, asr: asrModel }, stats, board, names, portraits, summary, moments, ...st, utterances: st.utterances.map(({ clips: _c, ...u }) => u), speakers: st.speakers.map(({ portraits: p, ...s }) => ({ ...s, portraits: p.length })) };
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(out, "report.md"), renderReport(report));
  console.log(`\nRelatório: ${join(out, "report.md")}`);
  console.log(JSON.stringify(stats));
  console.log(board.map((r) => `${names[r.speaker]}: ${r.points} pts (mentiras ${r.lies}, ad hominem ${r.adHominem}, verdadeiras ${r.truths})`).join("\n"));
  if (st.errors.length) console.log(`Erros (${st.errors.length}):\n${st.errors.slice(0, 10).join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
