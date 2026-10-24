//! Audio sources. Every source yields mono f32 chunks at `sample_rate`.
//!
//! Links and files go through yt-dlp/ffmpeg paced at `speed`× real time, so a
//! recorded debate behaves like a live one. Mic and system audio use cpal;
//! on WASAPI an input stream on an output device is loopback capture.

use anyhow::{anyhow, bail, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SourceSpec {
    Url { url: String, speed: Option<f32> },
    File { path: String, speed: Option<f32> },
    Mic,
    System,
}

pub const PROCESS_RATE: u32 = 16_000;

pub struct RunningSource {
    pub rx: Receiver<Vec<f32>>,
    pub sample_rate: u32,
    pub label: String,
    children: Vec<Child>,
    stderr_tail: Arc<Mutex<Vec<String>>>,
    _stream: Option<cpal::Stream>,
}

impl RunningSource {
    /// Error text when a child process ended badly, for surfacing to the user.
    pub fn failure(&mut self) -> Option<String> {
        let mut failed = false;
        for c in &mut self.children {
            if let Ok(Some(st)) = c.try_wait() {
                failed |= !st.success();
            }
        }
        let tail = self.stderr_tail.lock().ok()?.join("\n");
        (failed && !tail.is_empty()).then_some(tail)
    }
}

impl Drop for RunningSource {
    fn drop(&mut self) {
        for c in &mut self.children {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

pub(crate) fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn tool_available(name: &str) -> bool {
    hidden(Command::new(name).arg("-version"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
        || hidden(Command::new(name).arg("--version")).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok()
}

fn collect_stderr(stderr: ChildStderr, tail: Arc<Mutex<Vec<String>>>) {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut t) = tail.lock() {
                t.push(line);
                let n = t.len();
                if n > 12 {
                    t.drain(..n - 12);
                }
            }
        }
    });
}

fn validate_speed(speed: Option<f32>) -> Result<f32> {
    let s = speed.unwrap_or(1.0);
    if !(0.25..=8.0).contains(&s) {
        bail!("speed must be between 0.25 and 8, got {s}");
    }
    Ok(s)
}

pub(crate) fn validate_url(url: &str) -> Result<()> {
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) || url.chars().any(char::is_whitespace) {
        bail!("only http(s) links are accepted");
    }
    Ok(())
}

fn ffmpeg_cmd() -> Command {
    let mut c = Command::new("ffmpeg");
    c.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    c
}

fn ffmpeg_output(c: &mut Command) {
    c.args(["-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"]);
}

/// Reads s16le from ffmpeg and paces it at `speed`× real time. ffmpeg's own
/// `-readrate` undershoots badly at high rates, so pacing lives here.
fn pump_pcm(mut stdout: impl Read + Send + 'static, tx: SyncSender<Vec<f32>>, speed: f32) {
    thread::spawn(move || {
        let started = std::time::Instant::now();
        let mut samples: u64 = 0;
        // 100 ms of 16-bit mono audio per chunk.
        let mut buf = vec![0u8; 3200];
        let mut carry: Option<u8> = None;
        loop {
            let n = match stdout.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let mut bytes: Vec<u8> = carry.take().into_iter().chain(buf[..n].iter().copied()).collect();
            if bytes.len() % 2 == 1 {
                carry = bytes.pop();
            }
            let chunk: Vec<f32> = bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
            samples += chunk.len() as u64;
            let due = std::time::Duration::from_secs_f64(samples as f64 / PROCESS_RATE as f64 / speed as f64);
            if let Some(wait) = due.checked_sub(started.elapsed()) {
                thread::sleep(wait);
            }
            if tx.send(chunk).is_err() {
                break;
            }
        }
    });
}

fn open_url(url: &str, speed: f32) -> Result<RunningSource> {
    validate_url(url)?;
    let tail = Arc::new(Mutex::new(Vec::new()));
    let mut ytdlp = hidden(Command::new("yt-dlp").args(["-f", "bestaudio/best", "--no-playlist", "--quiet", "--no-warnings", "-o", "-", "--"]).arg(url))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("yt-dlp not found on PATH")?;
    collect_stderr(ytdlp.stderr.take().unwrap(), tail.clone());
    let mut cmd = ffmpeg_cmd();
    cmd.args(["-i", "pipe:0"]);
    ffmpeg_output(&mut cmd);
    let mut ffmpeg = hidden(&mut cmd)
        .stdin(Stdio::from(ytdlp.stdout.take().unwrap()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("ffmpeg not found on PATH")?;
    collect_stderr(ffmpeg.stderr.take().unwrap(), tail.clone());
    let (tx, rx) = sync_channel(256);
    pump_pcm(ffmpeg.stdout.take().unwrap(), tx, speed);
    Ok(RunningSource { rx, sample_rate: PROCESS_RATE, label: url.to_string(), children: vec![ytdlp, ffmpeg], stderr_tail: tail, _stream: None })
}

fn open_file(path: &str, speed: f32) -> Result<RunningSource> {
    if !std::path::Path::new(path).is_file() {
        bail!("file not found: {path}");
    }
    let tail = Arc::new(Mutex::new(Vec::new()));
    let mut cmd = ffmpeg_cmd();
    cmd.arg("-i").arg(path);
    ffmpeg_output(&mut cmd);
    let mut ffmpeg = hidden(&mut cmd).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().context("ffmpeg not found on PATH")?;
    collect_stderr(ffmpeg.stderr.take().unwrap(), tail.clone());
    let (tx, rx) = sync_channel(256);
    pump_pcm(ffmpeg.stdout.take().unwrap(), tx, speed);
    Ok(RunningSource { rx, sample_rate: PROCESS_RATE, label: path.to_string(), children: vec![ffmpeg], stderr_tail: tail, _stream: None })
}

fn downmix<T: Copy>(data: &[T], channels: usize, to_f32: impl Fn(T) -> f32) -> Vec<f32> {
    data.chunks(channels.max(1)).map(|fr| fr.iter().map(|&s| to_f32(s)).sum::<f32>() / fr.len() as f32).collect()
}

fn open_device(loopback: bool) -> Result<RunningSource> {
    let host = cpal::default_host();
    let device = if loopback { host.default_output_device() } else { host.default_input_device() }
        .ok_or_else(|| anyhow!(if loopback { "no output device for system audio" } else { "no microphone found" }))?;
    let supported = if loopback { device.default_output_config() } else { device.default_input_config() }
        .map_err(|e| anyhow!("device config: {e}"))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.config();
    let channels = config.channels as usize;
    let rate = config.sample_rate;
    let (tx, rx) = sync_channel::<Vec<f32>>(512);
    let err = |e| eprintln!("audio stream error: {e}");
    let stream = match format {
        cpal::SampleFormat::F32 => device.build_input_stream(config, move |d: &[f32], _: &_| { let _ = tx.try_send(downmix(d, channels, |s| s)); }, err, None),
        cpal::SampleFormat::I16 => device.build_input_stream(config, move |d: &[i16], _: &_| { let _ = tx.try_send(downmix(d, channels, |s| s as f32 / 32768.0)); }, err, None),
        cpal::SampleFormat::I32 => device.build_input_stream(config, move |d: &[i32], _: &_| { let _ = tx.try_send(downmix(d, channels, |s| s as f32 / 2147483648.0)); }, err, None),
        cpal::SampleFormat::U16 => device.build_input_stream(config, move |d: &[u16], _: &_| { let _ = tx.try_send(downmix(d, channels, |s| (s as f32 - 32768.0) / 32768.0)); }, err, None),
        other => bail!("unsupported sample format {other:?}"),
    }
    .map_err(|e| anyhow!("cannot open audio stream: {e}"))?;
    stream.play().map_err(|e| anyhow!("cannot start audio stream: {e}"))?;
    let label = if loopback { "Áudio do sistema" } else { "Microfone" }.to_string();
    Ok(RunningSource { rx, sample_rate: rate, label, children: vec![], stderr_tail: Arc::default(), _stream: Some(stream) })
}

pub fn open(spec: &SourceSpec) -> Result<RunningSource> {
    match spec {
        SourceSpec::Url { url, speed } => open_url(url, validate_speed(*speed)?),
        SourceSpec::File { path, speed } => open_file(path, validate_speed(*speed)?),
        SourceSpec::Mic => open_device(false),
        SourceSpec::System => open_device(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_links_and_argument_smuggling() {
        assert!(validate_url("https://www.youtube.com/watch?v=x").is_ok());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("--exec calc").is_err());
        assert!(validate_url("https://a.b/ --exec x").is_err());
    }

    #[test]
    fn speed_is_bounded() {
        assert_eq!(validate_speed(None).unwrap(), 1.0);
        assert!(validate_speed(Some(0.0)).is_err());
        assert!(validate_speed(Some(100.0)).is_err());
    }

    #[test]
    fn downmix_averages_channels() {
        assert_eq!(downmix(&[1.0f32, 0.0, 0.5, 0.5], 2, |s| s), vec![0.5, 0.5]);
    }

    #[test]
    fn source_spec_parses_from_frontend_json() {
        let s: SourceSpec = serde_json::from_str(r#"{"kind":"url","url":"https://x.y","speed":2}"#).unwrap();
        assert!(matches!(s, SourceSpec::Url { speed: Some(v), .. } if v == 2.0));
        assert!(matches!(serde_json::from_str::<SourceSpec>(r#"{"kind":"system"}"#).unwrap(), SourceSpec::System));
    }
}
