mod logs;
mod server;
mod storage;

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/* ============================ 管理端命令 ============================
 * 桌面窗口只做“服务端管理”：存储目录、访问日志、运行状态。
 * 文件浏览/上传/下载由局域网 HTTP 页面负责。
 */

#[tauri::command]
async fn storage_path(state: tauri::State<'_, Arc<server::AppState>>) -> Result<String, String> {
    Ok(state
        .inner()
        .storage_path()
        .await
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
async fn set_storage_path(
    state: tauri::State<'_, Arc<server::AppState>>,
    path: String,
) -> Result<String, String> {
    state.inner().set_storage(PathBuf::from(path)).await?;
    Ok(state
        .inner()
        .storage_path()
        .await
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
async fn access_logs(
    state: tauri::State<'_, Arc<server::AppState>>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Value, String> {
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let offset = offset.unwrap_or(0);
    let (total, items) = state.inner().logs.page(limit, offset);
    Ok(json!({ "total": total, "items": items }))
}

#[tauri::command]
async fn server_info(state: tauri::State<'_, Arc<server::AppState>>) -> Result<Value, String> {
    Ok(server::server_info_json(state.inner().as_ref()).await)
}

#[tauri::command]
async fn set_preview_base(
    state: tauri::State<'_, Arc<server::AppState>>,
    preview_base: String,
) -> Result<Value, String> {
    state.inner().set_preview_base(&preview_base).await?;
    let info = state.inner();
    Ok(json!({
        "previewBase": info.preview_base().await,
        "previewConfigured": info.preview_configured().await,
        "previewEnabled": info.preview_switched().await,
        "previewAvailable": info.preview_available().await,
    }))
}

#[tauri::command]
async fn set_preview_enabled(
    state: tauri::State<'_, Arc<server::AppState>>,
    enabled: bool,
) -> Result<Value, String> {
    state.inner().set_preview_enabled(enabled).await?;
    let info = state.inner();
    Ok(json!({
        "previewBase": info.preview_base().await,
        "previewConfigured": info.preview_configured().await,
        "previewEnabled": info.preview_switched().await,
        "previewAvailable": info.preview_available().await,
    }))
}

#[tauri::command]
async fn clear_logs(state: tauri::State<'_, Arc<server::AppState>>) -> Result<usize, String> {
    Ok(state.inner().logs.clear())
}

/// 切换单个功能开关（upload / mkdir / delete / move / rename / share），
/// 返回开关后的完整状态；局域网页面刷新后隐藏对应入口，HTTP 接口同步返回 403。
#[tauri::command]
async fn set_feature(
    state: tauri::State<'_, Arc<server::AppState>>,
    key: String,
    enabled: bool,
) -> Result<Value, String> {
    let features = state.inner().set_feature(&key, enabled).await?;
    Ok(serde_json::to_value(features).map_err(|err| err.to_string())?)
}

#[tauri::command]
async fn set_port(state: tauri::State<'_, Arc<server::AppState>>, port: u16) -> Result<u16, String> {
    state.inner().set_port(port).await?;
    Ok(state.inner().port().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            storage_path,
            set_storage_path,
            access_logs,
            server_info,
            set_preview_base,
            set_preview_enabled,
            set_feature,
            clear_logs,
            set_port
        ])
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|err| -> Box<dyn std::error::Error> { err.into() })?;

            let init = (|| -> Result<Arc<server::AppState>, String> {
                let storage = storage::init_storage(&data_dir)?;
                let log_path = storage::migrate_legacy_log(&data_dir);
                let port_config_path = storage::port_config_path(&data_dir);
                let port = storage::read_port(&port_config_path, server::DEFAULT_PORT);
                tauri::async_runtime::block_on(server::start(server::StartOptions {
                    port,
                    storage,
                    log_path,
                    storage_config_path: data_dir.join("storage-config.json"),
                    preview_config_path: storage::preview_config_path(&data_dir),
                    features_config_path: storage::features_config_path(&data_dir),
                    port_config_path,
                }))
            })();

            match init {
                Ok(state) => {
                    app.manage(state);
                }
                Err(message) => {
                    app.dialog()
                        .message(&message)
                        .title("局域网文件分享启动失败")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    return Err(message.into());
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
