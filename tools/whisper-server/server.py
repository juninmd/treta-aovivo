# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "faster-whisper==1.2.1",
#   "ctranslate2==4.7.2",
#   "numpy>=1.26",
#   "nvidia-cublas-cu12==12.9.2.10; sys_platform != 'darwin'",
#   "nvidia-cudnn-cu12==9.27.0.42; sys_platform != 'darwin'",
# ]
# ///
"""Local OpenAI-compatible transcription server backed by faster-whisper.

Implements just what the app uses:
  GET  /v1/models
  POST /v1/audio/transcriptions   (multipart: file, model, language, prompt, response_format, temperature)

Binds to 127.0.0.1 only. Usage (uv builds an isolated env with the CUDA libs):
  uv run tools/whisper-server/server.py --model large-v3-turbo --port 8765
  uv run tools/whisper-server/server.py --device cpu --compute-type int8   # no GPU
"""

from __future__ import annotations

import argparse
import email.parser
import email.policy
import io
import json
import threading
import time
import wave
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _expose_cuda_libs() -> None:
    """ctranslate2 loads cuBLAS/cuDNN by name; point the loader at the pip-installed copies."""
    for base in map(Path, sys.path):
        for sub in ("nvidia/cublas/bin", "nvidia/cudnn/bin", "nvidia/cublas/lib", "nvidia/cudnn/lib"):
            d = base / sub
            if d.is_dir():
                os.environ["PATH"] = f"{d}{os.pathsep}{os.environ.get('PATH', '')}"
                if hasattr(os, "add_dll_directory"):
                    os.add_dll_directory(str(d))


_expose_cuda_libs()

import numpy as np  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402

MAX_BODY = 50 * 1024 * 1024


class UnsupportedAudio(ValueError):
    pass


def load_audio(data: bytes) -> np.ndarray:
    """Accepts 16 kHz mono 16-bit WAV (what the app sends), decoded without ffmpeg/PyAV."""
    try:
        with wave.open(io.BytesIO(data)) as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2):
                pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
                return pcm.astype(np.float32) / 32768.0
    except (wave.Error, EOFError):
        pass
    raise UnsupportedAudio("send 16 kHz mono 16-bit PCM WAV")


def parse_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body
    )
    fields: dict[str, bytes] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name:
            fields[name] = part.get_payload(decode=True) or b""
    return fields


class Transcriber:
    def __init__(self, model: str, device: str, compute_type: str) -> None:
        self.name = model
        self.model = WhisperModel(model, device=device, compute_type=compute_type)
        self.lock = threading.Lock()

    def transcribe(self, audio: bytes, language: str | None, prompt: str | None, temperature: float) -> dict:
        started = time.perf_counter()
        with self.lock:
            segments, info = self.model.transcribe(
                load_audio(audio),
                language=language or None,
                initial_prompt=prompt or None,
                temperature=temperature,
                beam_size=5,
                vad_filter=False,
                condition_on_previous_text=False,
            )
            segs = list(segments)
        text = "".join(s.text for s in segs).strip()
        return {
            "task": "transcribe",
            "language": info.language,
            "duration": info.duration,
            "text": text,
            "segments": [
                {
                    "id": i,
                    "seek": s.seek,
                    "start": s.start,
                    "end": s.end,
                    "text": s.text,
                    "tokens": list(s.tokens),
                    "temperature": s.temperature,
                    "avg_logprob": s.avg_logprob,
                    "compression_ratio": s.compression_ratio,
                    "no_speech_prob": s.no_speech_prob,
                }
                for i, s in enumerate(segs)
            ],
            "x_elapsed_ms": round((time.perf_counter() - started) * 1000),
        }


def make_handler(t: Transcriber):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:  # quiet by default
            pass

        def _json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _error(self, code: int, message: str) -> None:
            self._json(code, {"error": {"message": message, "type": "invalid_request_error"}})

        def do_GET(self) -> None:
            if self.path.rstrip("/") in ("/v1/models", "/models"):
                self._json(200, {"object": "list", "data": [{"id": t.name, "object": "model", "owned_by": "local"}]})
            elif self.path == "/health":
                self._json(200, {"ok": True, "model": t.name})
            else:
                self._error(404, "not found")

        def do_POST(self) -> None:
            if self.path.rstrip("/") not in ("/v1/audio/transcriptions", "/audio/transcriptions"):
                return self._error(404, "not found")
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._error(413, f"body must be 1..{MAX_BODY} bytes")
            ctype = self.headers.get("Content-Type", "")
            if not ctype.startswith("multipart/form-data"):
                return self._error(400, "expected multipart/form-data")
            fields = parse_multipart(ctype, self.rfile.read(length))
            audio = fields.get("file")
            if not audio:
                return self._error(400, "missing file")
            get = lambda k: fields.get(k, b"").decode("utf-8", "replace").strip()
            try:
                temperature = float(get("temperature") or 0)
                result = t.transcribe(audio, get("language"), get("prompt"), temperature)
            except UnsupportedAudio as exc:
                return self._error(415, str(exc))
            except Exception as exc:  # surfaced to the client as a 500, not swallowed
                return self._error(500, f"transcription failed: {exc}")
            if get("response_format") == "text":
                body = result["text"].encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if get("response_format") == "json":
                result = {"text": result["text"]}
            self._json(200, result)

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--compute-type", default="float16")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    t = Transcriber(args.model, args.device, args.compute_type)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(t))
    print(f"whisper-server ready on http://127.0.0.1:{args.port}/v1 (model {args.model}, {args.device})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
