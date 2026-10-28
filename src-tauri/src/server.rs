use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, SecondsFormat, Utc};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio_util::io::ReaderStream;

use rust_embed::RustEmbed;

use crate::logs::LogStore;
use crate::storage::Features;

pub const DEFAULT_PORT: u16 = 8081;
/// 端口允许范围：避开 1024 以下的系统保留端口。
pub const MIN_PORT: u16 = 1024;
pub const MAX_PORT: u16 = 65535;
const MAX_UPLOAD_BYTES: usize = 2 * 1024 * 1024 * 1024;

#[derive(RustEmbed)]
#[folder = "../dist/"]
struct Assets;

#[derive(Clone)]
struct ShareLink {
    file_path: String,
    created_at: u64,
}

pub struct AppState {
    storage: tokio::sync::RwLock<PathBuf>,
    /// 管理端保存的预览地址；空串表示未配置（不提供默认预览地址，回退到环境变量）。
    preview: tokio::sync::RwLock<String>,
    /// 预览按钮开关：控制局域网页面是否提供预览，默认关闭。
    preview_enabled: tokio::sync::RwLock<bool>,
    /// 局域网页面功能开关：上传 / 新建文件夹 / 删除 / 移动 / 重命名 / 分享，默认全部开启。
    features: tokio::sync::RwLock<Features>,
    storage_config_path: PathBuf,
    preview_config_path: PathBuf,
    features_config_path: PathBuf,
    port_config_path: PathBuf,
    pub logs: LogStore,
    shares: Mutex<HashMap<String, ShareLink>>,
    port: tokio::sync::RwLock<u16>,
    /// 端口切换信号：监听任务收到新端口后优雅关闭旧监听并绑定新端口。
    port_tx: tokio::sync::watch::Sender<u16>,
}

impl AppState {
    /// 当前存储目录。局域网服务与桌面管理端共用这一份配置。
    pub async fn storage_path(&self) -> PathBuf {
        self.storage.read().await.clone()
    }

    /// 切换存储目录并持久化，立即对局域网页面生效。
    pub async fn set_storage(&self, path: PathBuf) -> Result<(), String> {
        if !path.is_dir() {
            return Err(format!("文件夹不存在：{}", path.display()));
        }
        crate::storage::write_config(&self.storage_config_path, &path)?;
        *self.storage.write().await = path;
        Ok(())
    }

    /// 管理端保存的原始配置（空串代表未设置）。
    pub async fn preview_configured(&self) -> String {
        self.preview.read().await.clone()
    }

    /// 预览按钮开关状态（默认关闭）。
    pub async fn preview_switched(&self) -> bool {
        *self.preview_enabled.read().await
    }

    /// 实际生效的预览地址：管理端配置 > 环境变量；不提供默认预览地址。
    pub async fn preview_base(&self) -> Option<String> {
        let configured = self.preview.read().await.clone();
        if !configured.is_empty() {
            return Some(configured);
        }
        env_preview_base()
    }

    /// 预览是否可用：开关开启且已配置预览地址，二者缺一都不让预览。
    pub async fn preview_available(&self) -> bool {
        self.preview_switched().await && self.preview_base().await.is_some()
    }

    /// 修改预览地址并持久化；传空串表示清空地址。立即对局域网页面生效（刷新后）。
    pub async fn set_preview_base(&self, value: &str) -> Result<(), String> {
        let normalized = normalize_preview_base(value)?;
        let enabled = self.preview_switched().await;
        crate::storage::write_preview_config(&self.preview_config_path, &normalized, enabled)?;
        *self.preview.write().await = normalized;
        Ok(())
    }

    /// 切换预览按钮开关并持久化（地址为空时开启开关也不提供预览）。
    pub async fn set_preview_enabled(&self, enabled: bool) -> Result<(), String> {
        let configured = self.preview.read().await.clone();
        crate::storage::write_preview_config(&self.preview_config_path, &configured, enabled)?;
        *self.preview_enabled.write().await = enabled;
        Ok(())
    }

    /// 全部功能开关的当前状态。
    pub async fn features(&self) -> Features {
        *self.features.read().await
    }

    /// 某个功能是否开放（关闭后局域网页面隐藏入口，HTTP 接口同步返回 403）。
    pub async fn feature_enabled(&self, key: &str) -> bool {
        self.features.read().await.get(key)
    }

    /// 修改某个功能开关并持久化，立即对局域网页面（刷新后）与 HTTP 接口生效。
    pub async fn set_feature(&self, key: &str, enabled: bool) -> Result<Features, String> {
        let mut features = self.features.write().await;
        features.set(key, enabled)?;
        crate::storage::write_features(&self.features_config_path, &features)?;
        Ok(*features)
    }

    /// 当前局域网服务端口。
    pub async fn port(&self) -> u16 {
        *self.port.read().await
    }

    /// 切换局域网服务端口：校验 → 试绑定 → 持久化 → 通知监听任务重启。
    pub async fn set_port(&self, port: u16) -> Result<(), String> {
        if !(MIN_PORT..=MAX_PORT).contains(&port) {
            return Err(format!(
                "端口需在 {MIN_PORT}–{MAX_PORT} 之间（1024 以下为系统保留端口）"
            ));
        }
        if port == self.port().await {
            return Ok(());
        }

        // 先确认端口真的能绑定，避免写进配置后服务反而起不来
        match std::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))) {
            Ok(listener) => drop(listener),
            Err(err) => return Err(format!("端口 {port} 不可用：{err}")),
        }

        crate::storage::write_port(&self.port_config_path, port)?;
        *self.port.write().await = port;
        let _ = self.port_tx.send(port);
        Ok(())
    }
}

