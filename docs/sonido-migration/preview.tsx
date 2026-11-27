/**
 * Before/after preview used by the Sonido 2.4.0 migration PR.
 *
 * Left column: the hand-rolled primitives exactly as they were on origin/main
 * (`./legacy/*`, rules in `./legacy/legacy.css`, copied from that commit).
 * Right column: the same states built with `@juninmd/sonido`.
 * Both use the app's real stylesheet (src/styles.css) and its palette; the page
 * pins data-theme="dark" because the app itself follows the OS color scheme.
 *
 *   vite --config docs/sonido-migration/vite.config.ts   # port 5312
 */
import { Badge, Button, Checkbox, EmptyState, Equalizer, FilterChips, LiveBadge, Stamp, type StampTone } from "@juninmd/sonido";
import type { ReactNode } from "react";
import { useState } from "react";
import "@juninmd/sonido/styles.css";
import "../../src/ui/sonido-bridge.css";
import "../../src/styles.css";
import "./legacy/legacy.css";
import "./preview.css";
import { LegacyFacesToggle } from "./legacy/FacesToggle";
import { LegacyHeaderActions } from "./legacy/HeaderActions";
import { LegacyLiveBadge } from "./legacy/LiveBadge";
import { LegacyScoreRow } from "./legacy/ScoreRow";
import { LegacyStatusChips } from "./legacy/StatusChips";
import { LegacyEmptyNote, LegacySpeakingWave, LegacySpeakerFilter } from "./legacy/TranscriptBits";
import { LegacyVerdictStamps } from "./legacy/VerdictStamps";

// Fictional names from scripts/screenshots/fixture.ts: no real person is scored.
const PEOPLE = ["Marta Lins", "Helena Prado", "Rafael Teixeira"];
const VERDICTS: { tone: StampTone; label: string }[] = [
  { tone: "true", label: "verdadeiro" },
  { tone: "imprecise", label: "impreciso" },
  { tone: "misleading", label: "enganoso" },
  { tone: "false", label: "falso" },
  { tone: "none", label: "sem evidência" },
  { tone: "pending", label: "buscando…" },
];

function Row({ title, source, before, after, only }: { title: string; source: string; before: ReactNode; after: ReactNode; only: View }) {
  return (
    <section className="pv-row">
      <div className="pv-row-head">
        <h2>{title}</h2>
        <code>{source}</code>
      </div>
      <div className={only === "both" ? "pv-cols" : "pv-cols pv-cols--single"}>
        {only !== "after" && (
          <div className="pv-cell">
            <p className="pv-label">Antes · componente do treta-aovivo</p>
            <div className="pv-canvas">{before}</div>
          </div>
        )}
        {only !== "before" && (
          <div className="pv-cell pv-cell--after">
            <p className="pv-label">Depois · @juninmd/sonido</p>
            <div className="pv-canvas">{after}</div>
          </div>
        )}
      </div>
    </section>
  );
}

type View = "both" | "before" | "after";

