//! Speaker portraits: while a voice is talking, take the video frame at that
//! moment, keep it only if one face clearly dominates (the person on camera),
//! and crop it. Works for links and files; mic/system audio have no video.

use super::video::{VideoTap, FRAME_H, FRAME_W};
use anyhow::{bail, Context, Result};
use base64::Engine as _;
use image::{imageops, RgbImage};
use rustface::{Detector, ImageData};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

const PORTRAIT: u32 = 192;
static SEETA_MODEL: &[u8] = include_bytes!("../../assets/seeta_fd_frontal_v1.0.bin");

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Face {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Portrait {
    /// `data:image/jpeg;base64,...`, ready for an <img src>.
    pub image: String,
    pub score: f64,
    /// Face width as a fraction of the frame width.
    pub face_width: f32,
    /// 64-bit average hash (hex) used to pick the most consistent portrait.
    pub hash: String,
}

/// Smallest face (fraction of frame width) worth keeping as a portrait.
const MIN_FACE_FRACTION: f32 = 0.07;

/// The only face, or one at least twice as wide as every other face. Wide
/// shots with several similar faces are ambiguous, so they yield nothing.
pub fn pick_dominant(faces: &[Face], frame_w: u32) -> Option<Face> {
    let min_w = (frame_w as f32 * MIN_FACE_FRACTION) as u32;
    let mut big: Vec<Face> = faces.iter().copied().filter(|f| f.w >= min_w).collect();
    big.sort_by_key(|f| std::cmp::Reverse(f.w));
    match big.as_slice() {
        [] => None,
        [only] => Some(*only),
        [first, second, ..] if first.w >= second.w * 2 => Some(*first),
        _ => None,
    }
}

/// Square crop centred slightly above the face centre (keeps hair and chin),
/// with `margin` × face size around it, clamped inside the frame.
pub fn square_crop(f: &Face, frame_w: u32, frame_h: u32, margin: f32) -> (u32, u32, u32) {
    let size = ((f.w.max(f.h) as f32 * (1.0 + 2.0 * margin)) as u32).min(frame_w).min(frame_h).max(1);
    let cx = f.x as f32 + f.w as f32 / 2.0;
    let cy = f.y as f32 + f.h as f32 * 0.45;
    let x = (cx - size as f32 / 2.0).clamp(0.0, (frame_w - size) as f32) as u32;
    let y = (cy - size as f32 / 2.0).clamp(0.0, (frame_h - size) as f32) as u32;
    (x, y, size)
}

/// 8×8 average hash of a square region of a grayscale frame.
pub fn ahash(gray: &[u8], frame_w: u32, x: u32, y: u32, size: u32) -> u64 {
    let cell = (size / 8).max(1);
    let mut means = [0u32; 64];
    for (i, m) in means.iter_mut().enumerate() {
        let (cx, cy) = (x + (i as u32 % 8) * cell, y + (i as u32 / 8) * cell);
        let mut sum = 0u32;
        let mut n = 0u32;
        for yy in cy..cy + cell {
            for xx in cx..cx + cell {
                if let Some(&p) = gray.get((yy * frame_w + xx) as usize) {
                    sum += p as u32;
                    n += 1;
                }
            }
        }
        *m = sum / n.max(1);
    }
    let avg = means.iter().sum::<u32>() / 64;
    means.iter().enumerate().fold(0u64, |h, (i, &m)| if m > avg { h | (1 << i) } else { h })
}

fn to_gray(rgb: &[u8]) -> Vec<u8> {
    rgb.as_chunks::<3>().map(|p| ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u8).collect()
}

pub struct FaceGrabber {
    tap: Option<VideoTap>,
    detector: Box<dyn Detector>,
}

// The detector is only used from the face worker thread that owns it.
unsafe impl Send for FaceGrabber {}

impl FaceGrabber {
    pub fn new(tap: Option<VideoTap>) -> Result<Self> {
        let model = rustface::read_model(SEETA_MODEL).context("face model")?;
        let mut detector = rustface::create_detector_with_model(model);
        detector.set_min_face_size(24);
        detector.set_score_thresh(2.0);
        detector.set_pyramid_scale_factor(0.8);
        detector.set_slide_window_step(4, 4);
        Ok(Self { tap, detector })
    }

    /// True when there is no video left to look at.
    pub fn exhausted(&self) -> bool {
        self.tap.as_ref().is_none_or(VideoTap::exhausted)
    }

    /// Portrait of whoever dominates the frame at `t`, if anyone does.
    pub fn grab(&mut self, t: f64) -> Result<Option<Portrait>> {
        let Some(rgb) = self.tap.as_ref().and_then(|tap| tap.frame_near(t, Duration::from_secs(8))) else { return Ok(None) };
        self.portrait_from_rgb(rgb)
    }

    /// Detection and crop on one 640x360 RGB frame.
    pub fn portrait_from_rgb(&mut self, rgb: Vec<u8>) -> Result<Option<Portrait>> {
        if rgb.len() != (FRAME_W * FRAME_H * 3) as usize {
            bail!("frame must be {FRAME_W}x{FRAME_H} rgb24");
        }
        let gray = to_gray(&rgb);
        let faces: Vec<Face> = self
            .detector
            .detect(&ImageData::new(&gray, FRAME_W, FRAME_H))
            .iter()
            .map(|f| {
                let b = f.bbox();
                Face { x: b.x().max(0) as u32, y: b.y().max(0) as u32, w: b.width(), h: b.height(), score: f.score() }
            })
            .collect();
        let Some(face) = pick_dominant(&faces, FRAME_W) else { return Ok(None) };
        let (x, y, size) = square_crop(&face, FRAME_W, FRAME_H, 0.45);
        let img = RgbImage::from_raw(FRAME_W, FRAME_H, rgb).context("frame buffer")?;
        let crop = imageops::resize(&imageops::crop_imm(&img, x, y, size, size).to_image(), PORTRAIT, PORTRAIT, imageops::FilterType::Triangle);
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85).encode_image(&crop)?;
        Ok(Some(Portrait {
            image: format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg)),
            score: face.score,
            face_width: face.w as f32 / FRAME_W as f32,
            hash: format!("{:016x}", ahash(&gray, FRAME_W, x, y, size)),
        }))
    }
}

