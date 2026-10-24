//! Debate archive in SQLite, so a crash or a closed window never loses a debate.
//! The app sends the whole debate every few seconds; each save replaces that
//! debate's rows in one transaction (cheap for a few thousand rows, and merges
//! or reassignments never leave stale rows behind).

use rusqlite::{params, Connection};
use serde::Deserialize;
use std::path::Path;
use std::sync::Mutex;

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS debates (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at TEXT NOT NULL,
  saved_at TEXT NOT NULL, ended INTEGER NOT NULL, duration REAL NOT NULL);
CREATE TABLE IF NOT EXISTS speakers (
  debate_id TEXT NOT NULL REFERENCES debates(id) ON DELETE CASCADE, id INTEGER NOT NULL,
  name TEXT NOT NULL, photo TEXT, talk_seconds REAL NOT NULL, PRIMARY KEY (debate_id, id));
CREATE TABLE IF NOT EXISTS utterances (
  debate_id TEXT NOT NULL REFERENCES debates(id) ON DELETE CASCADE, id TEXT NOT NULL,
  speaker INTEGER NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL,
  uncertain TEXT, reviewed INTEGER NOT NULL, PRIMARY KEY (debate_id, id));
CREATE TABLE IF NOT EXISTS claims (
  debate_id TEXT NOT NULL REFERENCES debates(id) ON DELETE CASCADE, id TEXT NOT NULL,
  utterance_id TEXT NOT NULL, speaker INTEGER NOT NULL, at REAL NOT NULL, quote TEXT NOT NULL,
  query TEXT NOT NULL, status TEXT NOT NULL, verdict TEXT, explanation TEXT, confidence REAL,
  sources TEXT NOT NULL, uncertain INTEGER NOT NULL, PRIMARY KEY (debate_id, id));
CREATE TABLE IF NOT EXISTS fallacies (
  debate_id TEXT NOT NULL REFERENCES debates(id) ON DELETE CASCADE, id TEXT NOT NULL,
  utterance_id TEXT NOT NULL, speaker INTEGER NOT NULL, at REAL NOT NULL, kind TEXT NOT NULL,
  quote TEXT NOT NULL, explanation TEXT NOT NULL, uncertain INTEGER NOT NULL, PRIMARY KEY (debate_id, id));
