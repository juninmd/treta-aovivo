import { speakerPhoto } from "../core/score";
import type { Speaker } from "../core/types";

export const speakerColor = (id: number) => `var(--s${(id % 4) + 1})`;

export const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

export function Avatar({ speaker, size = "" }: { speaker: Speaker | undefined; size?: "" | "lg" | "xl" }) {
  if (!speaker) return <span className={`av ${size}`} aria-hidden="true">?</span>;
  const photo = speakerPhoto(speaker);
  return (
    <span className={`av ${size}`} style={{ ["--c" as string]: speakerColor(speaker.id) }} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : initials(speaker.name)}
    </span>
  );
}

export function playClips(clips: string[]) {
  const queue = [...clips];
  const next = () => {
    const c = queue.shift();
    if (!c) return;
    const a = new Audio(`data:audio/wav;base64,${c}`);
    a.onended = next;
    // A refused clip (autoplay policy, bad data) must not stop the rest of the moment.
    a.play().catch(next);
  };
  next();
}
