import type { LanguageModel } from "ai";
import { useEffect, useRef, useState } from "react";
import { rankMoments, summarizeDebate, type SessionSummary } from "../core/highlights";
import { scoreboard } from "../core/score";
import type { SessionState } from "../core/session";
import { Avatar, fmt, playClips, speakerColor } from "./common";

const KIND_COLOR: Record<string, string> = { mentira: "var(--v-false)", enganou: "var(--v-mis)", acertou: "var(--v-true)", "sem evidência": "var(--v-none)", "falácia": "var(--v-false)" };

export function MomentsDialog({ open, state, llm, onClose }: { open: boolean; state: SessionState; llm: LanguageModel | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [summaryStatus, setSummaryStatus] = useState("");
  const board = scoreboard(state.speakers, state.claims, state.fallacies);
  const moments = rankMoments(state.claims, state.fallacies);
  const byId = new Map(state.speakers.map((s) => [s.id, s]));
  const names = Object.fromEntries(state.speakers.map((s) => [s.id, s.name]));

  useEffect(() => {
    if (!open) return ref.current?.close();
    ref.current?.showModal();
    if (!llm || !state.utterances.length) return;
    const ctrl = new AbortController();
    setSummary(null);
    setSummaryStatus("Escrevendo o resumo…");
    summarizeDebate(llm, { utterances: state.utterances.filter((u) => u.closed), names, moments, scoreLine: board.map((r) => `${names[r.speaker]} ${r.points}`).join(", ") }, ctrl.signal)
      .then((s) => { setSummary(s); setSummaryStatus(""); })
      .catch((e) => { if (!ctrl.signal.aborted) setSummaryStatus(`Resumo indisponível: ${e instanceof Error ? e.message : String(e)}`); });
    return () => ctrl.abort();
    // The summary is written once per opening, from the state at that moment.
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="mom-title" className="wide-dialog">
      <form method="dialog">
        <div className="moments-head">
          <h3 id="mom-title">Melhores momentos</h3>
          <div className="podium">
            {board.map((r) => (
              <div key={r.speaker} style={{ ["--c" as string]: speakerColor(r.speaker) }}>
                <Avatar speaker={byId.get(r.speaker)} size="lg" />
                <b>{r.points > 0 ? "+" : ""}{r.points}</b>
                {names[r.speaker]}
              </div>
            ))}
          </div>
        </div>
        {summary ? (
          <div className="summary"><p>{summary.resumo}</p><p><strong>Momento mais quente:</strong> {summary.momentoMaisQuente}</p></div>
        ) : summaryStatus ? <p className="hint">{summaryStatus}</p> : null}
        <ol className="moments">
          {!moments.length && <li>Nenhum momento marcado ainda; deixe a sessão rodar.</li>}
          {moments.map((m, i) => {
            const clips = state.utterances.find((u) => u.id === m.utteranceId)?.clips ?? [];
            return (
              <li key={i} className="moment" style={{ ["--c" as string]: speakerColor(m.speaker), ["--k" as string]: KIND_COLOR[m.kind] }}>
                <Avatar speaker={byId.get(m.speaker)} size="lg" />
                <div>
                  <span className="kind">{m.label}</span>
                  <q>{m.quote}</q>
                  <small>{names[m.speaker]} · {fmt(m.at)} — {m.why}</small>
                </div>
                <button type="button" className="btn" disabled={!clips.length} onClick={() => playClips(clips)}>Ouvir</button>
              </li>
            );
          })}
        </ol>
        <div className="actions"><button type="submit" className="btn">Fechar</button></div>
      </form>
    </dialog>
  );
}
