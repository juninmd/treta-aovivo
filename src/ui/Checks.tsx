import { openUrl } from "@tauri-apps/plugin-opener";
import { httpUrl } from "../core/search";
import type { Claim, Speaker } from "../core/types";
import { Avatar, count, fmt, speakerColor } from "./common";

const STAMP: Record<Claim["status"], string> = { searching: "buscando…", judging: "julgando…", done: "", error: "falhou" };

export function Checks({ claims, speakers, focus }: { claims: Claim[]; speakers: Speaker[]; focus: string | null }) {
  const byId = new Map(speakers.map((s) => [s.id, s]));
  const done = claims.filter((c) => c.status === "done").length;
  return (
    <section aria-labelledby="h-checks">
      <div className="col-title">
        <h2 id="h-checks">Checagens</h2>
        <small>{count(done, "concluída", "concluídas")} · {claims.length - done} em andamento</small>
      </div>
      <div className="checks">
        {!claims.length && <p className="empty">Números, valores e dados citados aparecem aqui com o veredicto e as fontes.</p>}
        {[...claims].reverse().map((c) => {
          const sp = byId.get(c.speaker);
          return (
            <article key={c.id} id={`chk-${c.id}`} className={`check ${focus === c.id ? "flash" : ""}`} style={{ ["--c" as string]: speakerColor(c.speaker) }}>
              <header>
                <span className="who-line"><Avatar speaker={sp} /><span className="spk">{sp?.name} · {fmt(c.at)}{c.uncertain && " · atribuição incerta"}</span></span>
                <span className="stamp" data-v={c.status === "done" ? c.verdict : c.status === "error" ? "erro" : "checando"}>
                  {c.status === "done" ? c.verdict : STAMP[c.status]}
                </span>
              </header>
              <blockquote>“{c.quote}”</blockquote>
              <div className="q">busca: {c.query}</div>
              {c.explanation && <p className="why">{c.explanation}</p>}
              {c.error && <p className="why err">{c.error}</p>}
              {!!c.sources?.length && (
                <ul className="src">
                  {c.sources.map((s) => {
                    // Sources come from the web: only http(s) links open, and a malformed one must not break the page.
                    const url = httpUrl(s.url);
                    return (
                      <li key={s.url}>
                        <button type="button" className="link" disabled={!url} onClick={() => url && void openUrl(url)}>{s.title || s.url}</button>
                        {url && <span> — {new URL(url).hostname}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {c.confidence != null && <div className="conf">confiança {Math.round(c.confidence * 100)}%</div>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