/* ============================ Errors ============================ */

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    /// 功能开关关闭后拒绝调用（管理端关闭的上传/删除等功能，直接调接口也无效）。
    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        Self::internal(err.to_string())
    }
}

/* ============================ Paths ============================ */

pub fn normalize_rel(input: &str) -> String {
    input.replace('\\', "/").trim_matches('/').to_string()
}

pub fn resolve_path(base: &Path, relative: &str) -> Result<PathBuf, ApiError> {
    let mut out = base.to_path_buf();

    for segment in normalize_rel(relative).split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." || segment.contains(':') {
            return Err(ApiError::bad_request("非法路径"));
        }
        out.push(segment);
    }

    Ok(out)
}

fn join_rel(parent: &str, name: &str) -> String {
    let parent = normalize_rel(parent);
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn validate_name(name: &str) -> Result<&str, ApiError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed.chars().any(|c| c.is_control())
    {
        return Err(ApiError::bad_request("非法名称"));
    }
    Ok(trimmed)
}

fn sanitize_filename(name: &str) -> Option<String> {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .trim()
        .to_string();

    if base.is_empty()
        || base == "."
        || base == ".."
        || base.contains(':')
        || base.chars().any(|c| c.is_control())
    {
        None
    } else {
        Some(base)
    }
}

/* ============================ Utils ============================ */

fn client_ip(headers: &HeaderMap, addr: SocketAddr) -> String {
    if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(ip) = value.split(',').next() {
            let ip = ip.trim();
            if !ip.is_empty() {
                return normalize_ip(ip);
            }
        }
    }
    if let Some(value) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let ip = value.trim();
        if !ip.is_empty() {
            return normalize_ip(ip);
        }
    }
    normalize_ip(&addr.ip().to_string())
}

fn normalize_ip(ip: &str) -> String {
    let ip = ip.trim().trim_start_matches("::ffff:");
    if ip == "::1" {
        "127.0.0.1".to_string()
    } else {
        ip.to_string()
    }
}

fn local_ipv4() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) => Some(ip.to_string()),
        IpAddr::V6(_) => None,
    }
}

fn network_addresses(port: u16) -> Vec<(String, String)> {
    match local_ipv4() {
        Some(ip) if ip != "127.0.0.1" && ip != "0.0.0.0" => {
            vec![(ip.clone(), format!("http://{ip}:{port}"))]
        }
        _ => vec![("127.0.0.1".to_string(), format!("http://127.0.0.1:{port}"))],
    }
}

fn content_disposition(kind: &str, filename: &str) -> String {
    let encoded = utf8_percent_encode(filename, NON_ALPHANUMERIC).to_string();
    let ascii: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{kind}; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

fn mime_for(path: &Path) -> String {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let raw = mime.to_string();
    if raw.starts_with("text/") || raw == "application/json" || raw == "application/javascript" {
        format!("{raw}; charset=utf-8")
    } else {
        raw
    }
}

fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let value = value.strip_prefix("bytes=")?;
    let (start, end) = value.split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end = if end.trim().is_empty() {
        len.saturating_sub(1)
    } else {
        end.trim().parse::<u64>().ok()?
    };
    if len == 0 || start >= len || start > end {
        return None;
    }
    Some((start, end.min(len - 1)))
}

async fn serve_file(path: &Path, download: bool, range: Option<&str>) -> Result<Response, ApiError> {
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|_| ApiError::not_found("文件不存在"))?;
    if !meta.is_file() {
        return Err(ApiError::bad_request("不是文件"));
    }

    let len = meta.len();
    let mime = mime_for(path);
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(
            header::CONTENT_DISPOSITION,
            content_disposition(if download { "attachment" } else { "inline" }, &filename),
        );

    if let Some((start, end)) = range.and_then(|value| parse_range(value, len)) {
        let mut file = tokio::fs::File::open(path).await?;
        file.seek(SeekFrom::Start(start)).await?;
        let reader = file.take(end - start + 1);
        builder = builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, (end - start + 1).to_string());

        return builder
            .body(Body::from_stream(ReaderStream::new(reader)))
            .map_err(|err| ApiError::internal(err.to_string()));
    }

    let file = tokio::fs::File::open(path).await?;
    builder
        .header(header::CONTENT_LENGTH, len.to_string())
        .body(Body::from_stream(ReaderStream::new(file)))
        .map_err(|err| ApiError::internal(err.to_string()))
}

/* ============================ File API ============================ */

#[derive(Deserialize)]
struct FilesQuery {
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileItem {
    name: String,
    is_directory: bool,
    size: Option<u64>,
    mtime: Option<String>,
    path: String,
}

fn list_dir(dir: &Path, rel: &str) -> Result<Vec<FileItem>, ApiError> {
    if !dir.exists() {
        return Err(ApiError::not_found("目录不存在"));
    }
    if !dir.is_dir() {
        return Err(ApiError::bad_request("不是目录"));
    }

    let mut items = Vec::new();
    let entries = std::fs::read_dir(dir)?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };

        items.push(FileItem {
            name: name.clone(),
            is_directory: meta.is_dir(),
            size: if meta.is_file() { Some(meta.len()) } else { None },
            mtime: meta
                .modified()
                .ok()
                .map(|time| DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true)),
            path: join_rel(rel, &name),
        });
    }

    items.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

