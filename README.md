<div align="center">

# Treta ao Vivo

Transcreve debates em tempo real, separa quem fala pela voz, checa afirmações na web e mantém um placar de quem acertou, enganou ou partiu para o ataque pessoal.

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB) ![React 19](https://img.shields.io/badge/React-19-61DAFB) ![AI SDK 7](https://img.shields.io/badge/AI%20SDK-7-black) ![sherpa-onnx 2.0](https://img.shields.io/badge/sherpa--onnx-2.0.0-orange)

[Como funciona](#como-funciona) · [Rodar](#rodar) · [Numa live](#numa-live) · [Homologação](#homologação) · [Limitações](#limitações) · [Problemas comuns](#problemas-comuns)

</div>

## Como funciona

```
fonte ──► motor de voz (processo separado) ──► app (React + AI SDK)
link       VAD silero                           Whisper (OpenAI-compatible)
arquivo    voz CAM++ → quem fala                turnos → LLM: afirmações e falácias
áudio      fotos do vídeo (rosto dominante)     busca (DuckDuckGo / Google / Serper)
microfone  sobreposição de vozes                veredito com fontes → placar
```

- **Quem fala:** o motor (Rust, `src-tauri/src/engine`) agrupa vozes por embedding (CAM++) e manda cada trecho com áudio para o app.
- **O que foi dito:** cada trecho vai para um endpoint `/v1/audio/transcriptions` (Whisper local incluso em `tools/whisper-server`).
- **Checagem:** o LLM extrai afirmações verificáveis (com citação exata) e falácias; cada afirmação é buscada no Google Notícias (RSS, sem chave) e na web, e julgada com manchetes datadas e fontes. Pontos: verdadeiro +2, impreciso 0, enganoso −1, sem evidência −1, falso −3, ad hominem −2, outra falácia −1.
- **Fotos:** durante falas longas o motor pega o quadro do vídeo e recorta o rosto que domina a cena; a foto automática só aparece com 3+ capturas (cortes de câmera não viram foto errada).
- **Fala sobreposta:** quando duas pessoas falam juntas, ou a fala chama o próprio falante pelo nome, o turno sai como **atribuição incerta** e não pontua.
- **Nomes:** inferidos da fala (cumprimentos, "arroba Fulano", quem é chamado antes de responder) e conferidos: quem chama "Lula" pelo nome não pode ser o Lula, e os debatedores são trocados quando o palpite contradiz a transcrição.
- **Revisão:** clique no nome de qualquer turno para corrigir quem falou; o turno fica "revisado" e passa a contar.
- **Quem vence:** o líder do duelo ganha coroa animada e destaque; a coroa cai de novo quando a liderança muda.
- **Arquivo:** cada debate é salvo continuamente (a cada 4 s e ao terminar) em `treta.sqlite` na pasta de dados do app, com vozes, fotos escolhidas, turnos, checagens com fontes e falácias.

## Rodar

Requisitos: Windows 11 (homologado), Node 22+, pnpm 10, Rust estável, `ffmpeg` e `yt-dlp` no PATH, um LLM OpenAI-compatible (Ollama, LiteLLM, OpenRouter, OpenAI, Groq…) e, para o Whisper local, GPU NVIDIA + [uv](https://docs.astral.sh/uv/).

```sh
pnpm install
pnpm whisper:local        # outro terminal: Whisper large-v3-turbo em 127.0.0.1:8765
pnpm tauri dev
```

Na primeira sessão o motor baixa os modelos de voz (≈30 MB com o padrão CAM++, sha256 verificado) para a pasta de dados do app. Em **Configurar** escolha provedor e modelo de LLM (lista lida de `/v1/models`, nada fixo no código), transcrição e busca. Chaves ficam no cofre de credenciais do sistema, nunca no `localStorage`.

## Numa live

1. **Configurar → Participantes:** `Lula; Flávio Bolsonaro; Nome do mediador` (ajuda a nomear as vozes).
2. **Link** com a URL da live do YouTube e velocidade **1×** → **Iniciar**. O áudio começa entre 3 e 30 s; se demorar, aparece "A fonte não envia áudio há 15 s".
3. Transmissão fora do YouTube (Globoplay, site da emissora): toque no navegador e use **Áudio do sistema**. Não há vídeo nesse modo, então escolha as fotos no diálogo do falante.
4. Clique num falante para corrigir nome, escolher foto ou **juntar vozes** (quando a mesma pessoa virou duas vozes). Clique no nome de um turno para dizer quem realmente falou.
5. **Melhores momentos** ao final: pódio, resumo e trechos com áudio.

Recomendado: LLM sem raciocínio estendido para acompanhar o ritmo (Ollama `qwen3.5:9b` com `reasoning_effort: none` responde em ~0,7 s).

## Homologação

Roda o mesmo pipeline do app sem interface e gera `homologation/report.md` (+ `report.json` e fotos):

```sh
LLM_MODEL=qwen3.5:9b pnpm homologate --speed 2                    # vídeo de referência
PARTICIPANTS="Lula; Flávio Bolsonaro" pnpm homologate --url <link> --speed 1
pnpm homologate --file debate.mp4 --limit-seconds 300
```

| variável | padrão |
|---|---|
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_REASONING` | Ollama local / primeiro modelo listado / — / `none` |
| `ASR_BASE_URL` / `ASR_MODEL` | `http://127.0.0.1:8765/v1` / primeiro listado |
| `SEARCH` (`duckduckgo`, `google`, `serper`) + `GOOGLE_API_KEY`, `GOOGLE_CSE_ID`, `SERPER_API_KEY` | `duckduckgo` |
| `VOICE_MODEL` / `VOICE_THRESHOLD` | `3dspeaker-campplus` / `0.55` |
| `PARTICIPANTS` | vazio |

## Limitações

- Duas pessoas falando ao mesmo tempo não têm atribuição confiável; esses turnos ficam marcados e fora do placar.
- O veredito depende das fontes encontradas. "Mentira" no placar significa afirmação classificada como falsa pelas fontes, não uma conclusão sobre intenção.
- O DuckDuckGo pode limitar buscas em sequência; Google Custom Search ou Serper (com chave) são mais estáveis.
- Mesma pessoa em duas vozes acontece quando a voz muda muito (grito, microfone); use "juntar vozes".

## Problemas comuns

| sintoma | causa e saída |
|---|---|
| "O motor de voz caiu (0xC0000409)" | Faltou memória e o onnxruntime abortou. O motor roda em processo separado, então a transcrição fica; feche programas pesados e inicie de novo. |
| Checagens com "DuckDuckGo recusou a busca" | Limite do DuckDuckGo (o app espera e tenta de novo; as notícias seguem valendo). Para uma live longa, use Google ou Serper com chave. |
| Onde ficam os debates salvos | `%APPDATA%\dev.juninmd.treta-aovivo\treta.sqlite` (tabelas `debates`, `speakers`, `utterances`, `claims`, `fallacies`); passe o mouse no chip "salvo" para ver o caminho. |
| Build Rust muito lento no Windows | O antivírus escaneia `target/` e o cache de build; uma exclusão dessas pastas é decisão de quem administra a máquina. |
| Nomes "Falante N" | Preencha Participantes ou renomeie clicando no falante; o app tenta de novo a cada 20 turnos. |

## Desenvolvimento

```sh
pnpm typecheck && pnpm test                    # TypeScript (core, sessão, provedores)
cd src-tauri && cargo test --lib               # motor: clusters, sobreposição, vídeo, protocolo
cargo test --lib -- --ignored                  # exige modelos (TRETA_MODELS_DIR) e TRETA_FACE_SAMPLE
```

`treta-engine` (`src-tauri/src/bin`) é o motor em linha de comando: imprime os mesmos eventos JSONL que o app recebe.
