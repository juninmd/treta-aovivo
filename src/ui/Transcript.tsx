import { useEffect, useRef, useState, type ReactNode } from "react";
import { locateQuote } from "../core/quotes";
import type { Claim, Fallacy, Speaker, Utterance } from "../core/types";
import { Avatar, fmt, speakerColor } from "./common";

interface Mark {
  start: number;
  end: number;
  node: (text: string) => ReactNode;
}

function highlight(u: Utterance, claims: Claim[], fallacies: Fallacy[], onClaim: (id: string) => void): ReactNode[] {
  const marks: Mark[] = [];
  for (const c of claims) {
    const m = locateQuote(u.text, c.quote);
    if (m)
      marks.push({
        ...m,
        node: (t) => (
          <button type="button" key={c.id} className="claim" data-v={c.status === "done" ? c.verdict : ""} onClick={() => onClaim(c.id)} title="Ver checagem">
            {t}
          </button>
        ),
      });
  }
  for (const f of fallacies) {
    const m = locateQuote(u.text, f.quote);
    if (m) marks.push({ ...m, node: (t) => <span key={f.id} className="fallacy" title={`${f.kind}: ${f.explanation}`}>{t}</span> });
  }
  marks.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue; // overlapping marks: first one wins
    if (m.start > at) out.push(u.text.slice(at, m.start));
    out.push(m.node(u.text.slice(m.start, m.end)));
    at = m.end;
  }
  out.push(u.text.slice(at));
  return out;
}

interface Props {
  speakers: Speaker[];
  utterances: Utterance[];
  claims: Claim[];
  fallacies: Fallacy[];
  speaking: boolean;
  running: boolean;
  onClaim: (id: string) => void;
  onReassign: (utteranceId: string, speaker: number) => void;
}

const UNCERTAIN = { overlap: "Duas vozes ao mesmo tempo", "self-address": "A fala chama o próprio falante pelo nome" } as const;

export function Transcript({ speakers, utterances, claims, fallacies, speaking, running, onClaim, onReassign }: Props) {
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [filter, setFilter] = useState<number | "all">("all");
  const end = useRef<HTMLDivElement>(null);
  const byId = new Map(speakers.map((s) => [s.id, s]));
  const shown = utterances.filter((u) => filter === "all" || u.speaker === filter);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [utterances.length]);

  return (
    <section aria-labelledby="h-feed">
      <div className="col-title">
        <h2 id="h-feed">Transcrição</h2>
        <small>sublinhado = afirmação checável · clique para ver a checagem</small>
      </div>
      <div className="filters" role="group" aria-label="Filtrar por falante">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>Todos</button>
        {speakers.map((s) => (
          <button type="button" key={s.id} aria-pressed={filter === s.id} onClick={() => setFilter(s.id)}>{s.name}</button>
        ))}
      </div>
      <div className="feed" aria-live="polite">
        {!shown.length && (
          <p className="empty">
            {running ? "Ouvindo… a primeira fala aparece alguns segundos depois de terminar." : "Escolha a fonte do debate e clique em Iniciar. Cada voz ganha uma cor, um nome e uma foto."}
          </p>
        )}
        {shown.map((u) => {
          const sp = byId.get(u.speaker);
          return (
            <div key={u.id} className={`turn ${u.closed ? "" : "partial"}`} style={{ ["--c" as string]: speakerColor(u.speaker) }}>
              <div className="side">
                <Avatar speaker={sp} />
                <span className="t">{fmt(u.start)}</span>
              </div>
              <div>
                {reviewing === u.id ? (
                  <select
                    className="who-select"
                    autoFocus
                    aria-label="Quem disse este trecho"
                    value={u.speaker}
                    onChange={(e) => { onReassign(u.id, Number(e.target.value)); setReviewing(null); }}
                    onBlur={() => setReviewing(null)}
                    onKeyDown={(e) => e.key === "Escape" && setReviewing(null)}
                  >
                    {speakers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : u.closed ? (
                  <button type="button" className="who" title="Corrigir quem disse este trecho" onClick={() => setReviewing(u.id)}>
                    {sp?.name ?? `Falante ${u.speaker + 1}`}
                  </button>
                ) : (
                  <span className="who">{sp?.name ?? `Falante ${u.speaker + 1}`}</span>
                )}
                {u.reviewed && <span className="reviewed" title="Revisado">✓ revisado</span>}
                {!u.closed && <span className="wave" aria-hidden="true"><span /><span /><span /><span /></span>}
                <p>{highlight(u, claims.filter((c) => c.utteranceId === u.id), fallacies.filter((f) => f.utteranceId === u.id), onClaim)}</p>
                {u.uncertain && (
                  <p className="hint uncertain">
                    {UNCERTAIN[u.uncertain]} · atribuição incerta, não pontua ·{" "}
                    <button type="button" className="link" onClick={() => onReassign(u.id, u.speaker)}>confirmar {sp?.name ?? "falante"}</button>
                    {" · "}
                    <button type="button" className="link" onClick={() => setReviewing(u.id)}>trocar falante</button>
                  </p>
                )}
                {fallacies.some((f) => f.utteranceId === u.id) && (
                  <div className="tags">
                    {fallacies.filter((f) => f.utteranceId === u.id).map((f) => <span key={f.id} className="tag f" title={f.explanation}>{f.kind}</span>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {running && speaking && <div className="listening">ouvindo<span className="wave" aria-hidden="true"><span /><span /><span /><span /></span></div>}
        <div ref={end} />
      </div>
    </section>
  );
}
