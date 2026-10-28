use std::fs;
use std::path::Path;

fn main() {
    ensure_frontend("dist", "index.html");
    ensure_frontend("dist-admin", "admin.html");
    tauri_build::build()
}

/// rust-embed 与 Tauri 在编译期需要前端产物存在。
/// 首次 clone 后直接 `cargo check` / `tauri dev`（还没执行过 vite build）时，
/// 生成一个占位页面，避免编译失败；正式构建会由 npm run build 覆盖。
fn ensure_frontend(dir: &str, entry: &str) {
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(dir);
    if dist.join(entry).exists() {
        return;
    }

    let _ = fs::create_dir_all(&dist);
    let _ = fs::write(
        dist.join(entry),
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>LanFileShare</title></head><body style=\"font-family:sans-serif;padding:32px\"><h1>LanFileShare</h1><p>前端资源尚未构建，请先运行 <code>npm run build</code>。</p></body></html>",
    );
}
