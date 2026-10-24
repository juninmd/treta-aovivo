//! Voice pipeline: audio source -> VAD -> voice embeddings -> speaker labels.
//! Transcription and analysis happen in the frontend (AI SDK); this module only
//! answers "who spoke when" and hands out the clip audio.

pub mod cluster;
mod diarize;
pub mod faces;
pub mod models;
mod portraits;
pub mod source;
pub mod video;
pub mod wav;

use anyhow::{anyhow, Result};
use base64::Engine as _;
use cluster::SpeakerClusters;
use serde::{Deserialize, Serialize};
use sherpa_onnx::{
    LinearResampler, SileroVadModelConfig, SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig,
    VadModelConfig, VoiceActivityDetector,
};
use source::{SourceSpec, PROCESS_RATE};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Silence from the source (not the speakers) long enough to tell the user.
const STALL_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EngineEvent {
    Status { message: String },
    Started { source: String },
    Activity { t: f64, speaking: bool, level: f32 },
    Segment { id: u64, speaker: usize, start: f64, end: f64, similarity: f32, new_speaker: bool, overlap: bool, audio: Option<String> },
    Face { speaker: usize, t: f64, portrait: faces::Portrait },
    Error { message: String },
    Ended { t: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineConfig {
    pub voice_model: String,
    pub threshold: f32,
    pub max_speakers: usize,
    pub vad_threshold: f32,
    pub min_silence: f32,
    pub max_segment: f32,
    pub window: f32,
    pub include_audio: bool,
    pub capture_faces: bool,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            voice_model: "wespeaker-resnet34".into(),
            threshold: 0.5,
            max_speakers: 4,
            vad_threshold: 0.5,
            min_silence: 0.35,
            max_segment: 12.0,
            window: 1.5,
            include_audio: true,
            capture_faces: true,
        }
    }
}

pub type SharedClusters = Arc<Mutex<SpeakerClusters>>;

pub struct Session {
    pub stop: Arc<AtomicBool>,
    pub clusters: SharedClusters,
}

