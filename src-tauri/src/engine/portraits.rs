//! Portrait worker: grabs frames off the audio thread so a slow video decode
//! never delays transcription.

use super::source::SourceSpec;
use super::faces::FacePlanner;
use super::{faces, video, EngineEvent, SharedClusters};
use std::cell::RefCell;
use anyhow::anyhow;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

pub(super) enum FaceMsg {
    Unavailable(String),
    Shot { speaker: usize, t: f64, portrait: faces::Portrait },
}

pub(super) type FaceChannels = (Option<std::sync::mpsc::Sender<(usize, f64)>>, Option<std::sync::mpsc::Receiver<FaceMsg>>);

pub(super) fn spawn_face_worker(spec: SourceSpec, audio_clock: Arc<AtomicU64>) -> FaceChannels {
    if matches!(spec, SourceSpec::Mic | SourceSpec::System) {
        return (None, None);
    }
    let (job_tx, job_rx) = std::sync::mpsc::channel::<(usize, f64)>();
    let (res_tx, res_rx) = std::sync::mpsc::channel::<FaceMsg>();
    std::thread::spawn(move || {
        let grabber = video::VideoInput::for_source(&spec).and_then(|input| {
            let input = input.ok_or_else(|| anyhow!("no video for this source"))?;
            faces::FaceGrabber::new(Some(video::VideoTap::start(&input, audio_clock)?))
        });
        let mut grabber = match grabber {
            Ok(g) => g,
            Err(e) => {
                let _ = res_tx.send(FaceMsg::Unavailable(format!("{e:#}")));
                return;
            }
        };
        for (speaker, t) in job_rx {
            if grabber.exhausted() {
                let _ = res_tx.send(FaceMsg::Unavailable("a fonte não tem vídeo".into()));
                return;
            }
            match grabber.grab(t) {
                Ok(Some(portrait)) => {
                    let _ = res_tx.send(FaceMsg::Shot { speaker, t, portrait });
                }
                Ok(None) => {}
                Err(e) => eprintln!("face grab at {t:.1}s failed: {e:#}"),
            }
        }
    });
    (Some(job_tx), Some(res_rx))
}

pub(super) fn emit_face(msg: FaceMsg, planner: &RefCell<FacePlanner>, clusters: &SharedClusters, emit: &mut dyn FnMut(EngineEvent)) {
    match msg {
        FaceMsg::Unavailable(why) => emit(EngineEvent::Status { message: format!("Fotos automáticas indisponíveis: {why}") }),
        FaceMsg::Shot { speaker, t, portrait } => {
            // Counted under the id the grab was planned for, before any merge.
            planner.borrow_mut().record_found(speaker);
            let speaker = clusters.lock().expect("clusters lock").resolve(speaker);
            emit(EngineEvent::Face { speaker, t, portrait });
        }
    }
}
