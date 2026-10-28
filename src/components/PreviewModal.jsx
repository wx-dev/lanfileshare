import React, { useState, useEffect } from 'react';
import { getPreviewUrl } from '../api';
import { XIcon, DownloadIcon, RefreshIcon } from './Icons';

export default function PreviewModal({ item, onClose, onDownload }) {
  const [url, setUrl] = useState(getPreviewUrl(item.path));
  const [loading, setLoading] = useState(true);

  const handleReload = () => {
    const next = getPreviewUrl(item.path);
    if (!next) return;
    setLoading(true);
    setUrl(next + '&_t=' + Date.now());
  };

  useEffect(() => {
    // 预览被管理端关闭时立即退出，避免渲染空地址的 iframe
    if (!url) onClose();
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-preview" onClick={(e) => e.stopPropagation()}>
        <div className="preview-header">
          <div className="preview-title">
            <span>{item.name}</span>
          </div>
          <div className="preview-actions">
            <button className="action-btn" title="重新加载" onClick={handleReload}>
              <RefreshIcon />
            </button>
            <button className="action-btn" title="下载" onClick={() => onDownload(item)}>
              <DownloadIcon />
            </button>
            <button className="action-btn" title="关闭" onClick={onClose}>
              <XIcon />
            </button>
          </div>
        </div>
        <div className="preview-body">
          {loading && (
            <div className="preview-loading">
              <div className="loading-spinner" />
              <span>加载预览中...</span>
            </div>
          )}
          <iframe
            key={url}
            src={url}
            title={item.name}
            className="preview-frame"
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  );
}
