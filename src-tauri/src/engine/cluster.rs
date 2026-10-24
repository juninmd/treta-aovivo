//! Online speaker clustering over voice embeddings.
//!
//! Each speaker is a centroid (running sum of L2-normalised embeddings). A new
//! embedding joins the most similar speaker when cosine similarity clears the
//! threshold; otherwise it may open a new speaker, up to `max_speakers`.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Assignment {
    pub speaker: usize,
    pub similarity: f32,
    pub is_new: bool,
}

#[derive(Debug, Clone)]
struct Speaker {
    sum: Vec<f32>,
    weight: f32,
    merged_into: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct SpeakerClusters {
    speakers: Vec<Speaker>,
    pub threshold: f32,
    pub max_speakers: usize,
}

/// Caps centroid inertia so a voice drifting over a long session still adapts.
const MAX_WEIGHT: f32 = 60.0;

pub fn normalize(v: &[f32]) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return v.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let (mut dot, mut na, mut nb) = (0.0f32, 0.0f32, 0.0f32);
    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na <= f32::EPSILON || nb <= f32::EPSILON {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

impl SpeakerClusters {
    pub fn new(threshold: f32, max_speakers: usize) -> Self {
        Self { speakers: Vec::new(), threshold, max_speakers: max_speakers.max(1) }
    }

    /// Number of active (not merged) speakers.
    pub fn len(&self) -> usize {
        self.speakers.iter().filter(|s| s.merged_into.is_none()).count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Follows merge links so callers always see the surviving speaker id.
    pub fn resolve(&self, mut id: usize) -> usize {
        while let Some(next) = self.speakers.get(id).and_then(|s| s.merged_into) {
            id = next;
        }
        id
    }

    /// Most similar active speaker, without changing any centroid.
    pub fn classify(&self, embedding: &[f32]) -> Option<(usize, f32)> {
        self.speakers
            .iter()
            .enumerate()
            .filter(|(_, s)| s.merged_into.is_none())
            .map(|(i, s)| (i, cosine(&s.sum, embedding)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
    }

    /// Adds `embedding` to speaker `id` with the given weight (seconds of audio).
    pub fn update(&mut self, id: usize, embedding: &[f32], weight: f32) {
        let id = self.resolve(id);
        let e = normalize(embedding);
        let s = &mut self.speakers[id];
        if s.weight + weight > MAX_WEIGHT {
            let keep = (MAX_WEIGHT - weight).max(1.0) / s.weight;
            s.sum.iter_mut().for_each(|x| *x *= keep);
            s.weight *= keep;
        }
        s.sum.iter_mut().zip(&e).for_each(|(x, y)| *x += y * weight);
        s.weight += weight;
    }

    /// Joins the best match above threshold, else opens a new speaker when
    /// allowed and capacity remains, else falls back to the best match.
    pub fn assign(&mut self, embedding: &[f32], weight: f32, allow_new: bool) -> Assignment {
        let best = self.classify(embedding);
        let can_open = allow_new && self.len() < self.max_speakers;
        match best {
            Some((id, sim)) if sim >= self.threshold || !can_open => {
                self.update(id, embedding, weight);
                Assignment { speaker: id, similarity: sim, is_new: false }
            }
            _ if can_open => {
                let e = normalize(embedding);
                self.speakers.push(Speaker {
                    sum: e.iter().map(|x| x * weight).collect(),
                    weight,
                    merged_into: None,
                });
                Assignment { speaker: self.speakers.len() - 1, similarity: 1.0, is_new: true }
            }
            // No speakers yet and not allowed to open one: seed anyway so the
            // pipeline always produces a label.
            _ => {
                self.speakers.push(Speaker {
                    sum: normalize(embedding).iter().map(|x| x * weight).collect(),
                    weight,
                    merged_into: None,
                });
                Assignment { speaker: self.speakers.len() - 1, similarity: 1.0, is_new: true }
            }
        }
    }

    /// Folds speaker `from` into `into`; later lookups of `from` resolve to `into`.
    pub fn merge(&mut self, from: usize, into: usize) -> bool {
        let (from, into) = (self.resolve(from), self.resolve(into));
        if from == into || from >= self.speakers.len() || into >= self.speakers.len() {
            return false;
        }
        let src = std::mem::take(&mut self.speakers[from].sum);
        let w = self.speakers[from].weight;
        let dst = &mut self.speakers[into];
        dst.sum.iter_mut().zip(&src).for_each(|(x, y)| *x += y);
        dst.weight += w;
        self.speakers[from].sum = src;
        self.speakers[from].merged_into = Some(into);
        true
    }
}

/// Label used for windows that matched no known speaker.
pub const UNKNOWN: usize = usize::MAX;

/// Replaces single-window islands whose neighbours agree (A B A -> A A A).
pub fn smooth_labels(labels: &mut [usize]) {
    if labels.len() < 3 {
        return;
    }
    for i in 1..labels.len() - 1 {
        if labels[i - 1] == labels[i + 1] && labels[i] != labels[i - 1] {
            labels[i] = labels[i - 1];
        }
    }
}

/// Groups consecutive equal labels into (label, first_index, last_index_exclusive).
pub fn runs(labels: &[usize]) -> Vec<(usize, usize, usize)> {
    let mut out: Vec<(usize, usize, usize)> = Vec::new();
    for (i, &l) in labels.iter().enumerate() {
        match out.last_mut() {
            Some(r) if r.0 == l => r.2 = i + 1,
            _ => out.push((l, i, i + 1)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(seed: usize) -> Vec<f32> {
        (0..16).map(|i| if i % 4 == seed { 1.0 } else { 0.05 }).collect()
    }

    fn noisy(seed: usize, k: f32) -> Vec<f32> {
        voice(seed).iter().enumerate().map(|(i, x)| x + k * ((i * 7 % 5) as f32 / 10.0)).collect()
    }

    #[test]
    fn same_voice_maps_to_same_speaker_and_different_voice_opens_new() {
        let mut c = SpeakerClusters::new(0.7, 4);
        let a1 = c.assign(&voice(0), 1.0, true);
        let a2 = c.assign(&noisy(0, 0.2), 1.0, true);
        let b = c.assign(&voice(1), 1.0, true);
        assert!(a1.is_new && !a2.is_new && b.is_new);
        assert_eq!(a1.speaker, a2.speaker);
        assert_ne!(a1.speaker, b.speaker);
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn capacity_reached_falls_back_to_best_match_instead_of_inventing_speakers() {
        let mut c = SpeakerClusters::new(0.99, 2);
        c.assign(&voice(0), 1.0, true);
        c.assign(&voice(1), 1.0, true);
        let third = c.assign(&voice(2), 1.0, true);
        assert!(!third.is_new);
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn short_audio_never_opens_a_new_speaker_once_one_exists() {
        let mut c = SpeakerClusters::new(0.9, 4);
        c.assign(&voice(0), 1.0, true);
        let short = c.assign(&voice(3), 0.4, false);
        assert!(!short.is_new);
        assert_eq!(c.len(), 1);
    }

    #[test]
    fn merged_speaker_resolves_to_target_and_stops_competing() {
        let mut c = SpeakerClusters::new(0.7, 4);
        let a = c.assign(&voice(0), 1.0, true).speaker;
        let b = c.assign(&voice(1), 1.0, true).speaker;
        assert!(c.merge(b, a));
        assert_eq!(c.resolve(b), a);
        assert_eq!(c.len(), 1);
        assert_eq!(c.classify(&voice(1)).unwrap().0, a);
        assert!(!c.merge(b, a), "merging twice is a no-op");
    }

    #[test]
    fn zero_vectors_do_not_panic_or_match() {
        let mut c = SpeakerClusters::new(0.5, 3);
        c.assign(&voice(0), 1.0, true);
        let z = vec![0.0; 16];
        assert_eq!(c.classify(&z).unwrap().1, 0.0);
    }

    #[test]
    fn smoothing_removes_islands_and_runs_group_labels() {
        let mut l = vec![0, 0, 1, 0, 2, 2, UNKNOWN];
        smooth_labels(&mut l);
        assert_eq!(l, vec![0, 0, 0, 0, 2, 2, UNKNOWN]);
        assert_eq!(runs(&l), vec![(0, 0, 4), (2, 4, 6), (UNKNOWN, 6, 7)]);
        assert!(runs(&[]).is_empty());
    }
}