/// Decides which segments are worth a frame grab: long enough that the camera
/// is likely on the speaker, spaced out to get different shots, and capped.
#[derive(Debug, Default)]
pub struct FacePlanner {
    attempts: HashMap<usize, (u32, f64)>,
    found: HashMap<usize, u32>,
}

pub const MIN_SEGMENT_SECS: f64 = 2.0;
const MAX_ATTEMPTS: u32 = 10;
const WANTED: u32 = 4;
const SPACING_SECS: f64 = 15.0;

impl FacePlanner {
    pub fn want(&mut self, speaker: usize, start: f64, end: f64) -> bool {
        if end - start < MIN_SEGMENT_SECS || self.found.get(&speaker).copied().unwrap_or(0) >= WANTED {
            return false;
        }
        let (n, last) = self.attempts.get(&speaker).copied().unwrap_or((0, f64::NEG_INFINITY));
        if n >= MAX_ATTEMPTS || start - last < SPACING_SECS {
            return false;
        }
        self.attempts.insert(speaker, (n + 1, start));
        true
    }

    pub fn record_found(&mut self, speaker: usize) {
        *self.found.entry(speaker).or_default() += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(x: u32, w: u32) -> Face {
        Face { x, y: 40, w, h: w, score: 5.0 }
    }

    #[test]
    fn single_or_clearly_larger_face_wins_ambiguous_shots_yield_nothing() {
        assert_eq!(pick_dominant(&[face(100, 120)], 640).unwrap().x, 100);
        assert_eq!(pick_dominant(&[face(10, 150), face(400, 60)], 640).unwrap().x, 10);
        assert!(pick_dominant(&[face(10, 100), face(400, 90)], 640).is_none(), "two candidates side by side");
        assert!(pick_dominant(&[face(10, 20)], 640).is_none(), "audience-sized face");
        assert!(pick_dominant(&[], 640).is_none());
    }

    #[test]
    fn crop_stays_inside_frame_at_edges() {
        for f in [face(0, 100), face(600, 40), Face { x: 300, y: 330, w: 30, h: 30, score: 1.0 }, face(0, 400)] {
            let (x, y, s) = square_crop(&f, 640, 360, 0.45);
            assert!(x + s <= 640 && y + s <= 360 && s > 0, "{f:?} -> {x},{y},{s}");
        }
    }

    #[test]
    fn hash_separates_different_images_and_matches_identical_ones() {
        let w = 64u32;
        let left: Vec<u8> = (0..w * w).map(|i| if i % w < w / 2 { 250 } else { 5 }).collect();
        let top: Vec<u8> = (0..w * w).map(|i| if i / w < w / 2 { 250 } else { 5 }).collect();
        assert_eq!(ahash(&left, w, 0, 0, w), ahash(&left.clone(), w, 0, 0, w));
        assert!((ahash(&left, w, 0, 0, w) ^ ahash(&top, w, 0, 0, w)).count_ones() >= 24);
    }

    #[test]
    fn planner_spaces_attempts_and_stops_when_enough_portraits() {
        let mut p = FacePlanner::default();
        assert!(!p.want(0, 0.0, 1.0), "too short");
        assert!(p.want(0, 0.0, 5.0));
        assert!(!p.want(0, 5.0, 10.0), "too soon after the last attempt");
        assert!(p.want(1, 5.0, 10.0), "other speakers are independent");
        assert!(p.want(0, 20.0, 25.0));
        for _ in 0..WANTED {
            p.record_found(0);
        }
        assert!(!p.want(0, 60.0, 70.0), "enough portraits");
    }

    #[test]
    fn embedded_face_model_loads_and_rejects_wrong_frame_sizes() {
        let mut g = FaceGrabber::new(None).expect("embedded model");
        assert!(g.exhausted(), "no video source means nothing to wait for");
        assert!(g.grab(10.0).unwrap().is_none());
        assert!(g.portrait_from_rgb(vec![0; 12]).is_err());
        let blank = vec![128u8; (FRAME_W * FRAME_H * 3) as usize];
        assert!(g.portrait_from_rgb(blank).unwrap().is_none(), "a blank frame has no face");
    }

    /// TRETA_FACE_SAMPLE=<640x360 frame with one person on camera>
    #[test]
    #[ignore = "needs a real video frame"]
    fn finds_the_speaker_in_a_real_frame() {
        let path = std::env::var("TRETA_FACE_SAMPLE").expect("TRETA_FACE_SAMPLE");
        let img = image::open(path).expect("sample frame").resize_exact(FRAME_W, FRAME_H, imageops::FilterType::Triangle).to_rgb8();
        let p = FaceGrabber::new(None).unwrap().portrait_from_rgb(img.into_raw()).unwrap().expect("a dominant face");
        assert!(p.face_width > 0.1, "close-up face, got {}", p.face_width);
        assert!(p.image.starts_with("data:image/jpeg;base64,"));
    }
}
