import { transcribe, type TranscriptionModel } from "ai";

/** Phrases Whisper invents on silence, music or applause (pt and en). */
const HALLUCINATIONS = [
  /legendas? (pela|por) comunidade/i,
  /amara\.org/i,
  /^obrigad[oa] (por assistir|pela aten[cç][aã]o)\.?$/i,
  /inscreva-se no canal/i,
  /^thanks? for watching\.?$/i,
  /^\[?(m[uú]sica|aplausos|risos)\]?\.?$/i,
];

export function cleanTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || HALLUCINATIONS.some((re) => re.test(t))) return "";
  // A single token repeated many times is a decoding loop, not speech.
  const words = t.toLowerCase().split(" ");
  if (words.length >= 8 && new Set(words).size <= 2) return "";
  return t;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface TranscribeOptions {
  language?: string;
  /** Previous text; Whisper uses it to keep names and spelling consistent. */
  prompt?: string;
  abortSignal?: AbortSignal;
}

export async function transcribeClip(model: TranscriptionModel, wavBase64: string, opts: TranscribeOptions = {}): Promise<string> {
  const result = await transcribe({
    model,
    audio: base64ToBytes(wavBase64),
    abortSignal: opts.abortSignal,
    providerOptions: {
      openai: {
        language: opts.language || undefined,
        prompt: opts.prompt ? opts.prompt.slice(-400) : undefined,
        temperature: 0,
      },
    },
  });
  return cleanTranscript(result.text);
}
