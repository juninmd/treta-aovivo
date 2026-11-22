# AGENTS.md

Treta ao Vivo: a Tauri 2 desktop app that follows a live debate. It transcribes speech, separates speakers by voice, fact-checks claims against news and web search, and keeps a source-backed scoreboard. It does not edit video, publish, or judge intent.

## Stack
- Frontend: React 19, TypeScript, Vite, Vercel AI SDK 7 (`src/core`, `src/ui`, `src/app`).
- Desktop shell and voice engine: Rust in `src-tauri/` (Tauri 2). Speaker diarization via sherpa-onnx (CAM++) in the `treta-engine` binary.
- Local ASR (optional): Python server in `tools/whisper-server/`, run with `uv`.
- Platform: Windows 11 is the only validated target. Requires Node 22+, pnpm 10, stable Rust, `ffmpeg` and `yt-dlp` on PATH.

## Commands
- Install: `pnpm install --frozen-lockfile`
- App with hot reload: `pnpm tauri dev`
- Frontend dev only: `pnpm dev`; build: `pnpm build` (`tsc && vite build`)
- Typecheck (app and scripts): `pnpm typecheck`
- Tests: `pnpm test` (vitest)
- Rust: `cargo clippy --locked --all-targets -- -D warnings` and `cargo test --locked --lib` (run in `src-tauri/`, as in CI on Windows)
- Real-video smoke: `pnpm homologate --url <link>` (writes `homologation/report.{md,json}`)
- README screenshots: `pnpm screenshots`
- Local Whisper server: `pnpm whisper:local`

## Structure
- `src/core/`: pipeline, transcription, fact-checking, scoring, search and provider logic (pure, unit-tested)
- `src/app/`: React hooks and settings state; `src/ui/`: components; `src/platform/tauri.ts`: the Tauri bridge
- `src-tauri/src/engine/`: diarization, face capture, video and WAV handling; `src-tauri/src/bin/treta-engine.rs`: engine binary
- `src-tauri/src/secrets.rs`: API key storage; `store.rs`, `search.rs`, `sidecar.rs`: app backend
- `scripts/`: homologation, report, and screenshot tooling
- `.github/workflows/`: `ci.yml` (typecheck, test, build on Linux; clippy and Rust tests on Windows), `central-validate.yml`, `central-security.yml`, `sast.yml`

## Conventions
- Conventional Commits (`fix:`, `feat:`, `docs:`). A bug fix lands with a test that failed before the fix.
- A PR needs green CI before merge.
- API keys live only in the OS credential store (`secrets.rs`), never in config files or the repo. The allowed secret names are a fixed list there; keep it closed.
- Env vars read by the scripts and core (names only): `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_REASONING`, `ASR_BASE_URL`, `ASR_MODEL`, `ASR_API_KEY`, `VOICE_MODEL`, `VOICE_THRESHOLD`, `SEARCH`, `GOOGLE_API_KEY`, `GOOGLE_CSE_ID`, `SERPER_API_KEY`, `PARTICIPANTS`, `BROWSER_CHANNEL`, `TZ`, `TRETA_FACE_SAMPLE`.
- The `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320`: new package versions are blocked for three days. Do not bypass it to get a fresh release.

## Gotchas
- Speaker attribution is uncertain on purpose: overlapping speech, self-named speakers and near-silent voices stay unscored until someone reviews them. Do not "fix" this by forcing attribution.
- The first session downloads the voice models (about 30 MB, sha256-checked) into the app data folder.
- The `src-tauri/assets/seeta_fd_frontal_v1.0.bin` model and its license are tracked in git; do not replace it casually.
- `pnpm homologate` runs against a real video and real providers. It is not part of CI.
- There is no installer yet: the app runs from source.
