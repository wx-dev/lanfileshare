// 深色 / 浅色主题（用户端与管理端共用）
// - 首次打开跟随系统（prefers-color-scheme），手动切换后记住所选
// - 偏好存 localStorage：局域网页面按浏览器/设备各自记忆，管理端按本机窗口记忆
// - 不经过 Rust 命令与配置文件，样式切换由 <html data-theme> 驱动 CSS 变量

const STORAGE_KEY = 'lanfileshare-theme';

/** 系统当前的浅色/深色偏好。 */
function systemTheme() {
  const light =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return light ? 'light' : 'dark';
}

/** 手动记住的主题；没有或非法值时返回 null（表示跟随系统）。 */
function savedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // 隐私模式等场景 localStorage 不可用：退回跟随系统
  }
  return null;
}

/** 把主题写到 <html data-theme>，两个样式表据此切换颜色变量。 */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

/** 当前生效的主题。 */
export function currentTheme() {
  return savedTheme() || systemTheme();
}

/**
 * 应用初始主题（在渲染前调用，避免闪烁）。
 * 尚未手动选择过时持续跟随系统深浅色变化；手动选择后不再跟随。
 */
export function initTheme() {
  const saved = savedTheme();
  const theme = applyTheme(saved || systemTheme());

  if (!saved && typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme(media.matches ? 'light' : 'dark');
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
    }
  }

  return theme;
}

/** 切换到相反主题并记住（此后不再跟随系统）。 */
export function toggleTheme() {
  const next =
    document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 无法持久化时本次会话内仍然生效
  }
  return next;
}