export function Preview({ only = "both" }: { only?: View }) {
  const [speaker, setSpeaker] = useState<string | null>("1");
  const [faces, setFaces] = useState(true);

  return (
    <main className="pv">
      <header className="pv-head">
        <p className="pv-kicker">treta-aovivo · @juninmd/sonido 2.4.0</p>
        <h1>Primitivas do app, agora do Sonido</h1>
        <p className="pv-lede">
          {only === "before" && (
            <>Esta coluna reproduz o markup que existia em <code>origin/main</code>, com as regras antigas de{" "}
            <code>src/styles.css</code> copiadas em <code>legacy/legacy.css</code>.</>
          )}
          {only === "after" && (
            <>Esta coluna usa os componentes do <code>@juninmd/sonido</code> 2.4.0 com a ponte de tokens do app
            (<code>src/ui/sonido-bridge.css</code>): mesmas cores, mesmas fontes, outra implementação.</>
          )}
          {only === "both" && (
            <>Mesmo palco, mesmas cores de veredito, mesma informação. À esquerda, o markup que existia em{" "}
            <code>origin/main</code>; à direita, os componentes do Sonido com a ponte de tokens do app
            (<code>src/ui/sonido-bridge.css</code>).</>
          )}
        </p>
      </header>

      <Row
        title="Selo ao vivo"
        only={only}
        source="src/App.tsx → LiveBadge"
        before={
          <div className="pv-stack">
            <LegacyLiveBadge running ended={false} />
            <LegacyLiveBadge running={false} ended={false} />
            <LegacyLiveBadge running={false} ended />
          </div>
        }
        after={
          <div className="pv-stack">
            <LiveBadge live label="AO VIVO" />
            <LiveBadge live={false} label="AO VIVO" offLabel="PARADO" />
            <LiveBadge live={false} label="AO VIVO" offLabel="ENCERRADO" />
          </div>
        }
      />

      <Row
        title="Botões de ação"
        only={only}
        source="src/App.tsx, src/ui/*Dialog.tsx → Button"
        before={<LegacyHeaderActions />}
        after={
          <div className="source">
            <Button size="sm">Iniciar</Button>
            <Button size="sm" appearance="outline" disabled>Melhores momentos</Button>
            <Button size="sm" appearance="outline">Configurar</Button>
            <p className="banner err" role="alert">
              Não consegui abrir o link do debate. <Button variant="link">fechar</Button>
            </p>
          </div>
        }
      />

      <Row
        title="Chips de status"
        only={only}
        source="src/App.tsx → Badge (soft)"
        before={<LegacyStatusChips />}
        after={
          <div className="chips">
            <Badge><span>LLM <b>qwen3.5:9b</b> · Ollama (local)</span></Badge>
            <Badge><span>transcrição <b>large-v3-turbo</b> · Whisper local</span></Badge>
            <Badge><span>busca <b>DuckDuckGo</b> + notícias</span></Badge>
            <Badge><span>vozes <b>3</b></span></Badge>
            <Badge tone="success" title="~/treta/2026-11-27.json"><span>salvo <b>21:14:02</b></span></Badge>
            <Badge tone="danger" title="disco cheio"><span>não salvou no arquivo</span></Badge>
          </div>
        }
      />

      <Row
        title="Contadores do placar"
        only={only}
        source="src/ui/Board.tsx → Badge (count)"
        before={<LegacyScoreRow />}
        after={
          <div className="board">
            <div className="row" style={{ ["--c" as string]: "var(--s2)" }}>
              <div className="id">
                <span className="av lg" style={{ ["--c" as string]: "var(--s2)" }} aria-hidden="true">HP</span>
                <div>
                  <div className="name">
                    <button type="button">Helena Prado</button>
                    <span className="voice">voz #2 · 03:14 de fala</span>
                  </div>
                  <div className="counts">
                    <div className="lie"><Badge appearance="count" aria-label="1 mentira">1</Badge>mentiras</div>
                    <div className="mis"><Badge appearance="count" aria-label="0 afirmações enganosas">0</Badge>enganosas</div>
                    <div className="ok"><Badge appearance="count" aria-label="2 acertos">2</Badge>acertos</div>
                    <div><Badge appearance="count" aria-label="1 ad hominem">1</Badge>ad hominem</div>
                    <div><Badge appearance="count" aria-label="0 outras falácias">0</Badge>outras falácias</div>
                  </div>
                </div>
              </div>
              <div className="pts pos" aria-label="4 pontos">+4</div>
            </div>
          </div>
        }
      />

      <Row
        title="Carimbo de veredito"
        only={only}
        source="src/ui/Checks.tsx → Stamp"
        before={<LegacyVerdictStamps />}
        after={
          <div className="pv-stack">
            <article className="check">
              <header>
                <span className="who-line"><span className="spk">Helena Prado · 00:19</span></span>
                <Stamp tone="false">falso</Stamp>
              </header>
              <blockquote>“O desemprego em Vila Aurora é o maior da região, 14%.”</blockquote>
            </article>
            <div className="pv-chips">
              {VERDICTS.map((v) => <Stamp key={v.tone} tone={v.tone}>{v.label}</Stamp>)}
              <Stamp tone="pending">falhou</Stamp>
            </div>
          </div>
        }
      />

      <Row
        title="Filtro de falante"
        only={only}
        source="src/ui/Transcript.tsx → FilterChips"
        before={<LegacySpeakerFilter />}
        after={
          <FilterChips
            label="Filtrar por falante"
            allLabel="Todos"
            chips={PEOPLE.map((name, id) => ({ key: String(id), label: name }))}
            value={speaker}
            onChange={setSpeaker}
          />
        }
      />

      <Row
        title="Onda de quem fala"
        only={only}
        source="src/ui/Transcript.tsx → Equalizer"
        before={<LegacySpeakingWave />}
        after={
          <div className="turn" style={{ ["--c" as string]: "var(--s2)" }}>
            <div className="side"><span className="t">00:19</span></div>
            <div>
              <span className="who">Helena Prado</span>
              <Equalizer color="var(--c)" />
              <p>…a tarifa de ônibus subiu 30% em dois anos.</p>
            </div>
          </div>
        }
      />

      <Row
        title="Estado vazio"
        only={only}
        source="src/ui/Transcript.tsx → EmptyState"
        before={<LegacyEmptyNote />}
        after={<EmptyState title="Ouvindo…" description="A primeira fala aparece alguns segundos depois de terminar." />}
      />

      <Row
        title="Opção do formulário"
        only={only}
        source="src/ui/SettingsDialog.tsx → Checkbox"
        before={<LegacyFacesToggle />}
        after={
          <div className="pv-field">
            <Checkbox
              id="pv-voice-faces-after"
              checked={faces}
              onChange={setFaces}
              label="Capturar fotos de quem fala a partir do vídeo (link ou arquivo)"
            />
          </div>
        }
      />

      <footer className="pv-foot">
        Ficaram de fora, com motivo: <code>Dialog</code> (os três diálogos usam <code>showModal()</code> + form submit),
        <code> Duel</code> (o avatar é foto pronta; o app desenha iniciais e cor por voz), <code>SubTabs</code> (não tem
        estado <code>disabled</code>) e <code>Tabs</code> (idem). Detalhes no README.
      </footer>
    </main>
  );
}