async fn list_files(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FilesQuery>,
) -> Result<Json<Value>, ApiError> {
    let rel = normalize_rel(query.path.as_deref().unwrap_or(""));
    let storage = state.storage_path().await;
    let dir = resolve_path(&storage, &rel)?;
    let dir_clone = dir.clone();
    let rel_clone = rel.clone();

    let items = tokio::task::spawn_blocking(move || list_dir(&dir_clone, &rel_clone))
        .await
        .map_err(|err| ApiError::internal(err.to_string()))??;

    Ok(Json(json!({ "items": items, "currentPath": rel })))
}

/* ============================ Search ============================ */

/// 搜索参数：关键词 `q` + 可选的搜索根目录 `path`（缺省为整个共享目录）。
#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    path: Option<String>,
}

/// 搜索保护上限：结果条数、访问条目数、目录深度（避免大目录拖垮服务）。
const SEARCH_MAX_RESULTS: usize = 200;
const SEARCH_MAX_VISITED: usize = 50_000;
const SEARCH_MAX_DEPTH: usize = 16;

/// 目录树搜索器：按「名称包含关键词」（大小写不敏感）收集文件与文件夹。
/// 跳过符号链接，避免目录环；命中上限即停止遍历并标记 truncated。
struct SearchWalker {
    needle: String,
    items: Vec<FileItem>,
    visited: usize,
    truncated: bool,
}

impl SearchWalker {
    fn new(keyword: &str) -> Self {
        Self {
            needle: keyword.to_lowercase(),
            items: Vec::new(),
            visited: 0,
            truncated: false,
        }
    }

    fn walk(&mut self, dir: &Path, rel: &str, depth: usize) {
        if self.truncated || depth > SEARCH_MAX_DEPTH {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            if self.truncated {
                return;
            }
            self.visited += 1;
            if self.visited > SEARCH_MAX_VISITED {
                self.truncated = true;
                return;
            }
            // 跳过符号链接：既防目录环，也避免搜到共享目录之外
            if matches!(entry.file_type(), Ok(file_type) if file_type.is_symlink()) {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let is_dir = meta.is_dir();
            let path = join_rel(rel, &name);

            if name.to_lowercase().contains(&self.needle) {
                if self.items.len() >= SEARCH_MAX_RESULTS {
                    self.truncated = true;
                    return;
                }
                self.items.push(FileItem {
                    name: name.clone(),
                    is_directory: is_dir,
                    size: if meta.is_file() { Some(meta.len()) } else { None },
                    mtime: meta.modified().ok().map(|time| {
                        DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true)
                    }),
                    path: path.clone(),
                });
            }

            if is_dir {
                self.walk(&entry.path(), &path, depth + 1);
            }
        }
    }
}

