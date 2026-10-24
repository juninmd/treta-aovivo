import { scoreboard, type BoardRow } from "../core/score";
import type { Claim, Fallacy, Speaker } from "../core/types";
import { Avatar, count, fmt, speakerColor } from "./common";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const Crown = () => (
  <svg className="crown" viewBox="0 0 64 44" aria-hidden="true">
    <path d="M6 40 3 12l15 12L32 4l14 20 15-12-3 28Z" />
    <circle cx="3" cy="11" r="3.5" /><circle cx="32" cy="4" r="3.5" /><circle cx="61" cy="11" r="3.5" />
  </svg>
);

function Duel({ a, b, byId }: { a: BoardRow; b: BoardRow; byId: Map<number, Speaker> }) {
  const lead = a.points === b.points ? null : a.points > b.points ? a.speaker : b.speaker;
  const margin = Math.abs(a.points - b.points);
  const side = (r: BoardRow) => (
    <div className={`duelist ${lead === r.speaker ? "lead" : ""}`} style={{ ["--c" as string]: speakerColor(r.speaker) }}>
      {/* Keyed by the leader so the crown drops in again whenever the lead changes. */}
      <div className="portrait">
        {lead === r.speaker && <Crown key={`crown-${lead}`} />}
        <Avatar speaker={byId.get(r.speaker)} size="xl" />
      </div>
      <strong>{byId.get(r.speaker)?.name}</strong>
      {lead === r.speaker && <span className="winning" key={`win-${lead}`}>vencendo · +{margin}</span>}
      <b className={r.points < 0 ? "neg" : r.points > 0 ? "pos" : ""}>{signed(r.points)}</b>
      <small>{count(r.lies, "mentira", "mentiras")} · {r.adHominem} ad hominem · {count(r.truths, "acerto", "acertos")}</small>
    </div>
  );
  return (
    <div className="duel" aria-label="Duelo principal">
      <span className="sr-only" aria-live="polite">{lead === null ? "Empate" : `${byId.get(lead)?.name} vence por ${margin} pontos`}</span>
      {side(a)}
      <span className="vs">VS</span>
      {side(b)}
    </div>
  );
}

export function Board({ speakers, claims, fallacies, onEdit }: { speakers: Speaker[]; claims: Claim[]; fallacies: Fallacy[]; onEdit: (id: number) => void }) {
  const rows = scoreboard(speakers, claims, fallacies);
  const byId = new Map(speakers.map((s) => [s.id, s]));
  // The duel is between the two voices that talk the most; moderators talk less.
  const duel = [...rows].sort((x, y) => y.talkSeconds - x.talkSeconds).slice(0, 2);
  return (
    <section aria-labelledby="h-board">
      <div className="col-title">
        <h2 id="h-board">Placar</h2>
        <small>clique no falante para nome, foto ou juntar vozes</small>
      </div>
      {duel.length === 2 && <Duel a={duel[0]} b={duel[1]} byId={byId} />}
      <div className="board">
        {!rows.length && <p className="empty pad">O placar aparece quando as primeiras vozes forem identificadas.</p>}
        {rows.map((r) => {
          const sp = byId.get(r.speaker)!;
          return (
            <div className="row" key={r.speaker} style={{ ["--c" as string]: speakerColor(r.speaker) }}>
              <div className="id">
                <Avatar speaker={sp} size="lg" />
                <div>
                  <div className="name">
                    <button type="button" onClick={() => onEdit(r.speaker)} aria-label={`Editar ${sp.name}`}>{sp.name}</button>
                    <span className="voice">voz #{r.speaker + 1} · {fmt(r.talkSeconds)} de fala</span>
                  </div>
                  <div className="counts">
                    <div className="lie"><b>{r.lies}</b>mentiras</div>
                    <div className="mis"><b>{r.misleading}</b>enganosas</div>
                    <div className="ok"><b>{r.truths}</b>acertos</div>
                    <div><b>{r.adHominem}</b>ad hominem</div>
                    <div><b>{r.otherFallacies}</b>outras falácias</div>
                  </div>
                </div>
              </div>
              <div className={`pts ${r.points < 0 ? "neg" : r.points > 0 ? "pos" : ""}`} aria-label={`${r.points} pontos`}>{signed(r.points)}</div>
            </div>
          );
        })}
        <div className="rules">
          <span>verdadeiro +2</span><span>impreciso 0</span><span>enganoso −1</span><span>sem evidência −1</span><span>falso −3</span><span>ad hominem −2</span><span>outra falácia −1</span><span>atribuição incerta não pontua</span>
        </div>
      </div>
    </section>
  );
}
