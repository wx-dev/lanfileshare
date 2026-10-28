import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { canPreview } from '../previewFormats';
import {
  FaFolderOpen,
  FaDownload,
  FaShareAlt,
  FaExchangeAlt,
  FaPen,
  FaTrashAlt,
  FaEye,
} from 'react-icons/fa';

const ICONS = {
  open: { Icon: FaFolderOpen, color: '#fbbf24' },
  preview: { Icon: FaEye, color: '#06b6d4' },
  download: { Icon: FaDownload, color: '#34d399' },
  share: { Icon: FaShareAlt, color: '#818cf8' },
  move: { Icon: FaExchangeAlt, color: '#f472b6' },
  rename: { Icon: FaPen, color: '#f59e0b' },
  delete: { Icon: FaTrashAlt, color: '#f87171' },
};

export default function ContextMenu({ x, y, item, previewOn = false, features = null, onClose, onAction }) {
  const menuRef = useRef(null);

  // 功能开关：管理端关闭的功能不进右键菜单
  const on = (key) => !features || features[key] !== false;

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleResize = () => onClose();

    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [onClose]);

  // 防止菜单超出屏幕
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 300);

  // 按功能开关分组构建菜单；关闭的功能整项隐藏，没有候选时不插入分隔线
  const groups = item.isDirectory
    ? [
        [
          { id: 'open', label: '打开' },
          ...(on('move') ? [{ id: 'move', label: '移动' }] : []),
          ...(on('rename') ? [{ id: 'rename', label: '重命名' }] : []),
        ],
        ...(on('delete') ? [[{ id: 'delete', label: '删除', danger: true }]] : []),
      ]
    : [
        [
          ...(previewOn && canPreview(item.name) ? [{ id: 'preview', label: '预览' }] : []),
          { id: 'download', label: '下载' },
          ...(on('share') ? [{ id: 'share', label: '分享' }] : []),
          ...(on('move') ? [{ id: 'move', label: '移动' }] : []),
          ...(on('rename') ? [{ id: 'rename', label: '重命名' }] : []),
        ],
        ...(on('delete') ? [[{ id: 'delete', label: '删除', danger: true }]] : []),
      ];

  const menuItems = groups.reduce(
    (acc, group, index) => (index === 0 ? group : [...acc, { type: 'separator' }, ...group]),
    []
  );

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="context-menu-title">{item.name}</div>
      {menuItems.map((mi, i) => {
        if (mi.type === 'separator') {
          return <div key={i} className="context-menu-separator" />;
        }
        const { Icon, color } = ICONS[mi.id] || {};
        return (
          <button
            key={mi.id}
            className={`context-menu-item ${mi.danger ? 'danger' : ''}`}
            onClick={() => { onAction(mi.id, item); onClose(); }}
          >
            <span
              className="context-menu-icon"
              style={{ color: mi.danger ? undefined : color }}
            >
              {Icon && <Icon size={14} />}
            </span>
            <span>{mi.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
