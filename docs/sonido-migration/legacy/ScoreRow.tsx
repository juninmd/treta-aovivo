/**
 * OLD markup, kept for the before/after preview only.
 * Source: `git show origin/main:src/ui/Board.tsx` @ 1f79fa1 — the five counters of
 * one scoreboard row (`<div className="counts">`, lines 65-71).
 * No app code imports this file.
 */
import { Avatar } from "../../../src/ui/common";
import type { Speaker } from "../../../src/core/types";

const SPEAKER: Speaker = { id: 1, name: "Helena Prado", portraits: [], talkSeconds: 194 };

export function LegacyScoreRow() {
  return (
    <div className="board">
      <div className="row" style={{ ["--c" as string]: "var(--s2)" }}>
        <div className="id">
          <Avatar speaker={SPEAKER} size="lg" />
          <div>
            <div className="name">
              <button type="button">Helena Prado</button>
              <span className="voice">voz #2 · 03:14 de fala</span>
            </div>
            <div className="counts">
              <div className="lie"><b>1</b>mentiras</div>
              <div className="mis"><b>0</b>enganosas</div>
              <div className="ok"><b>2</b>acertos</div>
              <div><b>1</b>ad hominem</div>
              <div><b>0</b>outras falácias</div>
            </div>
          </div>
        </div>
        <div className="pts pos" aria-label="4 pontos">+4</div>
      </div>
    </div>
  );
}
