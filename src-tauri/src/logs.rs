use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

const MAX_LOGS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: String,
    pub time: String,
    pub ip: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}

pub struct LogStore {
    path: PathBuf,
    entries: Mutex<Vec<LogEntry>>,
}

impl LogStore {
    pub fn new(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<LogEntry>>(&text).ok())
            .unwrap_or_default();

        Self {
            path,
            entries: Mutex::new(entries),
        }
    }

    /// type: download | upload | share-download | delete | mkdir | rename | move
    pub fn add(&self, ip: &str, kind: &str, file: String, size: Option<u64>, to: Option<String>) {
        let entry = LogEntry {
            id: format!("{:x}{}", Utc::now().timestamp_millis(), nanoid::nanoid!(6)),
            time: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            ip: ip.to_string(),
            kind: kind.to_string(),
            file,
            size,
            to,
        };

        let snapshot = {
            let mut entries = match self.entries.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            entries.push(entry);
            if entries.len() > MAX_LOGS {
                let overflow = entries.len() - MAX_LOGS;
                entries.drain(0..overflow);
            }
            entries.clone()
        };

        if let Ok(text) = serde_json::to_string_pretty(&snapshot) {
            let _ = fs::write(&self.path, text);
        }
    }

    pub fn page(&self, limit: usize, offset: usize) -> (usize, Vec<LogEntry>) {
        let entries = match self.entries.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let total = entries.len();
        let items = entries
            .iter()
            .rev()
            .skip(offset)
            .take(limit)
            .cloned()
            .collect();
        (total, items)
    }

    /// 清空全部访问日志，返回清除的条数。
    pub fn clear(&self) -> usize {
        let (removed, snapshot) = {
            let mut entries = match self.entries.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            let removed = entries.len();
            entries.clear();
            (removed, entries.clone())
        };

        if let Ok(text) = serde_json::to_string_pretty(&snapshot) {
            let _ = fs::write(&self.path, text);
        }

        removed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clears_all_logs() {
        let base = std::env::temp_dir().join(format!("lfs-log-test-{}", nanoid::nanoid!(8)));
        let store = LogStore::new(base.join("access-log.json"));

        store.add("127.0.0.1", "download", "a.txt".to_string(), Some(3), None);
        store.add("127.0.0.1", "upload", "b.txt".to_string(), Some(4), None);
        assert_eq!(store.page(10, 0).0, 2);

        assert_eq!(store.clear(), 2);
        assert_eq!(store.page(10, 0).0, 0);

        let saved = std::fs::read_to_string(base.join("access-log.json")).unwrap();
        assert_eq!(saved.trim(), "[]");

        let _ = std::fs::remove_dir_all(&base);
    }
}
