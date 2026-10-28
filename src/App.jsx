import React, { useState, useEffect, useCallback } from 'react';
import FileList from './components/FileList';
import FolderTree from './components/FolderTree';
import FileUpload from './components/FileUpload';
import ShareModal from './components/ShareModal';
import PreviewModal from './components/PreviewModal';
import MoveModal from './components/MoveModal';
import { fetchFiles, downloadItem, initConfig, DEFAULT_FEATURES } from './api';
import { MenuIcon, SunIcon, MoonIcon } from './components/Icons';
import { currentTheme, toggleTheme } from './theme';

export default function App() {
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shareItem, setShareItem] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [moveItem, setMoveItem] = useState(null);
  const [previewOn, setPreviewOn] = useState(false);
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  const [theme, setTheme] = useState(currentTheme);
  const isMobile = window.innerWidth <= 768;
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);

  const loadFiles = useCallback(async (path = '') => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchFiles(path);
      setItems(data.items);
      setCurrentPath(data.currentPath || '');
    } catch (e) {
      setError(e.message || '加载文件列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    initConfig().then((cfg) => {
      if (!alive) return;
      setPreviewOn(Boolean(cfg.previewAvailable));
      setFeatures(cfg.features);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    loadFiles('');
  }, [loadFiles]);

  const handleNavigate = (path) => {
    loadFiles(path);
  };

  const handleError = (msg) => {
    setError(msg);
    setTimeout(() => setError(''), 3000);
  };

  const handleDownload = (item) => {
    downloadItem(item).catch((e) => handleError('下载失败: ' + e.message));
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="切换侧边栏"
          >
            <MenuIcon />
          </button>
          <h1>文件分享</h1>
        </div>
        <div className="header-right">
          <button
            type="button"
            className="icon-btn theme-btn"
            aria-label={theme === 'light' ? '切换为深色主题' : '切换为浅色主题'}
            title={theme === 'light' ? '切换为深色主题' : '切换为浅色主题'}
            onClick={() => setTheme(toggleTheme())}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
          {features.upload && (
            <FileUpload
              currentPath={currentPath}
              onUploaded={() => loadFiles(currentPath)}
              onError={handleError}
            />
          )}
        </div>
      </header>

      <div className="app-body">
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
        )}
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            目录树
          </div>
          <FolderTree
            currentPath={currentPath}
            onNavigate={(p) => {
              handleNavigate(p);
              if (window.innerWidth <= 768) setSidebarOpen(false);
            }}
          />
        </aside>

        <main className="main-content">
          <nav className="breadcrumb">
            <button className="breadcrumb-item" onClick={() => handleNavigate('')}>
              根目录
            </button>
            {currentPath.split('/').filter(Boolean).map((part, i, arr) => {
              const path = arr.slice(0, i + 1).join('/');
              return (
                <React.Fragment key={path}>
                  <span className="breadcrumb-sep">/</span>
                  <button
                    className="breadcrumb-item"
                    onClick={() => handleNavigate(path)}
                  >
                    {part}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          {error && <div className="error-toast">{error}</div>}

          <FileList
            items={items}
            loading={loading}
            currentPath={currentPath}
            previewOn={previewOn}
            features={features}
            onNavigate={handleNavigate}
            onRefresh={() => loadFiles(currentPath)}
            onShare={setShareItem}
            onPreview={setPreviewItem}
            onMove={setMoveItem}
            onError={handleError}
          />
        </main>
      </div>

      {shareItem && (
        <ShareModal
          item={shareItem}
          onClose={() => setShareItem(null)}
        />
      )}

      {previewItem && (
        <PreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onDownload={handleDownload}
        />
      )}

      {moveItem && (
        <MoveModal
          item={moveItem}
          onClose={() => setMoveItem(null)}
          onSuccess={() => loadFiles(currentPath)}
        />
      )}
    </div>
  );
}
