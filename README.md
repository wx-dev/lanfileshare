# 局域网文件分享（Tauri 2 桌面服务端）

原项目从「Node + Express + 浏览器页面」改造为：

- **Tauri 2 桌面窗口 = 服务端管理端**：只负责配置存储文件夹、查看访问日志、显示/复制局域网地址，不再提供文件管理界面
- **独立 HTTP 端口对外提供文件访问页**：默认 `0.0.0.0:8081`，局域网设备用浏览器打开 `http://<本机局域网 IP>:8081` 即可浏览、上传、下载、分享文件
- **Rust + axum 内嵌 HTTP 服务**：不再依赖 Node 运行时；服务只在 exe 运行时存在，关闭窗口即停止
- **分享功能继续走 HTTP**：分享链接形如 `http://192.168.x.x:8081/share/<token>`，局域网设备直接下载
- **深色 / 浅色主题**：文件访问页与管理端右上角 ☀/☾ 一键切换，首次打开跟随系统深浅色，手动切换后记住
- **文件搜索**：文件访问页顶部按名称搜索文件与文件夹（大小写不敏感），范围可选整个共享目录 / 当前文件夹 / 自定义文件夹

## 架构

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Tauri 2 窗口（管理端）          │        │ 局域网浏览器 / 手机            │
│  React UI = dist-admin 资源    │        │  文件访问页 = dist 资源        │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │ invoke（Tauri IPC）                    │ HTTP
┌──────────────▼───────────────────────────────────────▼───────────────┐
│ Rust 服务进程                                                          │
│  ├─ Tauri 命令：storage_path / set_storage_path / access_logs /        │
│  │                server_info / set_port / set_preview_base /         │
│  │                set_preview_enabled / set_feature                   │
│  └─ axum HTTP 服务 0.0.0.0:8081                                       │
│       ├─ /            文件访问页（内嵌 dist）                          │
│       ├─ /assets/*    页面静态资源                                     │
│       ├─ /api/*       文件列表/搜索/上传/删除/重命名/移动/分享（仅文件访问） │
│       ├─ /files/*     下载（支持 Range）                               │
│       ├─ /preview/*   内联预览（支持 Range）                           │
│       └─ /share/:token 分享下载                                        │
└───────────────────────────────────────────────────────────────────────┘
```

两个前端入口完全独立：

| 入口 | 源文件 | 构建产物 | 去向 |
| --- | --- | --- | --- |
| 文件访问页 | `index.html` + `src/` | `dist/` | 由 `rust-embed` 编译进 exe，通过 `http://<IP>:8081/` 提供 |
| 管理端 | `admin.html` + `src/admin/` | `dist-admin/` | 只作为 Tauri 窗口资源，不进 HTTP 服务（`/admin.html` 返回 404） |

管理端不经过 HTTP，直接调用 Rust 命令：

| 命令 | 说明 |
| --- | --- |
| `storage_path` | 读取当前存储文件夹 |
| `set_storage_path` | 切换存储文件夹（校验目录存在 → 写配置 → 立即生效） |
| `access_logs` | 分页读取访问日志 |
| `clear_logs` | 清空全部访问日志（返回清除条数） |
| `server_info` | 端口、局域网地址、存储路径、预览地址与开关状态（`previewEnabled` / `previewAvailable`）、功能开关（`features`） |
| `set_port` | 切换局域网 HTTP 端口（校验范围与占用 → 写 `port-config.json` → 监听任务切到新端口） |
| `set_preview_base` | 设置在线预览服务地址（空串清空地址；**不提供默认预览地址**） |
| `set_preview_enabled` | 开关局域网页面的预览按钮（默认关闭；开关开启但未配置地址时仍不提供预览） |
| `set_feature` | 开关单个功能（`upload` / `mkdir` / `delete` / `move` / `rename` / `share`，默认全开），返回开关后的完整状态 |

## 开发

前置要求：

- Node.js 18+
- Rust stable（MSVC 工具链）
- Visual Studio C++ Build Tools
- WebView2 Runtime（Windows 10/11 一般已自带）

```bash
npm install
npm run dev          # 启动 Vite + Tauri 管理端窗口
```

只调试界面：

```bash
npm run dev:web      # 文件访问页，http://localhost:1420，/api 代理到 127.0.0.1:8081（改端口后需同步 vite 代理）
```

## 构建

```bash
npm run build        # 构建两个前端入口（dist + dist-admin）
npm run build:desktop   # 前端 + Rust release + MSI/NSIS 安装包
```

也可以单独构建：

```bash
npm run build:lan     # 只构建文件访问页（dist）
npm run build:admin   # 只构建管理端（dist-admin）
```

产物：

| 文件 | 说明 |
| --- | --- |
| `src-tauri/target/release/lanfileshare.exe` | 独立可执行文件，两个前端都已内嵌，双击即用 |
| `src-tauri/target/release/bundle/msi/LanFileShare_1.0.0_x64_zh-CN.msi` | MSI 安装包（简体中文） |
| `src-tauri/target/release/bundle/nsis/LanFileShare_1.0.0_x64-setup.exe` | NSIS 安装程序（简体中文） |

只编译 exe、不生成安装包：

```bash
npx tauri build --no-bundle
```

> 安装包构建时 Tauri 会从 GitHub 下载 WiX（MSI）和 NSIS 工具链，缓存到 `%LOCALAPPDATA%\tauri\`，
> 之后离线也能打包。网络不通会报 `failed to bundle project: timeout`，此时直接分发 `lanfileshare.exe` 即可，功能完全一致。

## 使用

1. 双击 `lanfileshare.exe`，桌面窗口就是服务端管理端
2. 「局域网访问地址」显示本机 IP 与访问地址，可复制或直接在浏览器打开；同卡片里的「客户端端口」可修改 HTTP 端口
3. 把要共享的文件放进「存储文件夹」，点「更改文件夹」可随时换成别的目录，**改完立即生效**，局域网页面刷新即可看到新内容
4. 局域网设备打开 `http://<本机 IP>:<端口>`（默认 8081），在文件访问页里上传、下载、分享
5. 文件访问页顶部的搜索框按名称搜索文件与文件夹（大小写不敏感）：右侧下拉选择范围——**整个共享目录 / 当前文件夹 / 自定义文件夹**，选「自定义文件夹」时点「更改」打开目录选择器（面包屑跳转、列表进入子文件夹、「返回上级」逐级回退、「选择此文件夹」确认）；输入停顿 300 毫秒自动搜索，按回车立即搜索，清空或按 Esc 退出搜索模式；结果列表显示每个结果所在的父目录，点结果（或「打开」按钮）直接进入对应文件夹并退出搜索，点父目录路径可打开所在文件夹
6. 「在线预览服务」先把「预览按钮」开关打开，再填 kkFileView 的地址（如 `http://192.168.1.5:8012`）保存；**开关与地址缺一不可**：默认开关关闭、也没有默认预览地址，两者都配好后局域网页面刷新才会显示预览按钮
7. 「功能开关」卡片可逐个关掉 **上传文件 / 新建文件夹 / 删除 / 移动 / 编辑（重命名）/ 分享**，默认全部开启；关闭后局域网页面隐藏对应按钮（右键菜单同步隐藏，搜索结果行同样隐藏），直接调接口也会返回 `403`，下载与预览不受影响
8. 「深色 / 浅色主题」：文件访问页与管理端右上角都有 ☀/☾ 按钮，点击即可切换；**首次打开跟随系统深浅色**，手动切换后会被记住（用户端按浏览器/设备各自记忆，管理端按本机记忆）
9. 访问日志每 5 秒自动刷新，可以看到谁在什么时候预览/下载/上传/删除了什么；点「清除」可一键清空（会二次确认）
10. 关闭窗口即停止 HTTP 服务，局域网页面随之不可访问

> 首次启动如弹出 Windows 防火墙提示，请允许「专用网络」访问，否则局域网设备无法连接。
> 端口被占用时可以在管理端换一个（1024–65535），保存后服务立即在新端口重新监听；更换端口后旧地址和已发出的分享链接会失效。

## 配置

| 项目 | 说明 |
| --- | --- |
| 存储目录 | 首次启动写入 `%APPDATA%\com.lanfileshare.desktop\storage-config.json`；默认 `E:\lanshare`（E 盘不存在时使用 `%USERPROFILE%\lanshare`） |
| 存储目录修改 | 只能在桌面管理端改；HTTP `POST /api/storage-path` 固定返回 `403` |
| 存储目录覆盖 | 环境变量 `LANFILESHARE_STORAGE`（首次启动时生效） |
| 访问日志 | `%APPDATA%\com.lanfileshare.desktop\access-log.json`，最多 500 条 |
| HTTP 端口 | 默认 `8081`，可在管理端修改（1024–65535），保存在 `%APPDATA%\com.lanfileshare.desktop\port-config.json`，保存后立即生效 |
| 在线预览服务 | 开关 + 地址保存在 `%APPDATA%\com.lanfileshare.desktop\preview-config.json`（`{ previewBase, enabled }`）；`enabled` 默认 `false`（预览按钮关闭），`previewBase` 默认为空（**不提供默认预览地址**，也不会回退到 `http://<本机 IP>:8012`）；管理端未配置地址时可回退到环境变量 `PREVIEW_SERVICE_URL` |
| 功能开关 | 上传 / 新建文件夹 / 删除 / 移动 / 重命名 / 分享，保存在 `%APPDATA%\com.lanfileshare.desktop\features-config.json`（`{ upload, mkdir, delete, move, rename, share }`）；**默认全部开启**，文件缺失或字段缺失时同样按开启处理 |
| 深色 / 浅色主题 | **不进 Rust 配置文件**：两个页面的 `<html data-theme>` 由 `src/theme.js` 维护；首次打开跟随系统（`prefers-color-scheme`），点右上角 ☀/☾ 切换后写入 `localStorage` 键 `lanfileshare-theme`（用户端按浏览器/设备各自记忆，管理端按本机窗口记忆） |

升级时会尝试读取旧项目目录中的 `storage-config.json` 和 `access-log.json` 并迁移。

## 接口

局域网 HTTP 只提供**文件访问**相关接口（`http://<IP>:<端口>`，端口默认 8081）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 文件访问页 |
| GET | `/api/config` | 客户端可见配置：预览可用性（`previewAvailable` / `previewBase`，开关关闭或未配置地址时为 `false` / `null`）与功能开关 `features` |
| GET | `/api/files?path=` | 目录列表 |
| GET | `/api/search?q=&path=` | 按名称搜索文件与文件夹（大小写不敏感，含子目录，跳过符号链接；`path` 为空表示整个共享目录；关键词必填且 ≤128 字符；结果上限 200 条，超出时 `truncated` 为 `true`；目录不存在 `404`） |
| POST | `/api/mkdir` | 新建文件夹（`mkdir` 关闭时 `403`） |
| DELETE | `/api/files/*` | 删除文件/文件夹（`delete` 关闭时 `403`） |
| PUT | `/api/rename` | 重命名（`rename` 关闭时 `403`） |
| PUT | `/api/move` | 移动（`move` 关闭时 `403`） |
| POST | `/api/upload` | 上传（multipart，最大 2GB；`upload` 关闭时 `403`） |
| POST | `/api/share` | 创建分享链接（`share` 关闭时 `403`） |
| GET | `/files/*` | 下载（支持 Range）；带 `?preview=1` 且预览可用时日志记为「预览」，否则记「下载」 |
| GET | `/preview/*` | 内联预览（支持 Range，日志记为「预览」）；预览开关关闭或未配置地址时返回 `404 {"error":"预览未开启"}` |
| GET | `/share/:token` | 分享下载（`share` 关闭时 `403`，已发出的链接同样不可用） |

被功能开关关闭的接口统一返回 `403 {"error":"「<功能名>」功能已在管理端关闭"}`，因此**隐藏按钮之外，直接调接口也无法绕过**；下载 `/files/*` 与预览 `/preview/*` 只受预览开关控制。搜索 `/api/search` 是只读接口：不受功能开关控制，也不记入访问日志。

不通过 HTTP 提供的管理能力：

| 路径 | 结果 |
| --- | --- |
| `GET /api/logs` | 404（访问日志只在桌面窗口查看） |
| `GET /api/server-info` | 404（局域网地址只在桌面窗口显示） |
| `GET /api/storage-path` | 405（不提供读取） |
| `POST /api/storage-path` | 403（只能在桌面管理端修改） |
| 其他 `/api/*` | 404 JSON |
| `/admin.html` 及其资源 | 404 |

HTTP 服务不发送 CORS 头，跨站页面无法代替用户调用这些接口。

## 旧版 Node 服务

已移除：`server/` 目录及其依赖（express / cors / multer / nanoid / open）全部删除，项目不再包含任何 Node 服务端代码。

## 常见问题

**编译报错 `os error 4551 / 应用程序控制策略已阻止此文件`，或双击 exe 提示「已被组织策略阻止」**

Windows 11 的智能应用控制（Smart App Control）会拦截未签名的 Rust 编译产物。

1. 设置 → 隐私和安全性 → Windows 安全中心 → 应用和浏览器控制 → 智能应用控制 → 关闭
2. **重启电脑**（注册表 `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState = 0` 只在开机时加载，不重启仍会拦截）
3. 重启后可用 `Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy'` 确认状态为 0，并查看事件日志 `Microsoft-Windows-CodeIntegrity/Operational` 是否还有 3118 拦截记录

关闭后如需重新开启，只能重装 Windows。
