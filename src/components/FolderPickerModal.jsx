import React, { useState, useEffect } from 'react';
import { fetchFiles } from '../api';
import { FolderIcon, XIcon } from './Icons';

/**
 * 选择一个文件夹作为搜索范围：
 * 面包屑可跳转任意层级，列表点击进入子文件夹，「返回上级」逐级回退，
 * 最后按「选择此文件夹」确认当前停留的目录。
 */
export default function FolderPickerModal({ initialPath = '', onClose, onSelect }) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchFiles(currentPath)
      .then((data) => {
        if (alive) setFolders(data.items.filter((i) => i.isDirectory));
      })
      .catch(() => {
        if (alive) setError('加载目录失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [currentPath]);

  const goUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  const breadcrumbParts = currentPath.split('/').filter(Boolean);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-move" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <FolderIcon width={20} height={20} />
            <h3>选择搜索文件夹</h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <XIcon />
          </button>
        </div>

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
          <span className="move-target-label">当前目录：</span>
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
            onClick={goUp}
            disabled={currentPath === ''}
          >
            返回上级
          </button>
          <div className="modal-actions-right">
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={() => onSelect(currentPath)}>
              选择此文件夹
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
