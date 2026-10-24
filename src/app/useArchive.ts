import { useEffect, useState } from "react";
import { toSnapshot, type DebateMeta } from "../core/archive";
import type { DebateSession } from "../core/session";
import { saveDebate } from "../platform/tauri";

/** At most one write per interval while the debate runs; the end is saved at once. */
const SAVE_EVERY_MS = 4000;

/** Keeps the running debate in the SQLite archive so a crash or a closed window loses seconds, not the debate. */
export function useArchive(session: DebateSession | null, source: string) {
  const [saved, setSaved] = useState<{ at: Date; path: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const meta: DebateMeta = { id: crypto.randomUUID(), source, startedAt: new Date().toISOString() };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let endSaved = false;
    // Saves run one after another so an older snapshot never commits after a newer one.
    let queue: Promise<void> = Promise.resolve();
    const flush = () => {
      timer = undefined;
      queue = queue.then(() =>
        saveDebate(toSnapshot(meta, session.getState())).then(
          (path) => { setSaved({ at: new Date(), path }); setError(null); },
          (e) => setError(String(e)),
        ),
      );
    };
    const unsubscribe = session.subscribe(() => {
      if (session.getState().status === "ended" && !endSaved) {
        endSaved = true;
        clearTimeout(timer);
        return flush();
      }
      timer ??= setTimeout(flush, SAVE_EVERY_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
      // Checks still running when a new debate starts land in this one's archive.
      void session.whenIdle().then(flush);
    };
    // A new session is a new debate; the source is read once at its start.
  }, [session]);

  return { saved, error };
}
