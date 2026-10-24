import type { Moment } from "../src/core/highlights";
import type { BoardRow } from "../src/core/score";
import type { Claim, Fallacy } from "../src/core/types";

export interface Latency {
  segment: number;
  transcriptMs: number;
}

interface ReportInput {
  source: string;
  models: { llm: string; asr: string };
  stats: Record<string, number>;
  board: BoardRow[];
  names: Record<number, string>;
  portraits: Record<number, string>;
  summary: { resumo: string; momentoMaisQuente: string };
  moments: Moment[];
  utterances: { id: string; speaker: number; start: number; end: number; text: string; uncertain?: "overlap" | "self-address" }[];
  claims: Claim[];
  fallacies: Fallacy[];
  errors: string[];
  messages: string[];
}

const ts = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderReport(r: ReportInput): string {
  const name = (id: number) => r.names[id] ?? `Falante ${id + 1}`;
  const out: string[] = [];
  out.push(`# Homologação — Treta ao Vivo`, "", `Fonte: ${r.source}  `, `Modelos: LLM \`${r.models.llm}\`, transcrição \`${r.models.asr}\``, "");
  out.push(`## Desempenho`, "", "| métrica | valor |", "|---|---|");
  for (const [k, v] of Object.entries(r.stats)) out.push(`| ${k} | ${v} |`);
  out.push("", `## Placar`, "", "| foto | falante | pontos | mentiras | enganosas | imprecisas | verdadeiras | sem evidência | ad hominem | outras falácias | fala |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const b of r.board) {
    const img = r.portraits[b.speaker] ? `<img src="${r.portraits[b.speaker]}" width="64">` : "";
    out.push(`| ${img} | ${cell(name(b.speaker))} | ${b.points} | ${b.lies} | ${b.misleading} | ${b.imprecise} | ${b.truths} | ${b.unproven} | ${b.adHominem} | ${b.otherFallacies} | ${ts(b.talkSeconds)} |`);
  }
  if (r.summary.resumo) out.push("", `## Resumo`, "", r.summary.resumo, "", `**Momento mais quente:** ${r.summary.momentoMaisQuente}`);
  out.push("", `## Melhores momentos`, "");
  for (const m of r.moments) out.push(`- **${m.label}** · ${cell(name(m.speaker))} · ${ts(m.at)} — “${m.quote}” — ${m.why}`);
  out.push("", `## Checagens (${r.claims.length})`, "");
  for (const c of r.claims) {
    out.push(`- ${ts(c.at)} **${cell(name(c.speaker))}**${c.uncertain ? " _(atribuição incerta)_" : ""}: “${c.quote}” → **${c.verdict ?? c.status}**${c.confidence != null ? ` (${Math.round(c.confidence * 100)}%)` : ""}`);
    out.push(`  - busca: \`${c.query}\``);
    if (c.explanation) out.push(`  - ${c.explanation}`);
    for (const s of c.sources ?? []) out.push(`  - fonte: [${cell(s.title)}](${s.url})`);
    if (c.error) out.push(`  - erro: ${c.error}`);
  }
  out.push("", `## Falácias (${r.fallacies.length})`, "");
  for (const f of r.fallacies) out.push(`- ${ts(f.at)} **${cell(name(f.speaker))}**${f.uncertain ? " _(atribuição incerta)_" : ""} · ${f.kind}: “${f.quote}” — ${f.explanation}`);
  out.push("", `## Transcrição`, "");
  for (const u of r.utterances) out.push(`**${ts(u.start)} ${cell(name(u.speaker))}${u.uncertain ? ` ⚠ ${u.uncertain === "overlap" ? "vozes sobrepostas" : "chama o próprio nome"}` : ""}:** ${u.text}`, "");
  if (r.errors.length) out.push(`## Erros (${r.errors.length})`, "", ...r.errors.map((e) => `- ${e}`));
  if (r.messages.length) out.push("", `## Mensagens do motor`, "", ...r.messages.map((m) => `- ${m}`));
  return out.join("\n") + "\n";
}
