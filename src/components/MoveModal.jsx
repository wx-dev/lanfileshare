import React, { useState, useEffect } from 'react';
import { fetchFiles, moveItem } from '../api';
import { FolderIcon, XIcon } from './Icons';

export default function MoveModal({ item, onClose, onSuccess }) {
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    loadFolders(currentPath);
  }, [currentPath]);

  const loadFolders = async (path) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchFiles(path);
      setFolders(data.items.filter((i) => i.isDirectory));
    } catch (e) {
      setError('加载目录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleMove = async () => {
    if (moving) return;
    setMoving(true);
    setError('');
    try {
      const result = await moveItem(item.path, currentPath);
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error || '移动失败');
      }
    } catch (e) {
      setError('移动失败: ' + e.message);
    } finally {
      setMoving(false);
    }
  };

  const breadcrumbParts = currentPath.split('/').filter(Boolean);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-move" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <FolderIcon width={20} height={20} />
            <h3>移动到</h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <p className="modal-desc">{item.name}</p>

        <div className="move-breadcrumb">
          <button
            className={`breadcrumb-item ${currentPath === '' ? 'current' : ''}`}
            onClick={() => setCurrentPath('')}
          >
            根目录
          </button>
          {breadcrumbParts.map((part, i) => {
            const path = breadcrumbParts.slice(0, i + 1).join('/');
            return (
              <React.Fragment key={path}>
                <span className="breadcrumb-sep">/</span>
                <button
                  className={`breadcrumb-item ${i === breadcrumbParts.length - 1 ? 'current' : ''}`}
                  onClick={() => setCurrentPath(path)}
                >
                  {part}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="move-target-bar">
          <span className="move-target-label">目标位置：</span>
          <span className="move-target-path">
            {currentPath ? `/${currentPath}` : '/ (根目录)'}
          </span>
        </div>

        <div className="move-folder-list">
          {loading ? (
            <div className="loading">
              <div className="loading-spinner" />
            </div>
          ) : folders.length === 0 ? (
            <div className="move-empty">此目录下没有子文件夹</div>
          ) : (
            folders.map((folder) => (
              <div
                key={folder.path}
                className="move-folder-item"
                onClick={() => setCurrentPath(folder.path)}
              >
                <FolderIcon width={16} height={16} />
                <span>{folder.name}</span>
              </div>
            ))
          )}
        </div>

        {error && <div className="error-toast">{error}</div>}

        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setCurrentPath('')}
            disabled={currentPath === ''}
          >
            移到根目录
          </button>
          <div className="modal-actions-right">
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button
              className="btn btn-primary"
              onClick={handleMove}
              disabled={moving}
            >
              {moving ? '移动中...' : '移动到此'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