/// 按名称搜索文件与文件夹（含子目录）。
/// `path` 指定搜索根目录，为空表示整个共享目录；只读操作，不记访问日志。
async fn search_files(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    let keyword = query.q.trim().to_string();
    if keyword.is_empty() {
        return Err(ApiError::bad_request("请输入搜索关键词"));
    }
    if keyword.chars().count() > 128 {
        return Err(ApiError::bad_request("搜索关键词最多 128 个字符"));
    }

    let rel = normalize_rel(query.path.as_deref().unwrap_or(""));
    let storage = state.storage_path().await;
    let dir = resolve_path(&storage, &rel)?;
    if !dir.is_dir() {
        return Err(ApiError::not_found("搜索的目录不存在"));
    }

    let walk_dir = dir;
    let walk_rel = rel.clone();
    let walk_keyword = keyword.clone();
    let (items, truncated) = tokio::task::spawn_blocking(move || {
        let mut walker = SearchWalker::new(&walk_keyword);
        walker.walk(&walk_dir, &walk_rel, 0);
        let truncated = walker.truncated;
        walker.items.sort_by(|a, b| {
            b.is_directory
                .cmp(&a.is_directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        (walker.items, truncated)
    })
    .await
    .map_err(|err| ApiError::internal(err.to_string()))?;

    Ok(Json(json!({
        "items": items,
        "query": keyword,
        "searchPath": rel,
        "truncated": truncated,
    })))
}

/* ============================ Feature gates ============================ */

/// 功能开关门禁：被管理端关闭的功能一律 403，避免绕过页面直接调接口。
async fn ensure_feature(state: &AppState, key: &str, label: &str) -> Result<(), ApiError> {
    if state.feature_enabled(key).await {
        return Ok(());
    }
    Err(ApiError::forbidden(format!(
        "「{label}」功能已在管理端关闭"
    )))
}

#[derive(Deserialize)]
struct MkdirBody {
    #[serde(rename = "parentPath")]
    parent_path: Option<String>,
    name: String,
}

async fn mkdir(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<MkdirBody>,
) -> Result<Json<Value>, ApiError> {
    ensure_feature(&state, "mkdir", "新建文件夹").await?;
    let name = validate_name(&body.name)?;
    let rel = join_rel(body.parent_path.as_deref().unwrap_or(""), name);
    let storage = state.storage_path().await;
    let target = resolve_path(&storage, &rel)?;

    tokio::fs::create_dir_all(&target).await?;
    state
        .logs
        .add(&client_ip(&headers, addr), "mkdir", rel, None, None);

    Ok(Json(json!({ "success": true })))
}

async fn delete_item(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    AxumPath(path): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_feature(&state, "delete", "删除").await?;
    let rel = normalize_rel(&path);
    if rel.is_empty() {
        return Err(ApiError::bad_request("不能删除根目录"));
    }

    let target = resolve_path(&state.storage_path().await, &rel)?;
    let meta = tokio::fs::metadata(&target)
        .await
        .map_err(|_| ApiError::not_found("文件不存在"))?;
    let size = if meta.is_file() { Some(meta.len()) } else { None };

    if meta.is_dir() {
        tokio::fs::remove_dir_all(&target).await?;
    } else {
        tokio::fs::remove_file(&target).await?;
    }

    state
        .logs
        .add(&client_ip(&headers, addr), "delete", rel, size, None);

    Ok(Json(json!({ "success": true })))
}

#[derive(Deserialize)]
struct RenameBody {
    #[serde(rename = "oldPath")]
    old_path: String,
    #[serde(rename = "newName")]
    new_name: String,
}

async fn rename(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<RenameBody>,
) -> Result<Json<Value>, ApiError> {
    ensure_feature(&state, "rename", "重命名").await?;
    let rel = normalize_rel(&body.old_path);
    let new_name = validate_name(&body.new_name)?;
    let old_full = resolve_path(&state.storage_path().await, &rel)?;

    let meta = tokio::fs::metadata(&old_full)
        .await
        .map_err(|_| ApiError::not_found("文件不存在"))?;
    let _ = meta;

    let parent = old_full
        .parent()
        .ok_or_else(|| ApiError::bad_request("非法路径"))?;
    let new_full = parent.join(new_name);

    if new_full.exists() {
        return Err(ApiError::bad_request("目标已存在同名文件"));
    }

    tokio::fs::rename(&old_full, &new_full).await?;

    let parent_rel = rel.rsplit_once('/').map(|(head, _)| head).unwrap_or("");
    let new_rel = join_rel(parent_rel, new_name);

    state.logs.add(
        &client_ip(&headers, addr),
        "rename",
        rel,
        None,
        Some(new_rel),
    );

    Ok(Json(json!({ "success": true })))
}

#[derive(Deserialize)]
struct MoveBody {
    #[serde(rename = "sourcePath")]
    source_path: String,
    #[serde(rename = "destDir")]
    dest_dir: Option<String>,
}

async fn move_item(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<MoveBody>,
) -> Result<Json<Value>, ApiError> {
    ensure_feature(&state, "move", "移动").await?;
    let source_rel = normalize_rel(&body.source_path);
    if source_rel.is_empty() {
        return Err(ApiError::bad_request("参数不完整"));
    }
    let dest_rel = normalize_rel(body.dest_dir.as_deref().unwrap_or(""));

    let storage = state.storage_path().await;
    let source_full = resolve_path(&storage, &source_rel)?;
    let dest_dir_full = resolve_path(&storage, &dest_rel)?;

    let source_meta = tokio::fs::metadata(&source_full)
        .await
        .map_err(|_| ApiError::not_found("源文件不存在"))?;
    let _ = source_meta;

    let dest_meta = tokio::fs::metadata(&dest_dir_full)
        .await
        .map_err(|_| ApiError::bad_request("目标目录不存在"))?;
    if !dest_meta.is_dir() {
        return Err(ApiError::bad_request("目标目录不存在"));
    }

    let name = source_full
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        return Err(ApiError::bad_request("参数不完整"));
    }

    let dest_full = dest_dir_full.join(&name);

    if dest_full == source_full || dest_full.starts_with(&source_full) {
        return Err(ApiError::bad_request("不能移动到自身子目录"));
    }
    if dest_full.exists() {
        return Err(ApiError::bad_request("目标已存在同名文件"));
    }

    tokio::fs::rename(&source_full, &dest_full).await?;

    let dest_rel = if dest_rel.is_empty() {
        "/".to_string()
    } else {
        dest_rel
    };

    state.logs.add(
        &client_ip(&headers, addr),
        "move",
        source_rel,
        None,
        Some(dest_rel),
    );

    Ok(Json(json!({ "success": true })))
}

/* ============================ Upload ============================ */

async fn upload(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<Value>, ApiError> {
    ensure_feature(&state, "upload", "上传文件").await?;
    let ip = client_ip(&headers, addr);
    let mut current_path = String::new();
    let mut uploaded: Vec<(String, u64)> = Vec::new();
    let storage = state.storage_path().await;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|err| ApiError::bad_request(format!("上传数据无效: {err}")))?
    {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "path" {
            current_path = field
                .text()
                .await
                .map_err(|err| ApiError::bad_request(format!("上传参数无效: {err}")))?;
            continue;
        }

        if field_name != "files" {
            continue;
        }

        let raw_name = field.file_name().unwrap_or("").to_string();
        let Some(filename) = sanitize_filename(&raw_name) else {
            continue;
        };

        let dir = resolve_path(&storage, &current_path)?;
        tokio::fs::create_dir_all(&dir).await?;

        let dest = dir.join(&filename);
        let mut file = tokio::fs::File::create(&dest).await?;
        let mut size: u64 = 0;

        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|err| ApiError::bad_request(format!("读取上传数据失败: {err}")))?
        {
            file.write_all(&chunk).await?;
            size += chunk.len() as u64;
        }
        file.flush().await?;

        let rel = join_rel(&current_path, &filename);
        state.logs.add(&ip, "upload", rel, Some(size), None);
        uploaded.push((filename, size));
    }

    Ok(Json(json!({
        "success": true,
        "count": uploaded.len(),
        "files": uploaded
            .iter()
            .map(|(name, size)| json!({ "name": name, "size": size }))
            .collect::<Vec<_>>(),
    })))
}

/* ============================ Share ============================ */

#[derive(Deserialize)]
struct ShareBody {
    #[serde(rename = "filePath")]
    file_path: String,
}

async fn create_share(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ShareBody>,
) -> Result<Json<Value>, ApiError> {
    ensure_feature(&state, "share", "分享").await?;
    let rel = normalize_rel(&body.file_path);
    if rel.is_empty() {
        return Err(ApiError::bad_request("参数不完整"));
    }

    let full = resolve_path(&state.storage_path().await, &rel)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|_| ApiError::not_found("文件不存在"))?;
    if meta.is_dir() {
        return Err(ApiError::bad_request("只能分享文件"));
    }

    let token = nanoid::nanoid!(12);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    {
        let mut shares = state
            .shares
            .lock()
            .map_err(|_| ApiError::internal("分享链接状态异常"))?;
        shares.insert(
            token.clone(),
            ShareLink {
                file_path: rel,
                created_at: now,
            },
        );
    }

    let port = state.port().await;
    let addresses = network_addresses(port);
    let primary = addresses
        .first()
        .map(|(_, url)| url.clone())
        .unwrap_or_else(|| format!("http://127.0.0.1:{port}"));

    let urls: Vec<Value> = addresses
        .iter()
        .map(|(label, url)| {
            json!({
                "label": label,
                "url": format!("{url}/share/{token}")
            })
        })
        .collect();

    Ok(Json(json!({
        "token": token,
        "url": format!("{primary}/share/{token}"),
        "urls": urls,
    })))
}

