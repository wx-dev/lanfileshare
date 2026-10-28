import React, { useState, useRef } from 'react';
import { uploadFiles } from '../api';
import { UploadIcon } from './Icons';

export default function FileUpload({ currentPath, onUploaded, onError }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef(null);

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 10, 90));
      }, 200);

      const result = await uploadFiles(files, currentPath);

      clearInterval(progressInterval);
      setProgress(100);

      if (result.success) {
        setTimeout(() => {
          setUploading(false);
          setProgress(0);
          onUploaded();
        }, 500);
      }
    } catch (e) {
      setUploading(false);
      setProgress(0);
      onError('上传失败: ' + e.message);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <button
        className="btn btn-primary"
        onClick={handleClick}
        disabled={uploading}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <UploadIcon />
        <span>{uploading ? `上传中 ${progress}%` : '上传文件'}</span>
      </button>
      {uploading && (
        <div className="upload-progress">
          <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </>
  );
}
