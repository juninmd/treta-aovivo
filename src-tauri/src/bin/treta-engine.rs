//! Headless voice engine: prints one JSON event per line (same events the app receives).
//! Used by `pnpm homologate` and for tuning diarization against recorded debates.

use std::io::Write;
use std::path::PathBuf;
use treta_aovivo_lib::engine::{run, source::SourceSpec, EngineConfig, Session};

const USAGE: &str = "usage: treta-engine (--url <link> | --file <path> | --mic | --system) [--speed 1.0] \
[--models <dir>] [--voice-model 3dspeaker-campplus] [--threshold 0.55] [--max-speakers 4] [--no-audio] [--no-faces]";

fn main() {
    if let Err(e) = real_main() {
        eprintln!("{e:#}\n{USAGE}");
        std::process::exit(2);
    }
}

fn real_main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let mut cfg = EngineConfig::default();
    let (mut spec, mut speed, mut models) = (None, None, PathBuf::from("models"));
    while let Some(a) = args.next() {
        let mut val = || args.next().ok_or_else(|| anyhow::anyhow!("missing value for {a}"));
        match a.as_str() {
            "--url" => spec = Some(SourceSpec::Url { url: val()?, speed: None }),
            "--file" => spec = Some(SourceSpec::File { path: val()?, speed: None }),
            "--mic" => spec = Some(SourceSpec::Mic),
            "--system" => spec = Some(SourceSpec::System),
            "--speed" => speed = Some(val()?.parse()?),
            "--models" => models = PathBuf::from(val()?),
            "--voice-model" => cfg.voice_model = val()?,
            "--threshold" => cfg.threshold = val()?.parse()?,
            "--max-speakers" => cfg.max_speakers = val()?.parse()?,
            "--no-audio" => cfg.include_audio = false,
            "--no-faces" => cfg.capture_faces = false,
            "-h" | "--help" => {
                println!("{USAGE}");
                return Ok(());
            }
            other => anyhow::bail!("unknown argument {other}"),
        }
    }
    let spec = match spec.ok_or_else(|| anyhow::anyhow!("no source given"))? {
        SourceSpec::Url { url, .. } => SourceSpec::Url { url, speed },
        SourceSpec::File { path, .. } => SourceSpec::File { path, speed },
        s => s,
    };
    let session = Session::new(&cfg);
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    run(spec, cfg, models, &session, &mut |ev| {
        let _ = serde_json::to_writer(&mut out, &ev);
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    })
}
