import React, { useState, useEffect } from 'react';
import { fetchFiles } from '../api';
import { FolderIcon, ChevronRightIcon, ChevronDownIcon } from './Icons';

function TreeNode({ name, path, currentPath, onNavigate, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);

  const isActive = currentPath === path;

  useEffect(() => {
    if (expanded && children.length === 0) {
      setLoading(true);
      fetchFiles(path)
        .then((data) => {
          setChildren(data.items.filter((i) => i.isDirectory));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [expanded]);

  return (
    <div className="tree-node">
      <div
        className={`tree-node-content ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onNavigate(path)}
      >
        <button
          className="tree-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
        <span className="tree-icon">
          <FolderIcon width={16} height={16} />
        </span>
        <span className="tree-label">{name}</span>
      </div>
      {expanded && (
        <div className="tree-children">
          {loading && <div className="tree-loading" style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}>加载中...</div>}
          {children.map((child) => (
            <TreeNode
              key={child.path}
              name={child.name}
              path={child.path}
              currentPath={currentPath}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          ))}
          {!loading && children.length === 0 && (
            <div className="tree-empty" style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}>空</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FolderTree({ currentPath, onNavigate }) {
  const [rootDirs, setRootDirs] = useState([]);

  useEffect(() => {
    fetchFiles('')
      .then((data) => setRootDirs(data.items.filter((i) => i.isDirectory)))
      .catch(() => {});
  }, [currentPath]);

  return (
    <div className="folder-tree">
      <div
        className={`tree-node-content root ${currentPath === '' ? 'active' : ''}`}
        onClick={() => onNavigate('')}
      >
        <span className="tree-icon">
          <FolderIcon width={16} height={16} />
        </span>
        <span className="tree-label">根目录</span>
      </div>
      {rootDirs.map((dir) => (
        <TreeNode
          key={dir.path}
          name={dir.name}
          path={dir.path}
          currentPath={currentPath}
          onNavigate={onNavigate}
          depth={0}
        />
      ))}
    </div>
  );
}
