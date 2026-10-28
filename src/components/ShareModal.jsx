import React, { useState, useEffect } from 'react';
import { createShareLink, getShareUrl } from '../api';
import { LinkIcon, CopyIcon, XIcon } from './Icons';

export default function ShareModal({ item, onClose }) {
  const [urls, setUrls] = useState([]);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    createShareLink(item.path)
      .then((data) => {
        if (cancelled) return;
        const list =
          Array.isArray(data.urls) && data.urls.length > 0
            ? data.urls
            : [{ label: '默认地址', url: data.url || getShareUrl(data.token) }];
        setUrls(list);
        setShareUrl(list[0].url);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || '生成分享链接失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <LinkIcon width={20} height={20} />
            <h3>分享文件</h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <p className="modal-desc">文件: {item.name}</p>
        {loading ? (
          <div className="loading">
            <div className="loading-spinner" />
            <span>生成分享链接中...</span>
          </div>
        ) : error ? (
          <div className="error-toast">{error}</div>
        ) : (
          <>
            {urls.length > 1 && (
              <select
                className="input share-url-select"
                value={shareUrl}
                onChange={(e) => setShareUrl(e.target.value)}
              >
                {urls.map((entry) => (
                  <option key={entry.url} value={entry.url}>
                    {entry.label}
                  </option>
                ))}
              </select>
            )}
            <div className="share-url-box">
              <input className="input" readOnly value={shareUrl} />
              <button className="btn btn-primary" onClick={handleCopy}>
                <CopyIcon />
                <span>{copied ? '已复制' : '复制'}</span>
              </button>
            </div>
            <p className="modal-hint">链接有效期：应用关闭前有效，局域网设备可通过 HTTP 直接下载</p>
          </>
        )}
      </div>
    </div>
  );
}
