import React from 'react';
import {
  FaFolder, FaFolderOpen,
  FaFile, FaFileImage, FaFileVideo, FaFileAudio,
  FaFileAlt, FaFileCode, FaFileArchive, FaFilePdf,
  FaFileWord, FaFileExcel, FaFilePowerpoint, FaFileContract,
  FaUpload, FaDownload, FaShareAlt, FaPen, FaTrashAlt,
  FaSyncAlt, FaPlus, FaBars, FaTimes, FaCopy, FaLink,
  FaChevronRight, FaChevronDown, FaHome, FaHdd, FaEye,
  FaArrowRight, FaFolderPlus, FaExchangeAlt, FaEnvelope,
  FaAndroid, FaApple, FaWindows, FaLinux, FaJava,
  FaFont, FaBook, FaMagnet, FaSun, FaMoon, FaSearch, FaCheck,
} from 'react-icons/fa';

// ===== 基础操作图标 =====
export const UploadIcon = (props) => <FaUpload size={14} {...props} />;
export const DownloadIcon = (props) => <FaDownload size={14} {...props} />;
export const ShareIcon = (props) => <FaShareAlt size={14} {...props} />;
export const EditIcon = (props) => <FaPen size={13} {...props} />;
export const TrashIcon = (props) => <FaTrashAlt size={13} {...props} />;
export const RefreshIcon = (props) => <FaSyncAlt size={13} {...props} />;
export const PlusIcon = (props) => <FaPlus size={13} {...props} />;
export const MenuIcon = (props) => <FaBars size={18} {...props} />;
export const XIcon = (props) => <FaTimes size={18} {...props} />;
export const CopyIcon = (props) => <FaCopy size={14} {...props} />;
export const LinkIcon = (props) => <FaLink size={15} {...props} />;
export const ChevronRightIcon = (props) => <FaChevronRight size={10} {...props} />;
export const ChevronDownIcon = (props) => <FaChevronDown size={10} {...props} />;
export const CheckIcon = (props) => <FaCheck size={11} {...props} />;
export const HomeIcon = (props) => <FaHome size={14} {...props} />;
export const HardDriveIcon = (props) => <FaHdd size={14} {...props} />;
export const EyeIcon = (props) => <FaEye size={14} {...props} />;
export const MoveIcon = (props) => <FaExchangeAlt size={13} {...props} />;

// 主题切换：浅色下显示月亮（点一下换深色），深色下显示太阳
export const SunIcon = (props) => <FaSun size={15} {...props} />;
export const MoonIcon = (props) => <FaMoon size={14} {...props} />;

// 搜索：放大镜 + 打开所在文件夹
export const SearchIcon = (props) => <FaSearch size={13} {...props} />;
export const OpenFolderIcon = (props) => <FaFolderOpen size={13} {...props} />;

// ===== 文件类型图标（带颜色） =====

export const FolderIcon = ({ size, ...props }) => (
  <FaFolder size={size || 22} color="#fbbf24" {...props} />
);

export const FileIcon = ({ size, ...props }) => (
  <FaFile size={size || 20} color="#94a3b8" {...props} />
);

export const FileImageIcon = ({ size, ...props }) => (
  <FaFileImage size={size || 20} color="#06b6d4" {...props} />
);

export const FileVideoIcon = ({ size, ...props }) => (
  <FaFileVideo size={size || 20} color="#a78bfa" {...props} />
);

export const FileAudioIcon = ({ size, ...props }) => (
  <FaFileAudio size={size || 20} color="#f472b6" {...props} />
);

export const FileTextIcon = ({ size, ...props }) => (
  <FaFileAlt size={size || 20} color="#34d399" {...props} />
);

export const FileCodeIcon = ({ size, ...props }) => (
  <FaFileCode size={size || 20} color="#818cf8" {...props} />
);

export const FileArchiveIcon = ({ size, ...props }) => (
  <FaFileArchive size={size || 20} color="#fb923c" {...props} />
);

export const FilePdfIcon = ({ size, ...props }) => (
  <FaFilePdf size={size || 20} color="#f87171" {...props} />
);

export const FileWordIcon = ({ size, ...props }) => (
  <FaFileWord size={size || 20} color="#60a5fa" {...props} />
);

export const FileExcelIcon = ({ size, ...props }) => (
  <FaFileExcel size={size || 20} color="#4ade80" {...props} />
);

export const FilePowerpointIcon = ({ size, ...props }) => (
  <FaFilePowerpoint size={size || 20} color="#fb923c" {...props} />
);

export const FileContractIcon = ({ size, ...props }) => (
  <FaFileContract size={size || 20} color="#94a3b8" {...props} />
);

export const FolderPlusIcon = ({ size, ...props }) => (
  <FaFolderPlus size={size || 22} color="#fbbf24" {...props} />
);

export const EnvelopeIcon = ({ size, ...props }) => (
  <FaEnvelope size={size || 20} color="#f87171" {...props} />
);

// 安装包 / 系统平台
export const AndroidIcon = ({ size, ...props }) => (
  <FaAndroid size={size || 20} color="#3ddc84" {...props} />
);

export const AppleIcon = ({ size, ...props }) => (
  <FaApple size={size || 20} color="#e2e8f0" {...props} />
);

export const WindowsIcon = ({ size, ...props }) => (
  <FaWindows size={size || 20} color="#38bdf8" {...props} />
);

