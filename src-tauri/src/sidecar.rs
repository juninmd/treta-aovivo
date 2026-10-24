//! The voice engine runs in a child process (this same executable with
//! `--engine`). Under memory pressure onnxruntime throws a C++ exception across
//! FFI, which aborts the whole process; it must not take the UI down with it.
//!
//! Protocol: one JSON `Request` line on stdin, then `Control` lines; the child
//! answers with one `EngineEvent` JSON per stdout line. Closing stdin stops it.

use crate::engine::{self, source::SourceSpec, EngineConfig, EngineEvent, Session};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

pub const ENGINE_FLAG: &str = "--engine";
const STDERR_TAIL: usize = 2000;
/// STATUS_STACK_BUFFER_OVERRUN: how Windows reports Rust's abort on a foreign exception.
const FAIL_FAST: u32 = 0xC000_0409;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub source: SourceSpec,
    pub config: EngineConfig,
    pub models_dir: PathBuf,
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
pub enum Control {
    Stop,
    Merge { from: usize, into: usize },
}

/// Parent-side handle; dropping it closes the child's stdin, which stops it.
pub struct EngineProcess {
    stdin: ChildStdin,
}

impl EngineProcess {
    pub fn start(req: &Request, mut emit: impl FnMut(Value) + Send + 'static) -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut cmd = Command::new(exe);
        engine::source::hidden(cmd.arg(ENGINE_FLAG)).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("could not start the voice engine: {e}"))?;
        let (Some(mut pipe), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            let _ = child.kill();
            return Err("voice engine pipes unavailable".into());
        };
        let line = serde_json::to_string(req).map_err(|e| e.to_string())?;
        writeln!(pipe, "{line}").and_then(|_| pipe.flush()).map_err(|e| format!("voice engine did not accept the request: {e}"))?;

        let tail = Arc::new(Mutex::new(String::new()));
        let sink = tail.clone();
        std::thread::spawn(move || {
            for line in lossy_lines(BufReader::new(stderr)) {
                let mut t = sink.lock().expect("stderr tail lock");
                t.push_str(&line);
                t.push('\n');
                if t.len() > STDERR_TAIL {
                    let cut = t.ceil_char_boundary(t.len() - STDERR_TAIL);
                    t.drain(..cut);
                }
            }
        });
        std::thread::Builder::new()
            .name("voice-engine".into())
            .spawn(move || {
                let outcome = forward(BufReader::new(stdout), &mut emit);
                let code = child.wait().ok().and_then(|s| s.code());
                if !outcome.ended {
                    let tail = tail.lock().map(|t| t.clone()).unwrap_or_default();
                    emit(json!({ "type": "error", "message": crash_message(code, &tail) }));
                    emit(json!({ "type": "ended", "t": outcome.last_t }));
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { stdin: pipe })
    }

    /// False when the engine is already gone.
    pub fn send(&mut self, c: &Control) -> bool {
        let Ok(line) = serde_json::to_string(c) else { return false };
        writeln!(self.stdin, "{line}").and_then(|_| self.stdin.flush()).is_ok()
    }
}

/// Lines decoded lossily: native libraries print in the ANSI codepage, and one
/// invalid byte must not end the relay (`BufRead::lines` stops at it).
fn lossy_lines(mut r: impl BufRead) -> impl Iterator<Item = String> {
    std::iter::from_fn(move || {
        let mut buf = Vec::new();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string()),
        }
    })
}

struct Outcome {
    ended: bool,
    last_t: f64,
}

/// Relays engine events until the pipe closes. Lines that are not JSON objects
/// (stray native-library prints) are dropped instead of reaching the UI.
fn forward(out: impl BufRead, emit: &mut dyn FnMut(Value)) -> Outcome {
    let mut o = Outcome { ended: false, last_t: 0.0 };
    for line in lossy_lines(out) {
        let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
        if !ev.is_object() {
            continue;
        }
        if let Some(t) = ev.get("t").and_then(Value::as_f64) {
            o.last_t = o.last_t.max(t);
        }
        o.ended |= ev.get("type").and_then(Value::as_str) == Some("ended");
        emit(ev);
    }
    o
}

fn crash_message(code: Option<i32>, stderr_tail: &str) -> String {
    let kept = "A transcrição até aqui foi mantida; inicie de novo para continuar.";
    if code.map(|c| c as u32) == Some(FAIL_FAST) || stderr_tail.contains("cannot catch foreign exceptions") {
        return format!("O motor de voz caiu, provavelmente por falta de memória (0xC0000409). Feche programas pesados. {kept}");
    }
    let detail = stderr_tail.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("sem detalhes");
    match code {
        Some(c) => format!("O motor de voz encerrou inesperadamente (código {:#X}): {detail}. {kept}", c as u32),
        None => format!("O motor de voz foi encerrado: {detail}. {kept}"),
    }
}