async fn share_download(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    AxumPath(token): AxumPath<String>,
) -> Result<Response, ApiError> {
    ensure_feature(&state, "share", "分享").await?;
    let share = {
        let shares = state
            .shares
            .lock()
            .map_err(|_| ApiError::internal("分享链接状态异常"))?;
        shares.get(&token).cloned()
    }
    .ok_or_else(|| ApiError::not_found("分享链接无效或已过期"))?;

    let _ = share.created_at;
    let full = resolve_path(&state.storage_path().await, &share.file_path)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|_| ApiError::not_found("文件不存在"))?;
    if meta.is_dir() {
        return Err(ApiError::bad_request("不能下载文件夹"));
    }

    state.logs.add(
        &client_ip(&headers, addr),
        "share-download",
        share.file_path,
        Some(meta.len()),
        None,
    );

    serve_file(
        &full,
        true,
        headers.get(header::RANGE).and_then(|value| value.to_str().ok()),
    )
    .await
}

/* ============================ Download / Preview ============================ */

/// 预览区分参数：局域网页面把带 `?preview=1` 的文件地址交给在线预览服务拉取，
/// 日志里据此记为「预览」而不是「下载」。
#[derive(Deserialize)]
struct DownloadQuery {
    preview: Option<String>,
}

async fn download(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    AxumPath(path): AxumPath<String>,
    Query(query): Query<DownloadQuery>,
) -> Result<Response, ApiError> {
    let rel = normalize_rel(&path);
    if rel.is_empty() {
        return Err(ApiError::bad_request("文件不存在"));
    }

    let full = resolve_path(&state.storage_path().await, &rel)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|_| ApiError::not_found("文件不存在"))?;
    if meta.is_dir() {
        return Err(ApiError::bad_request("不能直接下载文件夹"));
    }

    let log_type = if query.preview.is_some() && state.preview_available().await {
        "preview"
    } else {
        "download"
    };
    state.logs.add(&client_ip(&headers, addr), log_type, rel, Some(meta.len()), None);

    serve_file(
        &full,
        true,
        headers.get(header::RANGE).and_then(|value| value.to_str().ok()),
    )
    .await
}

async fn preview(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    AxumPath(path): AxumPath<String>,
) -> Result<Response, ApiError> {
    // 开关关闭或未配置预览地址时一律不让预览
    if !state.preview_available().await {
        return Err(ApiError::not_found("预览未开启"));
    }

    let rel = normalize_rel(&path);
    if rel.is_empty() {
        return Err(ApiError::bad_request("文件不存在"));
    }

    let full = resolve_path(&state.storage_path().await, &rel)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|_| ApiError::not_found("文件不存在"))?;
    state.logs.add(
        &client_ip(&headers, addr),
        "preview",
        rel,
        Some(meta.len()),
        None,
    );
    serve_file(
        &full,
        false,
        headers.get(header::RANGE).and_then(|value| value.to_str().ok()),
    )
    .await
}

/* ============================ Server info ============================ */

pub async fn server_info_json(state: &AppState) -> Value {
    let storage = state.storage_path().await;
    let preview_base = state.preview_base().await;
    let preview_configured = state.preview_configured().await;
    let preview_enabled = state.preview_switched().await;
    let preview_available = state.preview_available().await;
    let port = state.port().await;
    let addresses: Vec<Value> = network_addresses(port)
        .into_iter()
        .map(|(ip, url)| json!({ "ip": ip, "url": url }))
        .collect();

    json!({
        "port": port,
        "previewBase": preview_base,
        "previewConfigured": preview_configured,
        "previewEnabled": preview_enabled,
        "previewAvailable": preview_available,
        "features": state.features().await,
        "storagePath": storage.to_string_lossy(),
        "localUrl": format!("http://127.0.0.1:{port}"),
        "addresses": addresses,
    })
}

/* ============================ Public config ============================ */

/// 局域网客户端可见的配置：预览是否可用、生效的预览地址、各功能开关。
/// 开关关闭或未配置地址时预览相关字段为「不可用 / 空」，页面据此隐藏预览入口；
/// `features` 决定上传/新建文件夹/删除/移动/重命名/分享按钮是否显示（接口侧同样拒绝）。
/// 存储路径、局域网地址、访问日志等管理信息只通过 Tauri 命令给桌面管理端。
async fn public_config(State(state): State<Arc<AppState>>) -> Json<Value> {
    let available = state.preview_available().await;
    Json(json!({
        "previewAvailable": available,
        "previewBase": if available { state.preview_base().await } else { None },
        "features": state.features().await,
    }))
}

