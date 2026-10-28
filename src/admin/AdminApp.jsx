import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, ask } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  FaCheck, FaCopy, FaDownload, FaExchangeAlt, FaExternalLinkAlt, FaEye,
  FaFolderOpen, FaFolderPlus, FaMoon, FaPen, FaServer, FaShareAlt, FaSyncAlt,
  FaSun, FaTrashAlt, FaUpload,
} from 'react-icons/fa';
import { currentTheme, toggleTheme } from '../theme';

const TYPE_CONFIG = {
  download: { label: '下载', Icon: FaDownload, color: '#34d399' },
  preview: { label: '预览', Icon: FaEye, color: '#22d3ee' },
  upload: { label: '上传', Icon: FaUpload, color: '#60a5fa' },
  'share-download': { label: '分享下载', Icon: FaShareAlt, color: '#a78bfa' },
  delete: { label: '删除', Icon: FaTrashAlt, color: '#f87171' },
  rename: { label: '重命名', Icon: FaPen, color: '#fbbf24' },
  mkdir: { label: '新建文件夹', Icon: FaFolderPlus, color: '#f472b6' },
  move: { label: '移动', Icon: FaExchangeAlt, color: '#fb923c' },
};

const LOG_LIMIT = 60;
const DEFAULT_PORT = 8081;

