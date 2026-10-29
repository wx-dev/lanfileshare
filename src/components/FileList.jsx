import React, { useState, useEffect, useRef } from 'react';
import {
  deleteItem,
  renameItem,
  createFolder,
  downloadItem,
  searchFiles,
} from '../api';
import {
  getFileIcon,
  DownloadIcon,
  ShareIcon,
  EditIcon,
  TrashIcon,
  RefreshIcon,
  PlusIcon,
  FolderIcon,
  EyeIcon,
  MoveIcon,
  SearchIcon,
  OpenFolderIcon,
  XIcon,
  ChevronDownIcon,
  CheckIcon,
} from './Icons';
import ContextMenu from './ContextMenu';
import FolderPickerModal from './FolderPickerModal';
import { canPreview } from '../previewFormats';

// 搜索范围选项（自定义下拉）
const SCOPE_OPTIONS = [
  { value: 'all', label: '整个共享目录' },
  { value: 'current', label: '当前文件夹' },
  { value: 'folder', label: '自定义文件夹' },
];

function formatSize(bytes) {
  if (bytes === null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 父目录路径（'' 表示根目录）
function parentOf(path) {
  return path.split('/').filter(Boolean).slice(0, -1).join('/');
}

export default function FileList({
  items,
  loading,
  currentPath,
  previewOn = false,
  features = null,
  onNavigate,
  onRefresh,
  onShare,
  onPreview,
  onMove,
  onError,
}) {
  const [editingItem, setEditingItem] = useState(null);
  const [editName, setEditName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [touchTimer, setTouchTimer] = useState(null);

  // 文件搜索：关键词 + 范围（整个共享目录 / 当前文件夹 / 自定义文件夹）
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState(null); // null = 未处于搜索模式
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [scope, setScope] = useState('all'); // all | current | folder
  const [customPath, setCustomPath] = useState('');
  const [folderChosen, setFolderChosen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false); // 自定义搜索范围下拉
  const scopeRef = useRef(null);
  const searchSeq = useRef(0); // 丢弃过期的搜索响应
  const debounceRef = useRef(null);

  // 点击下拉外部或按 Esc 时收起
  useEffect(() => {
    if (!scopeOpen) return;
    const onPointerDown = (e) => {
      if (scopeRef.current && !scopeRef.current.contains(e.target)) setScopeOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setScopeOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [scopeOpen]);

  // 功能开关：管理端关闭的功能不显示入口（未拿到配置时按开放处理）
  const on = (key) => !features || features[key] !== false;

  const searchActive = results !== null;
  const scopePath = scope === 'all' ? '' : scope === 'current' ? currentPath : customPath;
  const scopeLabel =
    scope === 'all'
      ? '整个共享目录'
      : scope === 'current'
        ? currentPath
          ? `当前文件夹 /${currentPath}`
          : '当前文件夹（根目录）'
        : customPath
          ? `自定义文件夹 /${customPath}`
          : '自定义文件夹（根目录）';
  const listItems = searchActive ? results : items;

  const runSearch = async (keyword, path) => {
    if (keyword.length > 128) {
      onError('搜索关键词最多 128 个字符');
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const data = await searchFiles(keyword, path);
      if (seq !== searchSeq.current) return;
      setResults(data.items || []);
      setTruncated(Boolean(data.truncated));
    } catch (e) {
      if (seq !== searchSeq.current) return;
      setResults([]);
      setTruncated(false);
      onError('搜索失败: ' + e.message);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  // 退出搜索模式：清空关键词与结果，丢弃在途请求
  const clearSearch = () => {
    searchSeq.current += 1;
    clearTimeout(debounceRef.current);
    setSearchInput('');
    setResults(null);
    setTruncated(false);
    setSearching(false);
  };

  // 输入防抖搜索（300ms）；清空关键词即退出搜索模式；切换范围后重跑
  useEffect(() => {
    const keyword = searchInput.trim();
    clearTimeout(debounceRef.current);
    if (!keyword) {
      setResults(null);
      setTruncated(false);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(keyword, scopePath), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput, scopePath]);

  // 切换目录（面包屑 / 侧边栏 / 点击结果）后退出搜索模式
  useEffect(() => {
    clearSearch();
  }, [currentPath]);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      const keyword = searchInput.trim();
      if (!keyword) return;
      clearTimeout(debounceRef.current);
      runSearch(keyword, scopePath);
    } else if (e.key === 'Escape') {
      clearSearch();
    }
  };

  const changeScope = (next) => {
    setScope(next);
    // 首次切到自定义文件夹时默认当前目录，选过之后记住用户的选择
    if (next === 'folder' && !folderChosen) setCustomPath(currentPath);
  };

  // 点击结果：进入文件夹 / 打开文件所在目录，并清除搜索
  const openResult = (item) => {
    clearSearch();
    onNavigate(item.isDirectory ? item.path : parentOf(item.path));
  };

  const openResultParent = (e, item) => {
    e.stopPropagation();
    clearSearch();
    onNavigate(parentOf(item.path));
  };

  // 刷新：搜索模式下重跑搜索，否则刷新当前目录
  const refresh = () => {
    const keyword = searchInput.trim();
    if (searchActive && keyword) {
      runSearch(keyword, scopePath);
    } else {
      onRefresh();
    }
  };

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX || e.touches?.[0]?.clientX, y: e.clientY || e.touches?.[0]?.clientY, item });
  };

  // 长按支持（移动端）
  const handleTouchStart = (e, item) => {
    const timer = setTimeout(() => {
      const touch = e.touches[0];
      setContextMenu({ x: touch.clientX, y: touch.clientY, item });
    }, 500);
    setTouchTimer(timer);
  };

  const handleTouchEnd = () => {
    if (touchTimer) {
      clearTimeout(touchTimer);
      setTouchTimer(null);
    }
  };

  const handleContextAction = (action, item) => {
    switch (action) {
      case 'open':
        if (searchActive) openResult(item);
        else onNavigate(item.path);
        break;
      case 'preview':
        onPreview(item);
        break;
      case 'download':
        downloadItem(item).catch((e) => onError('下载失败: ' + e.message));
        break;
      case 'share':
        onShare(item);
        break;
      case 'move':
        onMove(item);
        break;
      case 'rename':
        setEditingItem(item.path);
        setEditName(item.name);
        break;
      case 'delete':
        handleDelete(item);
        break;
    }
  };

  const handleDelete = async (item) => {
    if (!on('delete')) return;
    const confirmMsg = item.isDirectory
      ? `确定删除文件夹 "${item.name}" 及其所有内容吗？`
      : `确定删除文件 "${item.name}" 吗？`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await deleteItem(item.path);
      refresh();
    } catch (e) {
      onError('删除失败: ' + e.message);
    }
  };

  const handleRename = async (item) => {
    if (!on('rename')) {
      setEditingItem(null);
      return;
    }
    if (!editName.trim() || editName === item.name) {
      setEditingItem(null);
      return;
    }
    try {
      await renameItem(item.path, editName.trim());
      setEditingItem(null);
      refresh();
    } catch (e) {
      onError('重命名失败: ' + e.message);
    }
  };

  const handleCreateFolder = async () => {
    if (!on('mkdir')) {
      setShowNewFolder(false);
      return;
    }
    if (!newFolderName.trim()) return;
    try {
      await createFolder(currentPath, newFolderName.trim());
      setShowNewFolder(false);
      setNewFolderName('');
      refresh();
    } catch (e) {
      onError('创建文件夹失败: ' + e.message);
    }
  };

  const handleDownload = (e, item) => {
    e.stopPropagation();
    downloadItem(item).catch((err) => onError('下载失败: ' + err.message));
  };

  const handleShare = (e, item) => {
    e.stopPropagation();
    onShare(item);
  };

  const parentLabel = (item) => {
    const parent = parentOf(item.path);
    return parent ? `/${parent}` : '根目录';
  };

  return (
    <div className="file-list-container">
      <div className="file-list-toolbar">
        <div className="search-bar">
          <div className="search-field">
            <span className="search-icon">
              <SearchIcon />
            </span>
            <input
              className="search-input"
              placeholder="搜索文件或文件夹..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {searchInput && (
              <button
                type="button"
                className="search-clear-btn"
                title="清除搜索"
                onClick={clearSearch}
              >
                <XIcon size={13} />
              </button>
            )}
          </div>
          <div className="search-scope-wrap" ref={scopeRef}>
            <button
              type="button"
              className={`search-scope${scopeOpen ? ' open' : ''}`}
              title="搜索范围"
              aria-haspopup="listbox"
              aria-expanded={scopeOpen}
              onClick={() => setScopeOpen((v) => !v)}
            >
              <span className="search-scope-label">
                {SCOPE_OPTIONS.find((o) => o.value === scope)?.label}
              </span>
              <span className="search-scope-arrow">
                <ChevronDownIcon />
              </span>
            </button>
            {scopeOpen && (
              <div className="search-scope-menu" role="listbox">
                {SCOPE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={scope === o.value}
                    className={`search-scope-item${scope === o.value ? ' active' : ''}`}
                    onClick={() => {
                      changeScope(o.value);
                      setScopeOpen(false);
                    }}
                  >
                    <span className="search-scope-check">
                      {scope === o.value && <CheckIcon />}
                    </span>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {scope === 'folder' && (
            <>
              <span
                className="search-scope-path"
                title={customPath ? `/${customPath}` : '/ (根目录)'}
              >
                {customPath ? `/${customPath}` : '/ (根目录)'}
              </span>
              <button
                type="button"
                className="btn btn-secondary search-change-btn"
                onClick={() => setShowPicker(true)}
              >
                更改
              </button>
            </>
          )}
        </div>
        {on('mkdir') && !searchActive && (
          <button className="btn btn-secondary" onClick={() => setShowNewFolder(true)}>
            <PlusIcon />
            <span>新建文件夹</span>
          </button>
        )}
        <button className="btn btn-secondary" onClick={refresh}>
          <RefreshIcon />
          <span>刷新</span>
        </button>
      </div>

      {showNewFolder && on('mkdir') && !searchActive && (
        <div className="inline-form">
          <input
            autoFocus
            className="input"
            placeholder="文件夹名称"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); }
            }}
          />
          <button className="btn btn-primary" onClick={handleCreateFolder}>确定</button>
          <button className="btn btn-secondary" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}>取消</button>
        </div>
      )}

      {loading || (searching && !searchActive) ? (
        <div className="loading">
          <div className="loading-spinner" />
          <span>{searching && !searchActive ? '搜索中...' : '加载中...'}</span>
        </div>
      ) : (
        <div className={`file-list${searchActive ? ' search-results' : ''}`}>
          {searchActive && (
            <div className="search-summary">
              <span className="search-summary-text">
                找到 <b>{results.length}</b> 个结果（{scopeLabel}）
              </span>
              {searching && <span className="search-busy">搜索中...</span>}
              {truncated && (
                <span className="search-truncated">结果较多，仅显示前 200 条，可缩小搜索范围</span>
              )}
              <button type="button" className="search-clear-btn" onClick={clearSearch}>
                清除搜索
              </button>
            </div>
          )}
          {!searchActive && (
            <div className="file-list-header">
              <span className="col-name">名称</span>
              <span className="col-size">大小</span>
              <span className="col-date">修改时间</span>
              <span className="col-actions">操作</span>
            </div>
          )}
          {listItems.length === 0 ? (
            searchActive ? (
              <div className="empty-state">
                <SearchIcon size={48} className="empty-icon" />
                <p>未找到匹配项</p>
                <p className="empty-hint">换个关键词，或调整搜索范围试试</p>
              </div>
            ) : (
              <div className="empty-state">
                <FolderIcon width={64} height={64} strokeWidth={1} className="empty-icon" />
                <p>此文件夹为空</p>
                {(on('upload') || on('mkdir')) && (
                  <p className="empty-hint">点击上方按钮上传文件或新建文件夹</p>
                )}
              </div>
            )
          ) : (
            listItems.map((item) => {
              const IconComponent = getFileIcon(item.name, item.isDirectory);
              return (
                <div
                  key={item.path}
                  className={`file-item ${item.isDirectory ? 'is-dir' : ''} ${searchActive ? 'search-result' : ''}`}
                  onClick={searchActive ? () => openResult(item) : undefined}
                  onDoubleClick={!searchActive && item.isDirectory ? () => onNavigate(item.path) : undefined}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  onTouchStart={(e) => handleTouchStart(e, item)}
                  onTouchEnd={handleTouchEnd}
                >
                  <span
                    className="col-name"
                    onClick={searchActive ? undefined : () => item.isDirectory && onNavigate(item.path)}
                  >
                    <span className="file-icon">
                      <IconComponent width={20} height={20} />
                    </span>
                    {editingItem === item.path ? (
                      <input
                        autoFocus
                        className="input inline-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => handleRename(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(item);
                          if (e.key === 'Escape') setEditingItem(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : searchActive ? (
                      <span className="name-block">
                        <span className="file-name">{item.name}</span>
                        <span
                          className="file-path"
                          title={`打开所在文件夹：${parentLabel(item)}`}
                          onClick={(e) => openResultParent(e, item)}
                        >
                          {parentLabel(item)}
                        </span>
                      </span>
                    ) : (
                      <span className="file-name">{item.name}</span>
                    )}
                  </span>
                  <span className="col-size">{formatSize(item.size)}</span>
                  <span className="col-date">{formatDate(item.mtime)}</span>
                  <span className="col-actions">
                    {searchActive && (
                      <button
                        className="action-btn"
                        title={item.isDirectory ? '打开此文件夹' : '打开所在文件夹'}
                        onClick={(e) => { e.stopPropagation(); openResult(item); }}
                      >
                        <OpenFolderIcon />
                      </button>
                    )}
                    {previewOn && !item.isDirectory && canPreview(item.name) && (
                      <button className="action-btn" title="预览" onClick={(e) => { e.stopPropagation(); onPreview(item); }}>
                        <EyeIcon />
                      </button>
                    )}
                    {!item.isDirectory && (
                      <>
                        <button className="action-btn" title="下载" onClick={(e) => handleDownload(e, item)}>
                          <DownloadIcon />
                        </button>
                        {on('share') && (
                          <button className="action-btn" title="分享" onClick={(e) => handleShare(e, item)}>
                            <ShareIcon />
                          </button>
                        )}
                      </>
                    )}
                    {on('move') && (
                      <button className="action-btn" title="移动" onClick={(e) => { e.stopPropagation(); onMove(item); }}>
                        <MoveIcon />
                      </button>
                    )}
                    {on('rename') && (
                      <button
                        className="action-btn"
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingItem(item.path);
                          setEditName(item.name);
                        }}
                      >
                        <EditIcon />
                      </button>
                    )}
                    {on('delete') && (
                      <button className="action-btn danger" title="删除" onClick={(e) => { e.stopPropagation(); handleDelete(item); }}>
                        <TrashIcon />
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          previewOn={previewOn}
          features={features}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      )}

      {showPicker && (
        <FolderPickerModal
          initialPath={customPath}
          onClose={() => setShowPicker(false)}
          onSelect={(path) => {
            setCustomPath(path);
            setFolderChosen(true);
            setShowPicker(false);
          }}
        />
      )}
    </div>
  );
}