impl Session {
    pub fn new(cfg: &EngineConfig) -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
            clusters: Arc::new(Mutex::new(SpeakerClusters::new(cfg.threshold, cfg.max_speakers))),
        }
    }
}

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// Runs until the source ends or `session.stop` is set. Blocking; call from a thread.
pub fn run(spec: SourceSpec, cfg: EngineConfig, models_dir: PathBuf, session: &Session, emit: &mut dyn FnMut(EngineEvent)) -> Result<()> {
    let mut status = |message: String| emit(EngineEvent::Status { message });
    let vad_path = models::ensure(&models_dir, &models::VAD, &mut status)?;
    let emb_spec = models::embedding(&cfg.voice_model)?;
    let emb_path = models::ensure(&models_dir, &emb_spec, &mut status)?;

    let extractor = SpeakerEmbeddingExtractor::create(&SpeakerEmbeddingExtractorConfig {
        model: Some(emb_path.to_string_lossy().into_owned()),
        num_threads: 4,
        ..Default::default()
    })
    .ok_or_else(|| anyhow!("failed to load voice model {}", emb_spec.file))?;
    let vad = VoiceActivityDetector::create(
        &VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: Some(vad_path.to_string_lossy().into_owned()),
                threshold: cfg.vad_threshold,
                min_silence_duration: cfg.min_silence,
                min_speech_duration: 0.25,
                window_size: 512,
                max_speech_duration: cfg.max_segment,
            },
            sample_rate: PROCESS_RATE as i32,
            num_threads: 1,
            ..Default::default()
        },
        60.0,
    )
    .ok_or_else(|| anyhow!("failed to load VAD model"))?;
    let diarizer = diarize::Diarizer { prof: diarize::Counters::default(), extractor, clusters: session.clusters.clone(), window: cfg.window };

    // Samples consumed so far; the video decode for portraits stays in step with it.
    let audio_clock = Arc::new(AtomicU64::new(0));
    let (face_jobs, face_results) = match cfg.capture_faces {
        true => portraits::spawn_face_worker(spec.clone(), audio_clock.clone()),
        false => (None, None),
    };
    // Shared by the segment drain (asks for grabs) and the result loop (counts portraits found).
    let planner = std::cell::RefCell::new(faces::FacePlanner::default());
    let mut src = source::open(&spec)?;
    let resampler = (src.sample_rate != PROCESS_RATE)
        .then(|| LinearResampler::create(src.sample_rate as i32, PROCESS_RATE as i32))
        .flatten();
    emit(EngineEvent::Started { source: src.label.clone() });

    let mut consumed: u64 = 0;
    let mut next_activity = 0u64;
    let mut seg_id = 0u64;
    let (mut last_audio, mut stall_reported) = (Instant::now(), false);
    let sr = PROCESS_RATE as f64;
    let mut drain = |vad: &VoiceActivityDetector, emit: &mut dyn FnMut(EngineEvent)| {
        while let Some(seg) = vad.front() {
            let base = seg.start().max(0) as usize;
            let samples = seg.samples().to_vec();
            vad.pop();
            for run in diarizer.split(&samples) {
                seg_id += 1;
                let (start, end) = ((base + run.start) as f64 / sr, (base + run.end) as f64 / sr);
                if let Some(jobs) = &face_jobs {
                    // With two people talking the camera may be on either one.
                    if !run.overlap && planner.borrow_mut().want(run.speaker, start, end) {
                        let _ = jobs.send((run.speaker, (start + end) / 2.0));
                    }
                }
                let audio = cfg
                    .include_audio
                    .then(|| base64::engine::general_purpose::STANDARD.encode(wav::encode_mono_16bit(&samples[run.start..run.end], PROCESS_RATE)));
                emit(EngineEvent::Segment {
                    id: seg_id,
                    speaker: run.speaker,
                    start,
                    end,
                    similarity: run.similarity,
                    new_speaker: run.is_new,
                    overlap: run.overlap,
                    audio,
                });
            }
        }
    };

    loop {
        if session.stop.load(Ordering::Relaxed) {
            break;
        }
        let chunk = match src.rx.recv_timeout(Duration::from_millis(200)) {
            Ok(c) => c,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !stall_reported && last_audio.elapsed() >= Duration::from_secs(STALL_SECS) {
                    stall_reported = true;
                    emit(EngineEvent::Status { message: format!("A fonte não envia áudio há {STALL_SECS} s (rede lenta ou download limitado); aguardando…") });
                }
                continue;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if stall_reported {
            emit(EngineEvent::Status { message: "Áudio da fonte retomado.".into() });
        }
        (last_audio, stall_reported) = (Instant::now(), false);
        let chunk = match &resampler {
            Some(r) => r.resample(&chunk, false),
            None => chunk,
        };
        consumed += chunk.len() as u64;
        audio_clock.store(consumed, Ordering::Relaxed);
        {
            let _t = diarize::Prof::start(&diarizer.prof.vad);
            vad.accept_waveform(&chunk);
        }
        drain(&vad, emit);
        if let Some(rx) = &face_results {
            while let Ok(msg) = rx.try_recv() {
                portraits::emit_face(msg, &planner, &session.clusters, emit);
            }
        }
        if consumed >= next_activity {
            next_activity = consumed + PROCESS_RATE as u64 / 4;
            emit(EngineEvent::Activity { t: consumed as f64 / sr, speaking: vad.detected(), level: rms(&chunk) });
        }
    }
    vad.flush();
    drain(&vad, emit);
    drop(face_jobs);
    if let Some(rx) = &face_results {
        // Pending grabs finish quickly; the cap keeps a stalled ffmpeg from hanging shutdown.
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while let Ok(msg) = rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
            portraits::emit_face(msg, &planner, &session.clusters, emit);
        }
    }
    if let Some(err) = src.failure() {
        emit(EngineEvent::Error { message: err });
    }
    if std::env::var_os("TRETA_PROFILE").is_some() {
        let ((et, en), (vt, vn)) = (diarizer.prof.embed.get(), diarizer.prof.vad.get());
        eprintln!("profile: embed {en} calls {:.1}s (avg {:.0} ms) | vad {vn} calls {:.1}s", et as f64 / 1e6, et as f64 / 1e3 / en.max(1) as f64, vt as f64 / 1e6);
    }
    emit(EngineEvent::Ended { t: consumed as f64 / sr });
    Ok(())
}