// 可在管理端逐个开关的局域网页面功能（键名与后端 features-config.json 一致）
const FEATURE_ITEMS = [
  { key: 'upload', label: '上传文件' },
  { key: 'mkdir', label: '新建文件夹' },
  { key: 'delete', label: '删除' },
  { key: 'move', label: '移动' },
  { key: 'rename', label: '编辑（重命名）' },
  { key: 'share', label: '分享' },
];

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // WebView 里偶尔没有剪贴板权限，退回 execCommand
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function AdminApp() {
  const [info, setInfo] = useState(null);
  const [storagePath, setStoragePath] = useState('');
  const [logs, setLogs] = useState({ total: 0, items: [] });
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [previewInput, setPreviewInput] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [portInput, setPortInput] = useState(String(DEFAULT_PORT));
  const [portBusy, setPortBusy] = useState(false);
  const [featureBusy, setFeatureBusy] = useState('');
  const [theme, setTheme] = useState(currentTheme);

  const toastTimer = useRef(null);
  const previewDirty = useRef(false);
  const portDirty = useRef(false);

  const notify = useCallback((message) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const data = await invoke('server_info');
      setInfo(data);
      if (!previewDirty.current) {
        setPreviewInput(data.previewConfigured ?? '');
      }
      if (!portDirty.current && data.port) {
        setPortInput(String(data.port));
      }
      setError('');
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const path = await invoke('storage_path');
      setStoragePath(path);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const loadLogs = useCallback(async (silent = true) => {
    if (!silent) setLogsLoading(true);
    try {
      const data = await invoke('access_logs', { limit: LOG_LIMIT, offset: 0 });
      setLogs({ total: data.total ?? 0, items: data.items ?? [] });
    } catch (err) {
      if (!silent) setError(String(err));
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInfo();
    loadStorage();
    loadLogs(false);

    const logTimer = setInterval(() => loadLogs(true), 5000);
    const infoTimer = setInterval(() => {
      loadInfo();
      loadStorage();
    }, 15000);
    return () => {
      clearInterval(logTimer);
      clearInterval(infoTimer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [loadInfo, loadStorage, loadLogs]);

  const addresses = useMemo(() => info?.addresses ?? [], [info]);
  const previewEnabled = Boolean(info?.previewEnabled);
  const previewAvailable = Boolean(info?.previewAvailable);
  const previewAddress = info?.previewBase || '';
  // 功能开关状态：配置未加载时按默认（全部开启）
  const features = useMemo(
    () => ({
      upload: true,
      mkdir: true,
      delete: true,
      move: true,
      rename: true,
      share: true,
      ...(info?.features ?? {}),
    }),
    [info]
  );

  const handleCopy = async (url) => {
    const ok = await copyText(url);
    if (ok) {
      setCopiedUrl(url);
      notify('地址已复制');
      setTimeout(() => setCopiedUrl(''), 1800);
    } else {
      notify('复制失败，请手动选择地址');
    }
  };

  const handleOpen = async (url) => {
    try {
      await openUrl(url);
    } catch {
      notify('无法打开浏览器');
    }
  };

  const handlePickFolder = async () => {
    if (busy) return;
    let picked;
    try {
      picked = await open({
        title: '选择存储文件夹',
        directory: true,
        multiple: false,
        defaultPath: storagePath || undefined,
      });
    } catch (err) {
      notify('打开文件夹选择框失败');
      return;
    }
    if (!picked || Array.isArray(picked)) return;

    setBusy(true);
    try {
      const next = await invoke('set_storage_path', { path: picked });
      setStoragePath(next);
      notify('存储文件夹已更新');
      await loadInfo();
      await loadLogs(true);
    } catch (err) {
      notify(`切换失败：${err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSavePreview = async (value) => {
    if (previewBusy) return;
    setPreviewBusy(true);
    try {
      const next = await invoke('set_preview_base', { previewBase: value });
      previewDirty.current = false;
      setPreviewInput(next.previewConfigured ?? '');
      notify(next.previewConfigured ? '预览地址已保存' : '预览地址已清空');
      await loadInfo();
    } catch (err) {
      notify(`保存失败：${err}`);
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleTogglePreview = async () => {
    if (previewBusy) return;
    setPreviewBusy(true);
    try {
      const next = await invoke('set_preview_enabled', { enabled: !previewEnabled });
      notify(
        next.previewEnabled
          ? next.previewAvailable
            ? '预览已开启'
            : '预览开关已打开，但尚未配置预览地址，客户端仍不显示预览'
          : '预览已关闭，客户端不再显示预览入口'
      );
      await loadInfo();
    } catch (err) {
      notify(`切换失败：${err}`);
    } finally {
      setPreviewBusy(false);
    }
  };

  /** 切换单个功能开关：局域网页面刷新后隐藏入口，HTTP 接口同步拒绝。 */
  const handleToggleFeature = async (key, label) => {
    if (featureBusy) return;
    const enabled = !features[key];
    setFeatureBusy(key);
    try {
      const next = await invoke('set_feature', { key, enabled });
      setInfo((prev) => ({ ...(prev ?? {}), features: next }));
      notify(enabled ? `${label}已开启` : `${label}已关闭，局域网页面刷新后不再显示该入口`);
      await loadInfo();
    } catch (err) {
      notify(`切换失败：${err}`);
    } finally {
      setFeatureBusy('');
    }
  };

  const handleSavePort = async (value) => {
    if (portBusy) return;
    const raw = String(value).trim();
    const port = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1024 || port > 65535) {
      notify('端口需为 1024–65535 之间的整数');
      return;
    }
    if (port === info?.port) {
      notify('端口未变化');
      return;
    }

    setPortBusy(true);
    try {
      const next = await invoke('set_port', { port });
      portDirty.current = false;
      setPortInput(String(next));
      notify(`端口已切换为 ${next}，请使用新地址访问`);
      await loadInfo();
      await loadLogs(true);
    } catch (err) {
      notify(`切换失败：${err}`);
    } finally {
      setPortBusy(false);
    }
  };

  const handleClearLogs = async () => {
    if (clearing || logs.total === 0) return;
    let confirmed = false;
    try {
      confirmed = await ask(`确定清除全部 ${logs.total} 条访问日志？此操作不可撤销。`, {
        title: '清除访问日志',
        kind: 'warning',
      });
    } catch {
      confirmed = false;
    }
    if (!confirmed) return;

    setClearing(true);
    try {
      const removed = await invoke('clear_logs');
      notify(`已清除 ${removed} 条日志`);
      await loadLogs(true);
    } catch (err) {
      notify(`清除失败：${err}`);
    } finally {
      setClearing(false);
    }
  };

  const lastUpdate = logs.items[0]?.time;

  return (
    <div className="admin">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-logo"><FaServer size={16} /></span>
          <div>
            <h1>局域网文件分享</h1>
            <span className="admin-subtitle">服务端管理端</span>
          </div>
        </div>
        <div className="admin-header-right">
          <div className="admin-status">
            <span className="status-dot" />
            服务运行中
            {info?.port && <span className="status-port">端口 {info.port}</span>}
          </div>
          <button
            type="button"
            className="btn-icon theme-btn"
            aria-label={theme === 'light' ? '切换为深色主题' : '切换为浅色主题'}
            title={theme === 'light' ? '切换为深色主题' : '切换为浅色主题'}
            onClick={() => setTheme(toggleTheme())}
          >
            {theme === 'light' ? <FaMoon size={13} /> : <FaSun size={14} />}
          </button>
        </div>
      </header>

      {error && <div className="admin-banner error">{error}</div>}

      <main className="admin-main">
        <section className="card">
          <div className="card-head">
            <h2>局域网访问地址</h2>
            <span className="card-hint">浏览器打开即可浏览、上传、下载文件</span>
          </div>

          <div className="storage-row port-row">
            <span className="port-label">客户端端口</span>
            <input
              className="text-input port-input"
              value={portInput}
              inputMode="numeric"
              maxLength={5}
              spellCheck={false}
              onChange={(event) => {
                portDirty.current = true;
                setPortInput(event.target.value.replace(/\D/g, ''));
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSavePort(portInput);
              }}
            />
            <button
              className="btn btn-primary"
              onClick={() => handleSavePort(portInput)}
              disabled={portBusy}
            >
              {portBusy ? '切换中…' : '保存'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => handleSavePort(DEFAULT_PORT)}
              disabled={portBusy}
            >
              恢复默认
            </button>
          </div>
          <p className="card-hint block port-hint">
            修改后服务立即在新端口重新监听，旧地址会失效并需要重新分享链接；新端口首次使用时 Windows 防火墙可能再次询问，请允许「专用网络」。
          </p>

          {addresses.length === 0 ? (
            <div className="empty-line">未检测到局域网地址，请检查网络连接</div>
          ) : (
            <ul className="address-list">
              {addresses.map((entry) => (
                <li key={entry.url} className="address-item">
                  <span className="address-ip">{entry.ip}</span>
                  <code className="address-url">{entry.url}</code>
                  <div className="address-actions">
                    <button className="btn-icon" title="复制地址" onClick={() => handleCopy(entry.url)}>
                      {copiedUrl === entry.url ? <FaCheck size={12} /> : <FaCopy size={12} />}
                    </button>
                    <button className="btn-icon" title="在浏览器中打开" onClick={() => handleOpen(entry.url)}>
                      <FaExternalLinkAlt size={12} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>存储文件夹</h2>
            <span className="card-hint">对外提供的文件都来自这个目录</span>
          </div>
          <div className="storage-row">
            <code className="storage-path" title={storagePath}>{storagePath || '读取中…'}</code>
            <button className="btn btn-primary" onClick={handlePickFolder} disabled={busy}>
              <FaFolderOpen size={12} />
              {busy ? '切换中…' : '更改文件夹'}
            </button>
          </div>
          <p className="card-hint block">修改后立即生效，无需重启服务；局域网页面刷新就能看到新目录的内容。</p>
        </section>

        <section className="card preview-card">
          <div className="card-head">
            <h2>在线预览服务</h2>
            <span className="card-hint">kkFileView 等预览服务的访问地址</span>
          </div>

          <div className="storage-row preview-toggle-row">
            <span className="port-label">预览按钮</span>
            <button
              type="button"
              role="switch"
              aria-checked={previewEnabled}
              className={`switch ${previewEnabled ? 'on' : ''}`}
              onClick={handleTogglePreview}
              disabled={previewBusy}
            >
              <span className="switch-knob" />
            </button>
            <span className="card-hint">
              {previewEnabled ? '已开启' : '已关闭（默认）'}
            </span>
            {previewEnabled && !previewAvailable && (
              <span className="card-hint warn">未配置预览地址，客户端暂不显示预览</span>
            )}
          </div>

          <div className="storage-row">
            <input
              className="text-input"
              value={previewInput}
              placeholder="http://192.168.1.10:8012"
              spellCheck={false}
              onChange={(event) => {
                previewDirty.current = true;
                setPreviewInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSavePreview(previewInput.trim());
              }}
            />
            <button
              className="btn btn-primary"
              onClick={() => handleSavePreview(previewInput.trim())}
              disabled={previewBusy}
            >
              {previewBusy ? '保存中…' : '保存'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => handleSavePreview('')}
              disabled={previewBusy}
            >
              清空地址
            </button>
          </div>
          <p className="card-hint block">
            不提供默认预览地址：需填写局域网内可访问的预览服务地址；当前生效：
            <code className="inline-code">{previewAddress || '未配置'}</code>
            。开关开启且配置地址后，局域网页面刷新才会显示预览按钮。
          </p>
        </section>

        <section className="card features-card">
          <div className="card-head">
            <h2>功能开关</h2>
            <span className="card-hint">控制局域网页面可用的操作</span>
          </div>

          <div className="feature-grid">
            {FEATURE_ITEMS.map(({ key, label }) => {
              const enabled = Boolean(features[key]);
              return (
                <div className="feature-item" key={key}>
                  <span className="feature-label">{label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    title={`${label}：${enabled ? '已开启' : '已关闭'}`}
                    className={`switch ${enabled ? 'on' : ''}`}
                    disabled={featureBusy === key}
                    onClick={() => handleToggleFeature(key, label)}
                  >
                    <span className="switch-knob" />
                  </button>
                </div>
              );
            })}
          </div>

          <p className="card-hint block">
            关闭后局域网页面隐藏对应按钮（右键菜单同步隐藏），直接调用 HTTP 接口也会返回 403；
            下载和预览不受这些开关影响。
          </p>
        </section>

        <section className="card logs-card">
          <div className="card-head">
            <h2>访问日志</h2>
            <div className="logs-actions">
              <span className="card-hint">共 {logs.total} 条</span>
              <button
                className="btn btn-ghost danger"
                onClick={handleClearLogs}
                disabled={clearing || logs.total === 0}
              >
                <FaTrashAlt size={11} />
                {clearing ? '清除中…' : '清除'}
              </button>
              <button
                className={`btn btn-ghost ${logsLoading ? 'loading' : ''}`}
                onClick={() => loadLogs(false)}
              >
                <FaSyncAlt size={11} className={logsLoading ? 'spinning' : ''} />
                刷新
              </button>
            </div>
          </div>

          <div className="log-table">
            <div className="log-row log-head">
              <span>类型</span>
              <span>文件</span>
              <span>大小</span>
              <span>客户端</span>
              <span>时间</span>
            </div>

            {logs.items.length === 0 ? (
              <div className="empty-line">暂无访问记录</div>
            ) : (
              logs.items.map((log) => {
                const cfg = TYPE_CONFIG[log.type] || {
                  label: log.type, Icon: FaDownload, color: '#94a3b8',
                };
                const { Icon } = cfg;
                return (
                  <div className="log-row" key={log.id}>
                    <span className="log-type" style={{ color: cfg.color }}>
                      <Icon size={10} />
                      {cfg.label}
                    </span>
                    <span className="log-file" title={log.file}>{log.file}</span>
                    <span className="log-size">{formatSize(log.size)}</span>
                    <span className="log-ip">{log.ip}</span>
                    <span className="log-time">{formatTime(log.time)}</span>
                  </div>
                );
              })
            )}
          </div>

          {lastUpdate && (
            <div className="logs-footer">最新记录 {formatTime(lastUpdate)} · 每 5 秒自动刷新</div>
          )}
        </section>
      </main>

      {toast && <div className="admin-toast">{toast}</div>}
    </div>
  );
}
