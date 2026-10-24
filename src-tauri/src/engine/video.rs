//! Video frames for speaker portraits. A continuous low-fps decode is kept in
//! step with the audio clock instead of seeking per grab: `ffmpeg -ss` on a
//! remote stream URL can hang indefinitely.

use super::source::{hidden, validate_url, SourceSpec};
use anyhow::{Context, Result};
use std::collections::VecDeque;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const FRAME_W: u32 = 640;
pub const FRAME_H: u32 = 360;
const FPS: f64 = 2.0;
/// How far the video may run ahead of the audio, and how much history is kept.
const LEAD_SECS: f64 = 5.0;
const KEEP_SECS: f64 = 30.0;

/// Where frames come from. Links go through yt-dlp, which downloads in ranged
/// chunks: ffmpeg reading the stream URL directly is throttled to ~2x real time,
/// too slow for sped-up runs.
pub enum VideoInput {
    File(String),
    Link(String),
}

impl VideoInput {
    pub fn for_source(spec: &SourceSpec) -> Result<Option<Self>> {
        match spec {
            SourceSpec::File { path, .. } if std::path::Path::new(path).is_file() => Ok(Some(Self::File(path.clone()))),
            SourceSpec::File { path, .. } => anyhow::bail!("file not found: {path}"),
            SourceSpec::Url { url, .. } => validate_url(url).map(|_| Some(Self::Link(url.clone()))),
            SourceSpec::Mic | SourceSpec::System => Ok(None),
        }
    }
}

type FrameBuf = Arc<Mutex<VecDeque<(f64, Vec<u8>)>>>;

/// Continuous 2 fps decode of the video track, paced by the audio clock.
pub struct VideoTap {
    frames: FrameBuf,
    done: Arc<AtomicBool>,
    children: Vec<Child>,
}

impl VideoTap {
    /// `audio_samples` is the engine's count of 16 kHz samples consumed so far.
    pub fn start(input: &VideoInput, audio_samples: Arc<AtomicU64>) -> Result<Self> {
        let vf = format!("fps={FPS},scale={FRAME_W}:{FRAME_H}:force_original_aspect_ratio=decrease,pad={FRAME_W}:{FRAME_H}:(ow-iw)/2:(oh-ih)/2");
        let mut children = Vec::new();
        let mut cmd = Command::new("ffmpeg");
        cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]).stdin(Stdio::null());
        match input {
            VideoInput::File(path) => {
                cmd.args(["-protocol_whitelist", "file,pipe", "-i"]).arg(path);
            }
            VideoInput::Link(url) => {
                let mut ytdlp = hidden(Command::new("yt-dlp").args(["-f", "bv*[height<=360][protocol=https]/bv*[height<=480]/b", "--no-playlist", "--quiet", "--no-warnings", "-o", "-", "--"]).arg(url))
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn()
                    .context("yt-dlp not found on PATH")?;
                let pipe = ytdlp.stdout.take().context("yt-dlp stdout")?;
                children.push(ytdlp);
                cmd.args(["-i", "pipe:0"]).stdin(Stdio::from(pipe));
            }
        }
        let spawned = hidden(cmd.args(["-an", "-vf", &vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])).stdout(Stdio::piped()).stderr(Stdio::null()).spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                // yt-dlp would keep downloading: a Child is not killed on drop.
                for c in &mut children {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                return Err(e).context("ffmpeg not found on PATH");
            }
        };
        let mut stdout = child.stdout.take().context("ffmpeg stdout")?;
        let frames: FrameBuf = Arc::default();
        let done = Arc::new(AtomicBool::new(false));
        let (buf, fin) = (frames.clone(), done.clone());
        std::thread::spawn(move || {
            let size = (FRAME_W * FRAME_H * 3) as usize;
            let mut idx: u64 = 0;
            loop {
                let mut frame = vec![0u8; size];
                if fin.load(Ordering::Relaxed) || stdout.read_exact(&mut frame).is_err() {
                    break;
                }
                let t = idx as f64 / FPS;
                idx += 1;
                while t > audio_samples.load(Ordering::Relaxed) as f64 / 16_000.0 + LEAD_SECS && !fin.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                let mut q = buf.lock().expect("frames lock");
                q.push_back((t, frame));
                while q.front().is_some_and(|(ft, _)| *ft < t - KEEP_SECS) {
                    q.pop_front();
                }
            }
            fin.store(true, Ordering::Relaxed);
        });
        children.push(child);
        Ok(Self { frames, done, children })
    }

    /// Frame closest to `t`, waiting up to `wait` for the decode to reach it.
    pub fn frame_near(&self, t: f64, wait: Duration) -> Option<Vec<u8>> {
        let deadline = Instant::now() + wait;
        loop {
            {
                let q = self.frames.lock().expect("frames lock");
                let reached = q.back().is_some_and(|(ft, _)| *ft >= t);
                if reached || self.done.load(Ordering::Relaxed) || Instant::now() >= deadline {
                    return closest(&q, t);
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// True once the video track ended or failed and nothing is buffered.
    pub fn exhausted(&self) -> bool {
        self.done.load(Ordering::Relaxed) && self.frames.lock().map(|q| q.is_empty()).unwrap_or(true)
    }
}

fn closest(q: &VecDeque<(f64, Vec<u8>)>, t: f64) -> Option<Vec<u8>> {
    q.iter()
        .min_by(|a, b| (a.0 - t).abs().total_cmp(&(b.0 - t).abs()))
        .filter(|(ft, _)| (ft - t).abs() <= 1.0 / FPS)
        .map(|(_, f)| f.clone())
}

impl Drop for VideoTap {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Relaxed);
        for c in &mut self.children {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_existing_files_reach_ffmpeg_as_a_file_input() {
        // ffmpeg would happily fetch a URL or read a playlist given as the "file" path.
        let spec = SourceSpec::File { path: "http://169.254.169.254/latest/meta-data".into(), speed: None };
        assert!(VideoInput::for_source(&spec).is_err());
    }

    #[test]
    fn closest_frame_must_be_within_half_a_frame_interval() {
        let q: VecDeque<(f64, Vec<u8>)> = [(10.0, vec![1]), (10.5, vec![2]), (11.0, vec![3])].into();
        assert_eq!(closest(&q, 10.6), Some(vec![2]));
        assert_eq!(closest(&q, 11.4), Some(vec![3]));
        assert_eq!(closest(&q, 30.0), None, "frames far from t are not the speaker's moment");
        assert_eq!(closest(&VecDeque::new(), 1.0), None);
    }
}