fn env_preview_base() -> Option<String> {
    std::env::var("PREVIEW_SERVICE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

/// 校验并规范化管理端填写的预览地址；空串表示恢复默认。
fn normalize_preview_base(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() > 500 {
        return Err("预览地址过长".to_string());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("预览地址不能包含空格".to_string());
    }

    let lower = trimmed.to_ascii_lowercase();
    let rest = if let Some(rest) = lower.strip_prefix("http://") {
        rest
    } else if let Some(rest) = lower.strip_prefix("https://") {
        rest
    } else {
        return Err("预览地址需要以 http:// 或 https:// 开头".to_string());
    };

    let rest = rest.trim_end_matches('/');
    if rest.is_empty() || rest.starts_with('/') {
        return Err("预览地址缺少主机名".to_string());
    }

    Ok(trimmed.trim_end_matches('/').to_string())
}

async fn deny_storage_path() -> Result<Json<Value>, ApiError> {
    Err(ApiError {
        status: StatusCode::FORBIDDEN,
        message: "存储路径请在本机管理端修改".to_string(),
    })
}

/* ============================ SPA ============================ */

fn asset_response(path: &str) -> Response {
    match Assets::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut response = Response::new(Body::from(content.data.into_owned()));
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(mime.as_ref())
                    .unwrap_or(HeaderValue::from_static("application/octet-stream")),
            );
            response
        }
        None => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    }
}

async fn spa(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    if path.starts_with("api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "接口不存在" })),
        )
            .into_response();
    }

    if path.is_empty() {
        return asset_response("index.html");
    }

    if Assets::get(path).is_some() {
        return asset_response(path);
    }

    // 带扩展名但找不到的静态资源直接 404，其余交给前端路由
    if Path::new(path).extension().is_some() {
        return asset_response(path);
    }

    asset_response("index.html")
}

/* ============================ Router / Start ============================ */

/// 只向局域网客户端暴露「文件访问」相关接口。
/// 管理能力（存储路径、日志、服务信息）走 Tauri 命令，不通过 HTTP 提供。
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/config", get(public_config))
        .route("/api/files", get(list_files))
        .route("/api/search", get(search_files))
        .route("/api/mkdir", post(mkdir))
        .route("/api/files/{*path}", delete(delete_item))
        .route("/api/rename", put(rename))
        .route("/api/move", put(move_item))
        .route(
            "/api/upload",
            post(upload).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
        )
        .route("/api/share", post(create_share))
        .route("/api/storage-path", post(deny_storage_path))
        .route("/share/{token}", get(share_download))
        .route("/files/{*path}", get(download))
        .route("/preview/{*path}", get(preview))
        .fallback(spa)
        .with_state(state)
}

/// HTTP 服务启动参数。配置文件路径与运行时状态一一对应。
pub struct StartOptions {
    pub port: u16,
    pub storage: PathBuf,
    pub log_path: PathBuf,
    pub storage_config_path: PathBuf,
    pub preview_config_path: PathBuf,
    pub features_config_path: PathBuf,
    pub port_config_path: PathBuf,
}

pub async fn start(options: StartOptions) -> Result<Arc<AppState>, String> {
    let StartOptions {
        port,
        storage,
        log_path,
        storage_config_path,
        preview_config_path,
        features_config_path,
        port_config_path,
    } = options;

    let listener = bind_listener(port).await.map_err(|err| {
        format!("HTTP 服务启动失败（端口 {port}）：{err}；可在管理端换一个端口，或关闭占用该端口的程序")
    })?;

    let (port_tx, port_rx) = tokio::sync::watch::channel(port);

    let (preview_base, preview_enabled) = crate::storage::read_preview_config(&preview_config_path);
    let features = crate::storage::read_features(&features_config_path);

    let state = Arc::new(AppState {
        storage: tokio::sync::RwLock::new(storage),
        preview: tokio::sync::RwLock::new(preview_base),
        preview_enabled: tokio::sync::RwLock::new(preview_enabled),
        features: tokio::sync::RwLock::new(features),
        storage_config_path,
        preview_config_path,
        features_config_path,
        port_config_path,
        logs: LogStore::new(log_path),
        shares: Mutex::new(HashMap::new()),
        port: tokio::sync::RwLock::new(port),
        port_tx,
    });

    tokio::spawn(supervise(listener, router(state.clone()), port_rx));

    Ok(state)
}

async fn bind_listener(port: u16) -> std::io::Result<tokio::net::TcpListener> {
    tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await
}

