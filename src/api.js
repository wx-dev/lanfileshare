// 局域网文件访问页：页面和接口同源，直接请求当前地址即可
const BASE = '';

// 客户端需要的配置：预览是否可用、生效的预览地址、各功能开关
// （管理端关闭的功能既不显示入口，HTTP 接口也会返回 403）
export const DEFAULT_FEATURES = {
  upload: true,
  mkdir: true,
  delete: true,
  move: true,
  rename: true,
  share: true,
};

const config = {
  previewAvailable: false,
  previewBase: '',
  features: { ...DEFAULT_FEATURES },
};

export async function initConfig() {
  try {
    const res = await fetch(`${BASE}/api/config`);
    if (res.ok) {
      const data = await res.json();
      config.previewAvailable = Boolean(data.previewAvailable && data.previewBase);
      config.previewBase = config.previewAvailable ? data.previewBase : '';
      config.features = { ...DEFAULT_FEATURES, ...(data.features || {}) };
    }
  } catch {
    // 服务尚未就绪时不提供预览；功能开关按默认值显示
  }
  return config;
}

/** 预览入口是否开放：管理端开关开启且配置了预览地址。 */
export function isPreviewAvailable() {
  return config.previewAvailable;
}

/** 某个功能是否开放：未知状态一律视为开放（与后端默认一致）。 */
export function isFeatureOn(key) {
  return config.features[key] !== false;
}

function encodePath(filePath) {
  return String(filePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function readJson(res) {
  return res.json().catch(() => ({})).then((data) => {
    if (!res.ok) {
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    return data;
  });
}

function triggerDownload(url, name) {
  const link = document.createElement('a');
  link.href = url;
  if (name) link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function fetchFiles(dirPath = '') {
  const res = await fetch(`${BASE}/api/files?path=${encodeURIComponent(dirPath)}`);
  return readJson(res);
}

/** 按名称搜索文件与文件夹；path 为空表示整个共享目录。 */
export async function searchFiles(query, path = '') {
  const res = await fetch(
    `${BASE}/api/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}`
  );
  return readJson(res);
}

export async function createFolder(parentPath, name) {
  const res = await fetch(`${BASE}/api/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentPath, name }),
  });
  return readJson(res);
}

export async function deleteItem(itemPath) {
  const res = await fetch(`${BASE}/api/files/${encodePath(itemPath)}`, { method: 'DELETE' });
  return readJson(res);
}

export async function renameItem(oldPath, newName) {
  const res = await fetch(`${BASE}/api/rename`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newName }),
  });
  return readJson(res);
}

export async function moveItem(sourcePath, destDir) {
  const res = await fetch(`${BASE}/api/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, destDir }),
  });
  return readJson(res);
}

export async function uploadFiles(files, currentPath) {
  const formData = new FormData();
  formData.append('path', currentPath);
  for (const file of files) {
    formData.append('files', file);
  }
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    body: formData,
  });
  return readJson(res);
}

export async function createShareLink(filePath) {
  const res = await fetch(`${BASE}/api/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  return readJson(res);
}

export function getDownloadUrl(filePath) {
  return `${window.location.origin}/files/${encodePath(filePath)}`;
}

export function getPreviewUrl(filePath) {
  if (!config.previewAvailable || !config.previewBase) return '';
  const previewBase = config.previewBase.replace(/\/+$/, '');
  const fileUrl = `${window.location.origin}/files/${encodePath(filePath)}?preview=1`;
  const encoded = btoa(unescape(encodeURIComponent(fileUrl)));
  return `${previewBase}/onlinePreview?url=${encoded}`;
}

export function getShareUrl(token) {
  return `${window.location.origin}/share/${token}`;
}

/** 浏览器内直接下载（局域网页面没有桌面另存为对话框）。 */
export async function downloadItem(item) {
  triggerDownload(getDownloadUrl(item.path), item.name);
  return true;
}
