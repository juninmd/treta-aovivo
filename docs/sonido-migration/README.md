# Migração para `@juninmd/sonido` 2.4.0

O treta-aovivo troca oito primitivas escritas à mão pelas do design system. A
identidade do app continua a mesma: as cores, as fontes e as regras de veredito
vêm de `src/styles.css`; o Sonido entra com forma, escala e movimento.

- CSS do Sonido: importado uma vez em `src/main.tsx` (`@juninmd/sonido/styles.css`).
- Tema: `data-theme` no `<html>` acompanha o `prefers-color-scheme`, como o
  `@media (prefers-color-scheme: light)` do app.
- Ponte: `src/ui/sonido-bridge.css` mapeia `--sn-color-*`, `--sn-gradient` e as
  fontes para os tokens do app (`--accent-a`, `--panel`, `--v-false`, …).

## Mapeamento

| Primitiva | Antes (`origin/main`) | Depois | Variante usada |
| --- | --- | --- | --- |
| `LiveBadge` | `.onair` em `src/App.tsx` (linha 57) | `src/App.tsx` | `live`, `label`/`offLabel` |
| `Button` | `.btn` / `.btn.primary` / `.link` em `App.tsx`, `SettingsDialog`, `SpeakerDialog`, `MomentsDialog`, `ModelPicker` | os mesmos arquivos | `size="sm"` no cabeçalho e nos diálogos, `size="xs"` + `appearance="outline"` nas listas densas, `variant="link"` nos links inline |
| `Badge` (soft) | `.chip` em `src/App.tsx` (linhas 82-87) | `src/App.tsx` | `appearance="soft"`, `tone="success"`/`"danger"` para salvo/erro |
| `Badge` (count) | `.counts b` em `src/ui/Board.tsx` (linhas 65-71) | `src/ui/Board.tsx` | `appearance="count"` |
| `Stamp` | `.stamp[data-v]` em `src/ui/Checks.tsx` (linhas 26-28) | `src/ui/Checks.tsx` | `tone` = `true`/`false`/`misleading`/`imprecise`/`none`/`pending` |
| `FilterChips` | `.filters` em `src/ui/Transcript.tsx` (linhas 79-84) | `src/ui/Transcript.tsx` | `allLabel="Todos"`, `aria-pressed` preservado |
| `Equalizer` | `.wave` em `src/ui/Transcript.tsx` (linhas 120 e 139) | `src/ui/Transcript.tsx` | `color="var(--c)"`, decorativo como antes (`aria-hidden`) |
| `EmptyState` | `.empty` em `Board.tsx`, `Checks.tsx`, `Transcript.tsx` | os mesmos arquivos | `title` + `description` com o texto que já existia |
| `Checkbox` | `label.check-row` em `src/ui/SettingsDialog.tsx` (linhas 72-75) | `src/ui/SettingsDialog.tsx` | `<input type="checkbox">` real, `id="voice-faces"` mantido |

Nada de comportamento foi removido: os `onClick`, `disabled`, `type="submit"`,
`aria-pressed`, `aria-live` e os ids usados pelos scripts continuam iguais.
Onde o componente tem `aria-label`/`aria-hidden` próprios, ele segue o padrão
anterior (a onda continua decorativa, o carimbo continua sendo texto lido).

## O que ficou de fora

| Componente | Por quê |
| --- | --- |
| `Dialog` | Os três diálogos usam `<dialog>` + `showModal()` + `<form method="dialog">`; o `Dialog` do Sonido não cobre o submit do form e o reset por abertura ( `openFor`, `useEffect` com `open`). Trocar mudaria comportamento, não só markup. |
| `Duel` | O `Duelist` recebe `avatar?: string` (uma foto pronta). O app desenha iniciais e usa a cor da voz quando não há foto, além do texto `sr-only` com o vencedor. |
| `SubTabs` | O seletor de fonte (`.seg`) fica `disabled` enquanto a sessão roda; `SubTabs` não tem `disabled`. |
| `Tabs` | Mesmo motivo (`disabled`), e o app não tem painéis por aba. |
| `TextField`, `SearchField`, `Switch` | Candidatos naturais para o próximo passo nos formulários de configuração; ficaram fora para manter este PR revisável. |

## Preview (antes/depois)

`preview.html` + `preview.tsx` mostram, lado a lado, o markup antigo
(`legacy/`, copiado de `origin/main` @ `1f79fa1`) e o componente do Sonido, com o
CSS real do app (`src/styles.css`).

```sh
node node_modules/vite/bin/vite.js --config docs/sonido-migration/vite.config.ts
# http://localhost:5312/docs/sonido-migration/preview.html          (as duas colunas)
# http://localhost:5312/docs/sonido-migration/preview.html?col=before
# http://localhost:5312/docs/sonido-migration/preview.html?col=after
```

As imagens do PR saem do mesmo script de captura, em 1180x900 @2x:

```sh
node C:/Users/jr_ac/AppData/Local/Temp/opencode/shot/full.cjs \
  "http://localhost:5312/docs/sonido-migration/preview.html?col=before" \
  "D:/Solutions/pessoal/wt-sonido/treta-aovivo/docs/sonido-migration/before.png"
node C:/Users/jr_ac/AppData/Local/Temp/opencode/shot/full.cjs \
  "http://localhost:5312/docs/sonido-migration/preview.html?col=after" \
  "D:/Solutions/pessoal/wt-sonido/treta-aovivo/docs/sonido-migration/after.png"
```

`legacy/legacy.css` guarda as regras antigas exatamente como estavam em
`origin/main:src/styles.css`; `preview.css` fixa o tema escuro (o app segue o
sistema operacional, o preview não pode depender da máquina que tira a foto).

## Notas

- **Peso do CSS**: o `sonido.css` empacota a biblioteca inteira (≈145 kB, 30 kB
  gzip). O bundle do app foi de 19 kB para 164 kB de CSS. Um import por
  componente reduziria isso, mas o pacote só publica o bundle completo.
- **`minimumReleaseAge`**: 2.4.0 saiu hoje; `pnpm-workspace.yaml` ganhou
  `minimumReleaseAgeExclude: ["@juninmd/sonido@2.4.0"]` (só essa versão, não o
  escopo). Remover a entrada quando a versão completar três dias.
- **Cabeçalho em 1180 px**: a linha de fonte quebra em duas alturas antes e
  depois (medido: 73,5 px em `origin/main`, 75 px com `Button size="sm"`); os
  botões ficam 4 px mais largos cada.
