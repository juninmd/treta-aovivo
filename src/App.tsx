import { useState } from "react";
import { useArchive } from "./app/useArchive";
import { useDebate } from "./app/useDebate";
import { PRESETS } from "./core/providers";
import type { SourceSpec } from "./platform/tauri";
import { Board } from "./ui/Board";
import { Checks } from "./ui/Checks";
import { fmt } from "./ui/common";
import { MomentsDialog } from "./ui/MomentsDialog";
import { SettingsDialog } from "./ui/SettingsDialog";
import { SpeakerDialog } from "./ui/SpeakerDialog";
import { Transcript } from "./ui/Transcript";
import "./styles.css";

const SOURCES: { kind: SourceSpec["kind"]; label: string }[] = [
  { kind: "url", label: "Link" },
  { kind: "file", label: "Arquivo" },
  { kind: "system", label: "Áudio do sistema" },
  { kind: "mic", label: "Microfone" },
];

function withKind(prev: SourceSpec, kind: SourceSpec["kind"]): SourceSpec {
  const speed = "speed" in prev ? prev.speed : 1;
  if (kind === "url") return { kind, url: prev.kind === "url" ? prev.url : "", speed };
  if (kind === "file") return { kind, path: prev.kind === "file" ? prev.path : "", speed };
  return { kind };
}

const sourceLabel = (s?: SourceSpec) => (!s ? "" : s.kind === "url" ? s.url : s.kind === "file" ? s.path : s.kind);

export default function App() {
  const d = useDebate();
  const [cfgOpen, setCfgOpen] = useState(false);
  const [momentsOpen, setMomentsOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const { settings, state } = d;
  const archive = useArchive(d.session, sourceLabel(settings?.source));

  if (!settings) return <main className="loading">Carregando configurações…</main>;
  const src = settings.source;
  const setSource = (s: SourceSpec) => void d.updateSettings({ ...settings, source: s });
  const editingSpeaker = state.speakers.find((s) => s.id === editing) ?? null;
  const needsTools = (src.kind === "url" || src.kind === "file") && d.tools && (!d.tools.ffmpeg || (src.kind === "url" && !d.tools.ytDlp));

  function showClaim(id: string) {
    setFocus(id);
    document.getElementById(`chk-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setFocus(null), 1300);
  }

  return (
    <>
      <header className={`bar ${d.running ? "live" : ""}`}>
        <div className="brand">
          <h1>Treta ao Vivo</h1>
          <span className="onair"><i />{d.running ? "AO VIVO" : state.status === "ended" ? "ENCERRADO" : "PARADO"}</span>
        </div>
        <div className="source">
          <div className="seg" role="group" aria-label="Fonte de áudio">
            {SOURCES.map((s) => (
              <button type="button" key={s.kind} aria-pressed={src.kind === s.kind} disabled={d.running} onClick={() => setSource(withKind(src, s.kind))}>{s.label}</button>
            ))}
          </div>
          {src.kind === "url" && <input className="url" id="src-url" aria-label="Link do vídeo ou live" placeholder="https://www.youtube.com/watch?v=…" value={src.url} disabled={d.running} onChange={(e) => setSource({ ...src, url: e.target.value })} />}
          {src.kind === "file" && <input className="url" id="src-file" aria-label="Caminho do arquivo" placeholder="C:\\videos\\debate.mp4" value={src.path} disabled={d.running} onChange={(e) => setSource({ ...src, path: e.target.value })} />}
          {(src.kind === "url" || src.kind === "file") && (
            <select className="speed" id="src-speed" aria-label="Velocidade" value={src.speed ?? 1} disabled={d.running} onChange={(e) => setSource({ ...src, speed: Number(e.target.value) })}>
              {[1, 1.5, 2, 3, 4].map((v) => <option key={v} value={v}>{v}×</option>)}
            </select>
          )}
          {d.running ? (
            <button type="button" className="btn primary" onClick={() => void d.stop()}>Parar</button>
          ) : (
            <button type="button" className="btn primary" onClick={() => void d.start()}>Iniciar</button>
          )}
          <button type="button" className="btn" disabled={!state.utterances.length} onClick={() => setMomentsOpen(true)}>Melhores momentos</button>
          <button type="button" className="btn" onClick={() => setCfgOpen(true)}>Configurar</button>
        </div>
        <span className="clock" aria-label="Tempo de sessão">{fmt(state.t)}</span>
        <div className="chips">
          <span className="chip">LLM <b>{settings.llm.model || "escolha um modelo"}</b> · {PRESETS[settings.llm.preset].label}</span>
          <span className="chip">transcrição <b>{settings.asr.model || "escolha um modelo"}</b> · {PRESETS[settings.asr.preset].label}</span>
          <span className="chip">busca <b>{{ google: "Google", serper: "Google (Serper)", duckduckgo: "DuckDuckGo" }[settings.search.provider]}</b> + notícias</span>
          <span className="chip">vozes <b>{state.speakers.length}</b>{state.pending ? ` · ${state.pending} tarefas` : ""}</span>
          {archive.saved && <span className="chip" title={archive.saved.path}>salvo <b>{archive.saved.at.toLocaleTimeString("pt-BR")}</b></span>}
          {archive.error && <span className="chip err" title={archive.error}>não salvou no arquivo</span>}
        </div>
        {needsTools && <p className="banner warn">Para links e arquivos, instale {!d.tools?.ffmpeg ? "ffmpeg" : ""}{!d.tools?.ffmpeg && !d.tools?.ytDlp ? " e " : ""}{!d.tools?.ytDlp ? "yt-dlp" : ""} e deixe no PATH.</p>}
        {d.problem && <p className="banner err" role="alert">{d.problem} <button type="button" className="link" onClick={() => d.setProblem(null)}>fechar</button></p>}
        {state.errors.length > 0 && <p className="banner err" role="status">{state.errors.at(-1)} ({state.errors.length} avisos)</p>}
        {state.messages.length > 0 && d.running && <p className="banner">{state.messages.at(-1)}</p>}
      </header>

      <main>
        <Transcript speakers={state.speakers} utterances={state.utterances} claims={state.claims} fallacies={state.fallacies} speaking={state.speaking} running={d.running} onClaim={showClaim} onReassign={(id, speaker) => d.session?.reassignTurn(id, speaker)} />
        <aside>
          <Board speakers={state.speakers} claims={state.claims} fallacies={state.fallacies} onEdit={setEditing} />
          <Checks claims={state.claims} speakers={state.speakers} focus={focus} />
        </aside>
      </main>

      <footer>O veredito apoia a leitura e mostra as fontes; "mentira" no placar significa afirmação classificada como falsa pelas fontes encontradas, não uma conclusão sobre intenção.</footer>

      <SettingsDialog open={cfgOpen} settings={settings} onClose={() => setCfgOpen(false)} onSave={(s) => void d.updateSettings(s)} />
      <SpeakerDialog
        speaker={editingSpeaker}
        others={state.speakers.filter((s) => s.id !== editing)}
        onClose={() => setEditing(null)}
        onSave={(id, name, photo) => { d.session?.renameSpeaker(id, name); d.session?.setPhoto(id, photo); }}
        onMerge={(from, into) => void d.merge(from, into)}
      />
      <MomentsDialog open={momentsOpen} state={state} llm={d.llm} onClose={() => setMomentsOpen(false)} />
    </>
  );
}
