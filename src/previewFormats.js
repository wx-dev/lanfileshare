// kkFileView 支持的预览格式（与官方文档保持一致）
// 文档: https://kkview.cn/zh-cn/docs/home.html

const OFFICE = [
  // Office / WPS / LibreOffice 文档
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'tsv',
  'wps', 'dps', 'et', 'ett', 'wpt',
  'odt', 'ods', 'odp', 'ott', 'fodt', 'fods',
  'pdf',
];

const CAD = [
  // CAD 与 3D
  'dwg', 'dxf', 'dwf', 'dwt', 'plt', 'cf2',
  'obj', '3ds', 'stl', 'gltf', 'glb', 'fbx', 'dae',
  'ifc', 'step', 'stp', 'iges', 'igs', 'fcstd', 'bim', 'brep',
];

const IMAGE = [
  // 图片与图像
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic',
  'tif', 'tiff', 'tga', 'svg', 'wmf', 'emf',
];

const ARCHIVE_TEXT = [
  // 压缩与文本
  'zip', 'rar', 'jar', 'tar', 'gzip', 'gz', '7z',
  'txt', 'md', 'xml', 'java', 'js', 'css', 'py', 'php',
];

const MEDIA = [
  // 音视频与邮件
  'mp3', 'wav', 'mp4', 'flv', 'avi', 'mov', 'mkv',
  'eml', 'msg',
  // 其他格式
  'epub', 'ofd', 'xmind', 'bpmn', 'drawio', 'dcm',
];

export const PREVIEWABLE_EXTS = new Set([
  ...OFFICE,
  ...CAD,
  ...IMAGE,
  ...ARCHIVE_TEXT,
  ...MEDIA,
]);

export function canPreview(name) {
  if (!name || name.includes('.')) {
    const ext = name?.split('.').pop()?.toLowerCase();
    return PREVIEWABLE_EXTS.has(ext);
  }
  return false;
}
