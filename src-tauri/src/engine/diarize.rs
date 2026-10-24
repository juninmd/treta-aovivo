//! Who spoke when inside one VAD segment: fixed-window voice embeddings,
//! label smoothing, and online clustering into speakers.

use super::cluster::{self, runs, smooth_labels, UNKNOWN};
use super::source::PROCESS_RATE;
use super::SharedClusters;
use sherpa_onnx::SpeakerEmbeddingExtractor;

/// A speaker run inside one VAD segment, in samples relative to the segment.
pub(super) struct Run {
    pub speaker: usize,
    pub start: usize,
    pub end: usize,
    pub similarity: f32,
    pub is_new: bool,
    /// Several windows sounded like someone else: two people talking at once.
    pub overlap: bool,
}

/// Share of a run's windows that, before smoothing, matched another known
/// speaker. Crosstalk shows up as that disagreement (A B A B smoothed to A A A A).
const OVERLAP_SHARE: f32 = 0.2;

pub(super) fn contested(raw: &[usize], speaker: usize) -> bool {
    let other = raw.iter().filter(|&&l| l != UNKNOWN && l != speaker).count();
    other >= 2 && other as f32 >= raw.len() as f32 * OVERLAP_SHARE
}

/// Wall-time counters, printed to stderr when TRETA_PROFILE is set.
#[derive(Default)]
pub(super) struct Counters {
    pub embed: std::cell::Cell<(u128, u32)>,
    pub vad: std::cell::Cell<(u128, u32)>,
}
pub(super) struct Prof<'a>(&'a std::cell::Cell<(u128, u32)>, std::time::Instant);
impl<'a> Prof<'a> {
    pub fn start(c: &'a std::cell::Cell<(u128, u32)>) -> Self {
        Prof(c, std::time::Instant::now())
    }
}
impl Drop for Prof<'_> {
    fn drop(&mut self) {
        let (t, n) = self.0.get();
        self.0.set((t + self.1.elapsed().as_micros(), n + 1));
    }
}

pub(super) struct Diarizer {
    pub prof: Counters,
    pub extractor: SpeakerEmbeddingExtractor,
    pub clusters: SharedClusters,
    pub window: f32,
}

/// Seconds of audio below which an embedding is too unreliable to open a speaker.
const MIN_NEW_SPEAKER_SECS: f32 = 2.0;

impl Diarizer {
    pub fn embed(&self, samples: &[f32]) -> Option<Vec<f32>> {
        let _t = Prof::start(&self.prof.embed);
        let stream = self.extractor.create_stream()?;
        stream.accept_waveform(PROCESS_RATE as i32, samples);
        stream.input_finished();
        if !self.extractor.is_ready(&stream) {
            return None;
        }
        self.extractor.compute(&stream)
    }

    /// Splits one VAD segment into speaker runs: label fixed windows, smooth
    /// islands, then let each run's full embedding update (or open) a speaker.
    pub fn split(&self, samples: &[f32]) -> Vec<Run> {
        let sr = PROCESS_RATE as usize;
        let win = (self.window * sr as f32) as usize;
        let bounds: Vec<(usize, usize)> = if samples.len() < win * 2 {
            vec![(0, samples.len())]
        } else {
            let n = samples.len() / win;
            (0..n).map(|i| (i * win, if i + 1 == n { samples.len() } else { (i + 1) * win })).collect()
        };
        // One embedding per window; a run's embedding is the mean of its windows,
        // so no audio is embedded twice.
        let embeddings: Vec<Option<Vec<f32>>> = bounds.iter().map(|&(a, b)| self.embed(&samples[a..b]).map(|e| cluster::normalize(&e))).collect();
        let mut clusters = self.clusters.lock().expect("clusters lock");
        let mut labels: Vec<usize> = embeddings
            .iter()
            .map(|e| match e.as_ref().and_then(|e| clusters.classify(e)) {
                Some((id, sim)) if sim >= clusters.threshold => id,
                _ => UNKNOWN,
            })
            .collect();
        let raw = labels.clone();
        smooth_labels(&mut labels);
        let mut out: Vec<Run> = Vec::new();
        for (label, i, j) in runs(&labels) {
            let (a, b) = (bounds[i].0, bounds[j - 1].1);
            let secs = (b - a) as f32 / sr as f32;
            let Some(e) = mean_embedding(&embeddings[i..j]) else { continue };
            let assignment = if label == UNKNOWN {
                clusters.assign(&e, secs, secs >= MIN_NEW_SPEAKER_SECS)
            } else {
                let sim = clusters.classify(&e).map(|(_, s)| s).unwrap_or(0.0);
                clusters.update(label, &e, secs);
                cluster::Assignment { speaker: label, similarity: sim, is_new: false }
            };
            let speaker = clusters.resolve(assignment.speaker);
            let resolved: Vec<usize> = raw[i..j].iter().map(|&l| if l == UNKNOWN { l } else { clusters.resolve(l) }).collect();
            let overlap = contested(&resolved, speaker);
            match out.last_mut() {
                Some(r) if r.speaker == speaker => {
                    r.end = b;
                    r.overlap |= overlap;
                }
                _ => out.push(Run { speaker, start: a, end: b, similarity: assignment.similarity, is_new: assignment.is_new, overlap }),
            }
        }
        out
    }
}