/// Child side: runs one engine session and exits.
pub fn serve() -> i32 {
    let mut first = String::new();
    let req: Request = match std::io::stdin().read_line(&mut first).map_err(|e| e.to_string()).and_then(|_| serde_json::from_str(&first).map_err(|e| e.to_string())) {
        Ok(r) => r,
        Err(e) => {
            write_event(&EngineEvent::Error { message: format!("bad engine request: {e}") });
            return 2;
        }
    };
    let session = Session::new(&req.config);
    let (stop, clusters) = (session.stop.clone(), session.clusters.clone());
    std::thread::spawn(move || {
        for line in std::io::stdin().lines().map_while(Result::ok) {
            match serde_json::from_str::<Control>(&line) {
                Ok(Control::Stop) => break,
                Ok(Control::Merge { from, into }) => {
                    clusters.lock().expect("clusters lock").merge(from, into);
                }
                Err(e) => eprintln!("ignored engine command: {e}"),
            }
        }
        // Stop also when stdin closes: the app is gone and nobody reads the output.
        stop.store(true, Ordering::Relaxed);
    });
    let mut emit = |ev: EngineEvent| write_event(&ev);
    if let Err(e) = engine::run(req.source, req.config, req.models_dir, &session, &mut emit) {
        emit(EngineEvent::Error { message: format!("{e:#}") });
        emit(EngineEvent::Ended { t: 0.0 });
    }
    0
}

fn write_event(ev: &EngineEvent) {
    let mut out = std::io::stdout().lock();
    let _ = serde_json::to_writer(&mut out, ev);
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn relay(input: &str) -> (Outcome, Vec<Value>) {
        let mut seen = Vec::new();
        let o = forward(std::io::Cursor::new(input.to_string()), &mut |v| seen.push(v));
        (o, seen)
    }

    #[test]
    fn engine_events_pass_through_and_native_noise_is_dropped() {
        let (o, seen) = relay("{\"type\":\"activity\",\"t\":4.5}\n[E:onnxruntime] Conv failed\n42\n{\"type\":\"ended\",\"t\":5.0}\n");
        assert_eq!(seen.len(), 2);
        assert!(o.ended);
        assert_eq!(o.last_t, 5.0);
    }

    #[test]
    fn a_non_utf8_line_from_a_native_library_does_not_stop_the_relay() {
        let mut input = b"{\"type\":\"activity\",\"t\":1.0}\n".to_vec();
        input.extend_from_slice(b"C:\\Users\\Jo\xE3o\\model.onnx\r\n");
        input.extend_from_slice(b"{\"type\":\"ended\",\"t\":2.0}\n");
        let mut seen = 0;
        let o = forward(std::io::Cursor::new(input), &mut |_| seen += 1);
        assert_eq!(seen, 2);
        assert!(o.ended);
    }

    #[test]
    fn a_crash_mid_session_is_reported_with_the_last_audio_time() {
        let (o, _) = relay("{\"type\":\"activity\",\"t\":166.2}\n{\"type\":\"segment\",\"id\":3,\"start\":160.0,\"end\":163.0}\n");
        assert!(!o.ended, "no ended event: the parent must synthesize error + ended");
        assert_eq!(o.last_t, 166.2);
        let msg = crash_message(Some(FAIL_FAST as i32), "fatal runtime error: Rust cannot catch foreign exceptions, aborting\n");
        assert!(msg.contains("falta de memória") && msg.contains("mantida"), "{msg}");
        let other = crash_message(Some(3), "first\nmodel file is corrupt\n\n");
        assert!(other.contains("0x3") && other.contains("model file is corrupt"), "{other}");
        assert!(crash_message(None, "").contains("sem detalhes"));
    }

    #[test]
    fn protocol_round_trips() {
        assert_eq!(serde_json::to_string(&Control::Merge { from: 2, into: 0 }).unwrap(), r#"{"cmd":"merge","from":2,"into":0}"#);
        assert_eq!(serde_json::from_str::<Control>(r#"{"cmd":"stop"}"#).unwrap(), Control::Stop);
        let req = Request { source: SourceSpec::Mic, config: EngineConfig::default(), models_dir: "m".into() };
        let back: Request = serde_json::from_str(&serde_json::to_string(&req).unwrap()).unwrap();
        assert!(matches!(back.source, SourceSpec::Mic) && back.models_dir == std::path::Path::new("m"));
    }
}