/// 监听任务：管理端切换端口后关闭旧监听、绑定新端口。
/// 新端口若被临时占用，每 2 秒重试，直到成功。
async fn supervise(
    mut listener: tokio::net::TcpListener,
    app: Router,
    mut port_rx: tokio::sync::watch::Receiver<u16>,
) {
    loop {
        let current = *port_rx.borrow_and_update();
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();

        let serve_app = app.clone();
        let mut serving = tokio::spawn(async move {
            axum::serve(
                listener,
                serve_app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                let _ = stop_rx.await;
            })
            .await
        });

        // 等待端口变更（AppState 释放说明进程正在退出）
        let mut target = loop {
            match port_rx.changed().await {
                Ok(()) => {
                    let next = *port_rx.borrow_and_update();
                    if next != current {
                        break next;
                    }
                }
                Err(_) => {
                    serving.abort();
                    return;
                }
            }
        };

        let _ = stop_tx.send(());
        // 给正在传输的请求最多 5 秒收尾，超时后强制断开
        match tokio::time::timeout(std::time::Duration::from_secs(5), &mut serving).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(err))) => eprintln!("HTTP 服务异常退出: {err}"),
            Ok(Err(err)) => eprintln!("HTTP 服务任务异常: {err}"),
            Err(_) => {
                serving.abort();
                let _ = serving.await;
            }
        }

        listener = loop {
            match bind_listener(target).await {
                Ok(next) => {
                    let latest = *port_rx.borrow_and_update();
                    if latest == target {
                        break next;
                    }
                    // 绑定期间端口又被修改：丢弃这次结果，改绑最新端口
                    drop(next);
                    target = latest;
                }
                Err(err) => {
                    eprintln!("端口 {target} 暂不可用（{err}），2 秒后重试");
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
                        changed = port_rx.changed() => {
                            if changed.is_ok() {
                                target = *port_rx.borrow_and_update();
                            }
                        }
                    }
                }
            }
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state(base: &Path) -> AppState {
        let (port_tx, _port_rx) = tokio::sync::watch::channel(DEFAULT_PORT);
        AppState {
            storage: tokio::sync::RwLock::new(base.to_path_buf()),
            preview: tokio::sync::RwLock::new(String::new()),
            preview_enabled: tokio::sync::RwLock::new(false),
            features: tokio::sync::RwLock::new(Features::default()),
            storage_config_path: base.join("storage-config.json"),
            preview_config_path: base.join("preview-config.json"),
            features_config_path: base.join("features-config.json"),
            port_config_path: base.join("port-config.json"),
            logs: LogStore::new(base.join("access-log.json")),
            shares: Mutex::new(HashMap::new()),
            port: tokio::sync::RwLock::new(DEFAULT_PORT),
            port_tx,
        }
    }

    #[tokio::test]
    async fn switches_features() {
        let base = std::env::temp_dir().join(format!("lfs-test-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&base).unwrap();
        let state = test_state(&base);

        // 默认全部开启（配置文件不存在也一样）
        for key in crate::storage::FEATURE_KEYS {
            assert!(state.feature_enabled(key).await, "{key} 默认应开启");
        }

        // 逐个关闭并落盘
        for key in crate::storage::FEATURE_KEYS {
            let next = state.set_feature(key, false).await.unwrap();
            assert!(!next.get(key), "{key} 关闭后应为 false");
            assert!(!state.feature_enabled(key).await, "{key} 关闭后应立即生效");
        }
        let saved = std::fs::read_to_string(base.join("features-config.json")).unwrap();
        let parsed: Value = serde_json::from_str(&saved).unwrap();
        for key in crate::storage::FEATURE_KEYS {
            assert_eq!(
                parsed.get(key).and_then(|it| it.as_bool()),
                Some(false),
                "{key} 应写入配置文件"
            );
        }

        // 未知键被拒绝，原有开关不受影响
        assert!(state.set_feature("nope", false).await.is_err());
        assert!(!state.feature_enabled("upload").await);

        // 重新开启
        let next = state.set_feature("delete", true).await.unwrap();
        assert!(next.get("delete"));
        assert!(state.feature_enabled("delete").await);

        // 配置文件只有部分字段时，缺省字段开启
        std::fs::write(base.join("features-config.json"), r#"{ "upload": false }"#).unwrap();
        let partial = crate::storage::read_features(&base.join("features-config.json"));
        assert!(!partial.upload);
        assert!(partial.mkdir && partial.remove && partial.relocate && partial.rename && partial.share);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_path_traversal() {
        let base = PathBuf::from("C:\\data");
        assert!(resolve_path(&base, "..").is_err());
        assert!(resolve_path(&base, "a/../../x").is_err());
        assert!(resolve_path(&base, "a/../b").is_err());
        assert!(resolve_path(&base, "a/b.txt").is_ok());
    }

    #[tokio::test]
    async fn switches_storage_directory() {
        let base = std::env::temp_dir().join(format!("lfs-test-{}", nanoid::nanoid!(8)));
        let first = base.join("first");
        let second = base.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();

        let state = test_state(&first);
        assert_eq!(state.storage_path().await, first);

        state.set_storage(second.clone()).await.unwrap();
        assert_eq!(state.storage_path().await, second);

        let config = std::fs::read_to_string(first.join("storage-config.json")).unwrap();
        assert!(config.contains("second"));

        assert!(state.set_storage(base.join("missing")).await.is_err());
        assert_eq!(state.storage_path().await, second);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn switches_preview_base() {
        let base = std::env::temp_dir().join(format!("lfs-test-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&base).unwrap();
        let state = test_state(&base);

        // 默认：未配置地址、开关关闭，预览不可用
        assert_eq!(state.preview_configured().await, "");
        assert!(!state.preview_switched().await);
        assert!(!state.preview_available().await);

        assert!(state.set_preview_base("ftp://example.com").await.is_err());
        assert!(state
            .set_preview_base("http://")
            .await
            .unwrap_err()
            .contains("主机名"));
        assert!(state.set_preview_base("http://host/a b").await.is_err());

        state
            .set_preview_base(" http://192.168.1.9:8012/ ")
            .await
            .unwrap();
        assert_eq!(state.preview_configured().await, "http://192.168.1.9:8012");
        assert_eq!(
            state.preview_base().await.as_deref(),
            Some("http://192.168.1.9:8012")
        );
        // 只配了地址但开关没开：依然不让预览
        assert!(!state.preview_available().await);

        let saved = std::fs::read_to_string(base.join("preview-config.json")).unwrap();
        assert!(saved.contains("192.168.1.9:8012"));
        assert!(saved.contains("\"enabled\": false"));

        // 打开开关后预览可用
        state.set_preview_enabled(true).await.unwrap();
        assert!(state.preview_switched().await);
        assert!(state.preview_available().await);
        let saved = std::fs::read_to_string(base.join("preview-config.json")).unwrap();
        assert!(saved.contains("\"enabled\": true"));

        // 开着开关但清空地址：不让预览（PREVIEW_SERVICE_URL 存在时除外）
        state.set_preview_base("").await.unwrap();
        assert_eq!(state.preview_configured().await, "");
        assert!(state.preview_switched().await);
        if std::env::var("PREVIEW_SERVICE_URL").is_err() {
            assert_eq!(state.preview_base().await, None);
            assert!(!state.preview_available().await);
        }

        // 开关状态在保存地址时保持不变
        assert!(state.preview_switched().await);

        // 新配置文件缺省 enabled 字段时开关为关闭
        std::fs::write(
            base.join("preview-config.json"),
            r#"{ "previewBase": "http://192.168.1.9:8012" }"#,
        )
        .unwrap();
        let (configured, enabled) = crate::storage::read_preview_config(&base.join("preview-config.json"));
        assert_eq!(configured, "http://192.168.1.9:8012");
        assert!(!enabled);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn switches_port() {
        let base = std::env::temp_dir().join(format!("lfs-test-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&base).unwrap();
        let state = test_state(&base);
        let config = base.join("port-config.json");

        assert_eq!(state.port().await, DEFAULT_PORT);
        assert!(state.set_port(80).await.unwrap_err().contains("1024"));
        assert_eq!(state.port().await, DEFAULT_PORT);

        // 端口被别的程序占用时拒绝切换，且不写配置
        let holder = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let busy = holder.local_addr().unwrap().port();
        assert!(state.set_port(busy).await.unwrap_err().contains("不可用"));
        assert_eq!(state.port().await, DEFAULT_PORT);
        assert!(!config.exists());

        // 空闲端口：切换成功并落盘
        let free = {
            let probe = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
            probe.local_addr().unwrap().port()
        };
        state.set_port(free).await.unwrap();
        assert_eq!(state.port().await, free);
        assert_eq!(crate::storage::read_port(&config, DEFAULT_PORT), free);
        assert_eq!(crate::storage::read_port(&base.join("missing.json"), DEFAULT_PORT), DEFAULT_PORT);

        // 再次设置同一端口直接成功
        drop(holder);
        assert_eq!(state.set_port(free).await, Ok(()));

        // 配置里的非法端口回落到默认值
        std::fs::write(&config, r#"{ "port": 80 }"#).unwrap();
        assert_eq!(crate::storage::read_port(&config, DEFAULT_PORT), DEFAULT_PORT);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn searches_tree() {
        let base = std::env::temp_dir().join(format!("lfs-test-{}", nanoid::nanoid!(8)));
        // 构造目录树：根文件、嵌套文件、同名前缀、文件夹名命中
        std::fs::create_dir_all(base.join("docs/2024")).unwrap();
        std::fs::create_dir_all(base.join("assets/images")).unwrap();
        std::fs::write(base.join("README.md"), "# hi").unwrap();
        std::fs::write(base.join("docs/年度报告.docx"), "x").unwrap();
        std::fs::write(base.join("docs/2024/REPORT-Draft.docx"), "y").unwrap();
        std::fs::write(base.join("assets/logo.png"), "z").unwrap();
        std::fs::create_dir_all(base.join("assets/images/Report Thumbs")).unwrap();

        let state = Arc::new(test_state(&base));

        let run = |q: &str, path: Option<&str>| {
            let state = state.clone();
            let query = SearchQuery {
                q: q.to_string(),
                path: path.map(str::to_string),
            };
            async move { search_files(State(state), Query(query)).await.unwrap().0 }
        };

        // 1) 整个共享目录搜索：文件与文件夹都命中，大小写不敏感
        let root = run("report", None).await;
        assert_eq!(root["query"], "report");
        assert_eq!(root["searchPath"], "");
        assert_eq!(root["truncated"], false);
        let paths: Vec<&str> = root["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|it| it["path"].as_str().unwrap())
            .collect();
        assert!(paths.contains(&"docs/2024/REPORT-Draft.docx"), "{paths:?}");
        assert!(paths.contains(&"assets/images/Report Thumbs"), "{paths:?}");
        assert!(!paths.iter().any(|p| p.ends_with("年度报告.docx")), "report 不应命中年度报告: {paths:?}");

        // 2) 大小写不敏感：DOCX 命中两个 .docx 文件
        let upper = run("DOCX", None).await;
        let count = upper["items"].as_array().unwrap().len();
        assert_eq!(count, 2, "{upper}");

        // 3) 中文关键词 + 只搜子目录
        let scoped = run("年度", Some("docs")).await;
        assert_eq!(scoped["searchPath"], "docs");
        let scoped_paths: Vec<&str> = scoped["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|it| it["path"].as_str().unwrap())
            .collect();
        assert_eq!(scoped_paths, vec!["docs/年度报告.docx"]);

        // 4) 无匹配返回空列表，不报错
        let none = run("绝对不存在的关键词xyz", None).await;
        assert!(none["items"].as_array().unwrap().is_empty());

        // 5) 关键词为空 / 目录不存在 / 路径穿越被拒绝
        assert!(search_files(
            State(state.clone()),
            Query(SearchQuery { q: "  ".into(), path: None })
        )
        .await
        .is_err());
        assert!(search_files(
            State(state.clone()),
            Query(SearchQuery { q: "a".into(), path: Some("missing-dir".into()) })
        )
        .await
        .is_err());
        assert!(search_files(
            State(state.clone()),
            Query(SearchQuery { q: "a".into(), path: Some("..".into()) })
        )
        .await
        .is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}