fn mean_embedding(window_embeddings: &[Option<Vec<f32>>]) -> Option<Vec<f32>> {
    let mut it = window_embeddings.iter().flatten();
    let mut sum = it.next()?.clone();
    for e in it {
        sum.iter_mut().zip(e).for_each(|(x, y)| *x += y);
    }
    Some(cluster::normalize(&sum))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crosstalk_is_flagged_but_a_stray_window_is_not() {
        let (a, b) = (0usize, 1usize);
        assert!(contested(&[a, b, a, b, a, a, b, a, a, a], a), "alternating voices inside one run");
        assert!(!contested(&[a, a, b, a, a, a, a, a, a, a], a), "one noisy window");
        assert!(!contested(&[a, UNKNOWN, UNKNOWN, a, a], a), "unknown windows are not another speaker");
        assert!(!contested(&[], a));
    }
}

#[cfg(test)]
mod ffi_tests {
    //! Probes sherpa-onnx with degenerate input: a C++ exception crossing FFI
    //! aborts the whole process, so these inputs must never reach the library.
    //! Needs the voice models: TRETA_MODELS_DIR or ../models.
    use super::*;
    use crate::engine::{cluster::SpeakerClusters, models};
    use sherpa_onnx::{SileroVadModelConfig, SpeakerEmbeddingExtractorConfig, VadModelConfig, VoiceActivityDetector};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    fn models() -> PathBuf {
        std::env::var_os("TRETA_MODELS_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("../models"))
    }

    #[test]
    #[ignore = "needs downloaded voice models"]
    fn embedding_survives_tiny_clips() {
        let dir = models();
        let spec = models::embedding("3dspeaker-campplus").unwrap();
        let path = models::ensure(&dir, &spec, &mut |_| {}).unwrap();
        let ex = SpeakerEmbeddingExtractor::create(&SpeakerEmbeddingExtractorConfig { model: Some(path.to_string_lossy().into_owned()), num_threads: 1, ..Default::default() }).unwrap();
        let d = Diarizer { prof: Counters::default(), extractor: ex, clusters: Arc::new(Mutex::new(SpeakerClusters::new(0.5, 4))), window: 1.5 };
        for n in [0usize, 1, 100, 400, 800, 1600, 4000] {
            eprintln!("embed {n} samples -> {:?}", d.embed(&vec![0.01; n]).map(|e| e.len()));
        }
        for n in [0usize, 1, 100, 4000, 40_000] {
            eprintln!("split {n} samples -> {} runs", d.split(&vec![0.01; n]).len());
        }
    }

    #[test]
    #[ignore = "needs downloaded voice models"]
    fn vad_survives_empty_and_odd_chunks() {
        let path = models::ensure(&models(), &models::VAD, &mut |_| {}).unwrap();
        let vad = VoiceActivityDetector::create(
            &VadModelConfig {
                silero_vad: SileroVadModelConfig { model: Some(path.to_string_lossy().into_owned()), threshold: 0.5, min_silence_duration: 0.35, min_speech_duration: 0.25, window_size: 512, max_speech_duration: 12.0 },
                sample_rate: 16_000,
                num_threads: 1,
                ..Default::default()
            },
            60.0,
        )
        .unwrap();
        for n in [1usize, 7, 511, 513, 1600, 3199] {
            eprintln!("vad chunk {n}");
            vad.accept_waveform(&vec![0.1; n]);
        }
        eprintln!("vad empty chunk");
        vad.accept_waveform(&[]);
        eprintln!("vad survived");
    }
}