";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub source: String,
    pub started_at: String,
    pub saved_at: String,
    pub ended: bool,
    pub duration: f64,
    pub speakers: Vec<SpeakerRow>,
    pub utterances: Vec<UtteranceRow>,
    pub claims: Vec<ClaimRow>,
    pub fallacies: Vec<FallacyRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerRow {
    pub id: i64,
    pub name: String,
    pub photo: Option<String>,
    pub talk_seconds: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UtteranceRow {
    pub id: String,
    pub speaker: i64,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub uncertain: Option<String>,
    #[serde(default)]
    pub reviewed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRow {
    pub id: String,
    pub utterance_id: String,
    pub speaker: i64,
    pub at: f64,
    pub quote: String,
    pub query: String,
    pub status: String,
    pub verdict: Option<String>,
    pub explanation: Option<String>,
    pub confidence: Option<f64>,
    #[serde(default)]
    pub sources: serde_json::Value,
    #[serde(default)]
    pub uncertain: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FallacyRow {
    pub id: String,
    pub utterance_id: String,
    pub speaker: i64,
    pub at: f64,
    pub kind: String,
    pub quote: String,
    pub explanation: String,
    #[serde(default)]
    pub uncertain: bool,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    Ok(conn)
}

fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn save(conn: &mut Connection, s: &Snapshot) -> Result<(), String> {
    if !valid_id(&s.id) {
        return Err("invalid debate id".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let run = |tx: &rusqlite::Transaction| -> rusqlite::Result<()> {
        tx.execute(
            "INSERT INTO debates (id, source, started_at, saved_at, ended, duration) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET source = excluded.source, saved_at = excluded.saved_at, ended = excluded.ended, duration = excluded.duration",
            params![s.id, s.source, s.started_at, s.saved_at, s.ended, s.duration],
        )?;
        for table in ["speakers", "utterances", "claims", "fallacies"] {
            tx.execute(&format!("DELETE FROM {table} WHERE debate_id = ?1"), [&s.id])?;
        }
        let mut q = tx.prepare("INSERT INTO speakers VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for r in &s.speakers {
            q.execute(params![s.id, r.id, r.name, r.photo, r.talk_seconds])?;
        }
        let mut q = tx.prepare("INSERT INTO utterances VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")?;
        for r in &s.utterances {
            q.execute(params![s.id, r.id, r.speaker, r.start, r.end, r.text, r.uncertain, r.reviewed])?;
        }
        let mut q = tx.prepare("INSERT INTO claims VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)")?;
        for r in &s.claims {
            q.execute(params![s.id, r.id, r.utterance_id, r.speaker, r.at, r.quote, r.query, r.status, r.verdict, r.explanation, r.confidence, r.sources.to_string(), r.uncertain])?;
        }
        let mut q = tx.prepare("INSERT INTO fallacies VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")?;
        for r in &s.fallacies {
            q.execute(params![s.id, r.id, r.utterance_id, r.speaker, r.at, r.kind, r.quote, r.explanation, r.uncertain])?;
        }
        Ok(())
    };
    run(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Lazily opened archive at `<app data>/treta.sqlite`.
#[derive(Default)]
pub struct Store(pub Mutex<Option<Connection>>);

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(json: &str) -> Snapshot {
        serde_json::from_str(json).unwrap()
    }

    const BASE: &str = r#"{"id":"d-1","source":"https://youtu.be/x","startedAt":"2026-10-23T21:00:00","savedAt":"2026-10-23T21:01:00","ended":false,"duration":60,
      "speakers":[{"id":0,"name":"Flávio","talkSeconds":30},{"id":1,"name":"Lula","photo":"data:image/jpeg;base64,AA","talkSeconds":28}],
      "utterances":[{"id":"u1","speaker":0,"start":0,"end":5,"text":"Boa noite, Adriana. 'aspas' \"duplas\""},{"id":"u2","speaker":1,"start":6,"end":9,"text":"x","uncertain":"self-address"}],
      "claims":[{"id":"c1","utteranceId":"u2","speaker":1,"at":6,"quote":"q","query":"q","status":"done","verdict":"falso","sources":[{"title":"t","url":"https://n"}],"uncertain":true}],
      "fallacies":[{"id":"f1","utteranceId":"u1","speaker":0,"at":0,"kind":"ad hominem","quote":"q","explanation":"e"}]}"#;

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn saving_again_replaces_the_debate_instead_of_duplicating_it() {
        let mut conn = open(Path::new(":memory:")).unwrap();
        save(&mut conn, &snapshot(BASE)).unwrap();
        save(&mut conn, &snapshot(BASE)).unwrap();
        assert_eq!((count(&conn, "debates"), count(&conn, "utterances"), count(&conn, "claims")), (1, 2, 1));
        // A merge removed voice 1 and moved its turn: no stale rows survive.
        let merged = BASE.replace(r#",{"id":1,"name":"Lula","photo":"data:image/jpeg;base64,AA","talkSeconds":28}"#, "").replace(r#""speaker":1"#, r#""speaker":0"#);
        save(&mut conn, &snapshot(&merged)).unwrap();
        assert_eq!(count(&conn, "speakers"), 1);
        let text: String = conn.query_row("SELECT text FROM utterances WHERE id = 'u1'", [], |r| r.get(0)).unwrap();
        assert!(text.contains("'aspas'"));
        let sources: String = conn.query_row("SELECT sources FROM claims", [], |r| r.get(0)).unwrap();
        assert!(sources.contains("https://n"));
    }

    #[test]
    fn rejects_ids_that_are_not_plain_tokens() {
        let mut conn = open(Path::new(":memory:")).unwrap();
        for bad in ["", "x'; DROP TABLE debates; --", &"a".repeat(65)] {
            let s = snapshot(&BASE.replace(r#""id":"d-1""#, &format!(r#""id":{}"#, serde_json::to_string(bad).unwrap())));
            assert!(save(&mut conn, &s).is_err(), "{bad}");
        }
    }
}
