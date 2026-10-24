//! Voice model catalogue: pinned URLs and SHA-256 so a tampered download is rejected.

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
}

const BASE: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

pub const VAD: ModelSpec = ModelSpec {
    id: "silero-vad",
    file: "silero_vad.onnx",
    url: "asr-models/silero_vad.onnx",
    sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
};

pub const EMBEDDINGS: &[ModelSpec] = &[
    ModelSpec {
        id: "wespeaker-resnet34",
        file: "wespeaker_en_voxceleb_resnet34_LM.onnx",
        url: "speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx",
        sha256: "e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012",
    },
    ModelSpec {
        id: "3dspeaker-campplus",
        file: "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        url: "speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
    },
    ModelSpec {
        id: "nemo-titanet-small",
        file: "nemo_en_titanet_small.onnx",
        url: "speaker-recongition-models/nemo_en_titanet_small.onnx",
        sha256: "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e",
    },
];

pub fn embedding(id: &str) -> Result<ModelSpec> {
    EMBEDDINGS.iter().copied().find(|m| m.id == id).with_context(|| format!("unknown voice model '{id}'"))
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// Returns the verified local path, downloading the model first if needed.
pub fn ensure(dir: &Path, spec: &ModelSpec, on_status: &mut dyn FnMut(String)) -> Result<PathBuf> {
    fs::create_dir_all(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    let path = dir.join(spec.file);
    if path.exists() && sha256_file(&path)? == spec.sha256 {
        return Ok(path);
    }
    on_status(format!("Baixando modelo de voz {}…", spec.id));
    let url = format!("{BASE}/{}", spec.url);
    let resp = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()?
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .with_context(|| format!("download failed: {url}"))?;
    let bytes = resp.bytes()?;
    // Per process: an engine still stopping must not write into the next one's download.
    let tmp = path.with_extension(format!("{}.part", std::process::id()));
    fs::write(&tmp, &bytes)?;
    let got = sha256_file(&tmp)?;
    if got != spec.sha256 {
        let _ = fs::remove_file(&tmp);
        bail!("checksum mismatch for {}: expected {}, got {got}", spec.file, spec.sha256);
    }
    fs::rename(&tmp, &path)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_ids_are_unique_and_hashes_well_formed() {
        let mut ids: Vec<_> = EMBEDDINGS.iter().map(|m| m.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), EMBEDDINGS.len());
        for m in EMBEDDINGS.iter().chain([&VAD]) {
            assert_eq!(m.sha256.len(), 64);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit()));
        }
        assert!(embedding("nope").is_err());
    }

    #[test]
    fn corrupted_local_file_is_detected_by_hash() {
        let dir = std::env::temp_dir().join(format!("treta-models-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("x.onnx");
        fs::write(&p, b"not a model").unwrap();
        assert_ne!(sha256_file(&p).unwrap(), VAD.sha256);
        let _ = fs::remove_dir_all(&dir);
    }
}