export const LinuxIcon = ({ size, ...props }) => (
  <FaLinux size={size || 20} color="#a3e635" {...props} />
);

export const JavaIcon = ({ size, ...props }) => (
  <FaJava size={size || 20} color="#fb923c" {...props} />
);

// 字体 / 电子书 / 种子
export const FontFileIcon = ({ size, ...props }) => (
  <FaFont size={size || 20} color="#e879f9" {...props} />
);

export const BookIcon = ({ size, ...props }) => (
  <FaBook size={size || 20} color="#2dd4bf" {...props} />
);

export const MagnetIcon = ({ size, ...props }) => (
  <FaMagnet size={size || 20} color="#fb7185" {...props} />
);

// 根据文件名获取对应图标组件
export function getFileIcon(name, isDirectory) {
  if (isDirectory) return FolderIcon;
  const ext = name.split('.').pop()?.toLowerCase();

  const iconMap = {
    // 图片
    jpg: FileImageIcon, jpeg: FileImageIcon, png: FileImageIcon, gif: FileImageIcon,
    webp: FileImageIcon, svg: FileImageIcon, bmp: FileImageIcon, ico: FileImageIcon,
    tiff: FileImageIcon, tif: FileImageIcon, heic: FileImageIcon, avif: FileImageIcon,
    psd: FileImageIcon, raw: FileImageIcon,
    // 视频
    mp4: FileVideoIcon, mkv: FileVideoIcon, avi: FileVideoIcon, mov: FileVideoIcon,
    webm: FileVideoIcon, flv: FileVideoIcon, wmv: FileVideoIcon, m4v: FileVideoIcon,
    rm: FileVideoIcon, rmvb: FileVideoIcon, m2ts: FileVideoIcon,
    // 音频
    mp3: FileAudioIcon, wav: FileAudioIcon, flac: FileAudioIcon, ogg: FileAudioIcon,
    m4a: FileAudioIcon, aac: FileAudioIcon, wma: FileAudioIcon, ape: FileAudioIcon,
    alac: FileAudioIcon, opus: FileAudioIcon,
    // Office Word
    doc: FileWordIcon, docx: FileWordIcon, rtf: FileWordIcon, dotx: FileWordIcon,
    // Office Excel
    xls: FileExcelIcon, xlsx: FileExcelIcon, csv: FileExcelIcon, xlsm: FileExcelIcon,
    // Office PowerPoint
    ppt: FilePowerpointIcon, pptx: FilePowerpointIcon, ppsx: FilePowerpointIcon, odp: FilePowerpointIcon,
    // PDF
    pdf: FilePdfIcon,
    // 文本
    txt: FileTextIcon, md: FileTextIcon, log: FileTextIcon,
    // 代码
    js: FileCodeIcon, ts: FileCodeIcon, jsx: FileCodeIcon, tsx: FileCodeIcon,
    py: FileCodeIcon, java: FileCodeIcon, c: FileCodeIcon, cpp: FileCodeIcon,
    h: FileCodeIcon, hpp: FileCodeIcon, cs: FileCodeIcon, go: FileCodeIcon,
    rs: FileCodeIcon, rb: FileCodeIcon, php: FileCodeIcon, swift: FileCodeIcon,
    kt: FileCodeIcon, scala: FileCodeIcon, lua: FileCodeIcon, sh: FileCodeIcon,
    css: FileCodeIcon, scss: FileCodeIcon, less: FileCodeIcon,
    html: FileCodeIcon, htm: FileCodeIcon, xml: FileCodeIcon, vue: FileCodeIcon,
    svelte: FileCodeIcon, json: FileCodeIcon, yaml: FileCodeIcon, yml: FileCodeIcon,
    sql: FileCodeIcon, ini: FileCodeIcon, conf: FileCodeIcon, properties: FileCodeIcon,
    env: FileCodeIcon, bat: FileCodeIcon, ps1: FileCodeIcon, dart: FileCodeIcon,
    // 安装包 / 平台
    exe: WindowsIcon, msi: WindowsIcon, msix: WindowsIcon, appx: WindowsIcon,
    apk: AndroidIcon, xapk: AndroidIcon, apks: AndroidIcon,
    ipa: AppleIcon, dmg: AppleIcon, pkg: AppleIcon, app: AppleIcon,
    deb: LinuxIcon, rpm: LinuxIcon, appimage: LinuxIcon,
    jar: JavaIcon,
    // 字体
    ttf: FontFileIcon, otf: FontFileIcon, woff: FontFileIcon,
    woff2: FontFileIcon, eot: FontFileIcon,
    // 电子书 / 漫画
    epub: BookIcon, mobi: BookIcon, azw: BookIcon, azw3: BookIcon,
    prc: BookIcon, fb2: BookIcon, cbz: BookIcon, cbr: BookIcon,
    // 种子
    torrent: MagnetIcon,
    // 压缩
    zip: FileArchiveIcon, rar: FileArchiveIcon, '7z': FileArchiveIcon,
    tar: FileArchiveIcon, gz: FileArchiveIcon, bz2: FileArchiveIcon,
    xz: FileArchiveIcon, iso: FileArchiveIcon, cab: FileArchiveIcon,
    // 邮件
    eml: EnvelopeIcon, msg: EnvelopeIcon,
    // 合同/签名文件
    ofd: FileContractIcon,
  };

  return iconMap[ext] || FileIcon;
}
