use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// 加载（或初始化）存储目录。
///
/// 优先级：
/// 1. 环境变量 LANFILESHARE_STORAGE
/// 2. 应用数据目录中的 storage-config.json
/// 3. 旧版项目目录中的 storage-config.json（兼容升级）
/// 4. 默认 E:\lanshare（若 E 盘不存在则使用用户目录）
pub fn init_storage(data_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(data_dir).map_err(|e| format!("创建应用数据目录失败: {e}"))?;

    let config_path = data_dir.join("storage-config.json");

    if let Ok(value) = std::env::var("LANFILESHARE_STORAGE") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if path.is_dir() {
                return Ok(path);
            }
        }
    }

    if let Some(path) = read_config(&config_path) {
        if path.is_dir() {
            return Ok(path);
        }
    }

    for legacy in legacy_dirs() {
        let legacy_config = legacy.join("storage-config.json");
        if let Some(path) = read_config(&legacy_config) {
            if path.is_dir() {
                write_config(&config_path, &path)?;
                return Ok(path);
            }
        }
    }

    let path = default_storage_path();
    fs::create_dir_all(&path).map_err(|e| format!("创建存储目录失败: {e}"))?;
    write_config(&config_path, &path)?;
    Ok(path)
}

/// 把存储目录写入配置文件。
pub fn write_config(path: &Path, storage: &Path) -> Result<(), String> {
    let value = serde_json::json!({ "storagePath": storage.to_string_lossy() });
    let text = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("序列化存储配置失败: {e}"))?;
    fs::write(path, text).map_err(|e| format!("写入存储配置失败: {e}"))
}

/// 在线预览服务地址的配置文件。
pub fn preview_config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("preview-config.json")
}

/// 读取预览配置：(预览地址, 预览按钮开关)。
/// 地址空串表示未配置（不提供默认预览地址）；开关缺省为关闭。
pub fn read_preview_config(path: &Path) -> (String, bool) {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .map(|value| {
            let base = value
                .get("previewBase")
                .and_then(|it| it.as_str())
                .map(|it| it.trim().to_string())
                .unwrap_or_default();
            let enabled = value
                .get("enabled")
                .and_then(|it| it.as_bool())
                .unwrap_or(false);
            (base, enabled)
        })
        .unwrap_or_default()
}

/// 保存预览配置（地址 + 预览按钮开关）。
pub fn write_preview_config(path: &Path, preview_base: &str, enabled: bool) -> Result<(), String> {
    let value = serde_json::json!({ "previewBase": preview_base, "enabled": enabled });
    let text = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("序列化预览配置失败: {e}"))?;
    fs::write(path, text).map_err(|e| format!("写入预览配置失败: {e}"))
}

/// 局域网页面功能开关的配置文件。
pub fn features_config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("features-config.json")
}

/// 六个功能开关的键名（管理端与局域网页面共用同一套键）。
pub const FEATURE_KEYS: [&str; 6] = ["upload", "mkdir", "delete", "move", "rename", "share"];

fn feature_on() -> bool {
    true
}

/// 功能开关集合：上传 / 新建文件夹 / 删除 / 移动 / 重命名（编辑）/ 分享。
/// 默认全部开启（保持原有行为），管理端可逐个关闭。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Features {
    #[serde(default = "feature_on")]
    pub upload: bool,
    #[serde(default = "feature_on")]
    pub mkdir: bool,
    #[serde(default = "feature_on", rename = "delete")]
    pub remove: bool,
    #[serde(default = "feature_on", rename = "move")]
    pub relocate: bool,
    #[serde(default = "feature_on")]
    pub rename: bool,
    #[serde(default = "feature_on")]
    pub share: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self {
            upload: true,
            mkdir: true,
            remove: true,
            relocate: true,
            rename: true,
            share: true,
        }
    }
}

impl Features {
    /// 读取某个功能的开关状态；未知键视为开启（避免误伤）。
    pub fn get(&self, key: &str) -> bool {
        match key {
            "upload" => self.upload,
            "mkdir" => self.mkdir,
            "delete" => self.remove,
            "move" => self.relocate,
            "rename" => self.rename,
            "share" => self.share,
            _ => true,
        }
    }

    /// 修改某个功能的开关状态；未知键返回错误。
    pub fn set(&mut self, key: &str, enabled: bool) -> Result<(), String> {
        match key {
            "upload" => self.upload = enabled,
            "mkdir" => self.mkdir = enabled,
            "delete" => self.remove = enabled,
            "move" => self.relocate = enabled,
            "rename" => self.rename = enabled,
            "share" => self.share = enabled,
            _ => {
                return Err(format!(
                    "未知功能开关：{key}（可选：{}）",
                    FEATURE_KEYS.join("、")
                ))
            }
        }
        Ok(())
    }
}

/// 读取功能开关；文件缺失、字段缺失或解析失败时全部开启。
pub fn read_features(path: &Path) -> Features {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Features>(&text).ok())
        .unwrap_or_default()
}

/// 保存功能开关。
pub fn write_features(path: &Path, features: &Features) -> Result<(), String> {
    let text = serde_json::to_string_pretty(features)
        .map_err(|e| format!("序列化功能开关配置失败: {e}"))?;
    fs::write(path, text).map_err(|e| format!("写入功能开关配置失败: {e}"))
}

/// 局域网 HTTP 服务端口的配置文件。
pub fn port_config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("port-config.json")
}
/// 读取已保存的端口；缺失、越界或解析失败时回落到默认端口。
pub fn read_port(path: &Path, default: u16) -> u16 {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.get("port").and_then(|it| it.as_u64()))
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| (crate::server::MIN_PORT..=crate::server::MAX_PORT).contains(port))
        .unwrap_or(default)
}

/// 保存局域网 HTTP 服务端口。
pub fn write_port(path: &Path, port: u16) -> Result<(), String> {
    let value = serde_json::json!({ "port": port });
    let text = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("序列化端口配置失败: {e}"))?;
    fs::write(path, text).map_err(|e| format!("写入端口配置失败: {e}"))
}

/// 把旧版项目中的访问日志迁移到应用数据目录（仅首次）。
pub fn migrate_legacy_log(data_dir: &Path) -> PathBuf {
    let target = data_dir.join("access-log.json");
    if target.exists() {
        return target;
    }

    for dir in legacy_dirs() {
        let legacy_log = dir.join("access-log.json");
        if legacy_log.is_file() {
            let _ = fs::copy(&legacy_log, &target);
            break;
        }
    }

    target
}

fn read_config(path: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let raw = value.get("storagePath")?.as_str()?.trim();
    if raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(raw))
    }
}

fn legacy_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd);
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));

    dirs
}

fn default_storage_path() -> PathBuf {
    if Path::new("E:\\").exists() {
        return PathBuf::from("E:\\lanshare");
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        return PathBuf::from(profile).join("lanshare");
    }

    PathBuf::from("lanshare")
}
