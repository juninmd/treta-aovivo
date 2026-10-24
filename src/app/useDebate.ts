import type { LanguageModel } from "ai";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createDebateSession, todayISO } from "../core/pipeline";
import type { DebateSession, SessionState } from "../core/session";
import { checkTools, httpFetch, mergeVoices, startEngine, stopEngine } from "../platform/tauri";
import { loadSettings, participantList, saveSettings, searchSettings, type Settings } from "./settings";

const EMPTY: SessionState = {
  status: "idle", t: 0, speaking: false, level: 0, speakers: [], utterances: [], claims: [], fallacies: [], messages: [], errors: [], timings: [], pending: 0,
};
const noSubscribe = () => () => {};
const emptyState = () => EMPTY;

export function useDebate() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [session, setSession] = useState<DebateSession | null>(null);
  const [llm, setLlm] = useState<LanguageModel | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tools, setTools] = useState<{ ytDlp: boolean; ffmpeg: boolean } | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings, (e) => setProblem(`Não consegui ler as configurações: ${String(e)}`));
    checkTools().then(setTools, () => setTools(null));
  }, []);

  const state = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getState ?? emptyState);

  const updateSettings = useCallback(async (next: Settings) => {
    setSettings(next);
    try {
      await saveSettings(next);
    } catch (e) {
      setProblem(`Configuração aplicada, mas o cofre de senhas recusou salvar: ${String(e)}`);
    }
  }, []);

  const start = useCallback(async () => {
    if (!settings) return;
    setProblem(null);
    if (!settings.llm.model || !settings.asr.model) {
      setProblem("Escolha o modelo de LLM e o de transcrição em Configurar.");
      return;
    }
    const src = settings.source;
    if ((src.kind === "url" && !src.url.trim()) || (src.kind === "file" && !src.path.trim())) {
      setProblem("Informe o link ou o arquivo do debate.");
      return;
    }
    try {
      const created = createDebateSession(
        { llm: settings.llm, asr: settings.asr, search: searchSettings(settings.search), today: todayISO(), participants: participantList(settings.participants) },
        httpFetch,
      );
      setSession(created.session);
      setLlm(created.llm);
      await startEngine(src, settings.voice, (ev) => created.session.handle(ev));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, [settings]);

  const stop = useCallback(async () => {
    await stopEngine();
  }, []);

  const merge = useCallback(
    async (from: number, into: number) => {
      session?.mergeSpeakers(from, into);
      await mergeVoices(from, into).catch(() => false);
    },
    [session],
  );

  const running = state.status === "running";
  return useMemo(
    () => ({ settings, updateSettings, session, llm, state, running, start, stop, merge, problem, setProblem, tools }),
    [settings, updateSettings, session, llm, state, running, start, stop, merge, problem, tools],
  );
}

export type Debate = ReturnType<typeof useDebate>;
