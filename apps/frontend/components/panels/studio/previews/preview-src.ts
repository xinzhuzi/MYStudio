/**
 * 预览 <img>/<audio> src 的唯一归一入口(08-24 淘汰 WorkbenchTrackCard 与
 * WorkflowNodePreviews 的双胞胎实现):受管虚拟 scheme 与 data/blob/http 直通,
 * 绝对路径补 file://+encodeURI,相对路径原样返回。
 * 新增 scheme 时只改这里(曾因双处漂移踩过人肉同步坑)。
 */
export function toPreviewSrc(path: string) {
  if (/^(https?:|data:|blob:|file:|asset-file:|local-image:\/\/|project-file:\/\/)/.test(path)) return path;
  if (path.startsWith("/")) return `file://${encodeURI(path)}`;
  return path;
}

/**
 * 展示缩略图变体:受管图片 scheme(project-file/asset-file)且无 query 时缀 ?thumb=1。
 * 只用于 <img> 展示(主进程 sips 按需 512px 缓存);分辨率角标/尺寸预判
 * 必须探原图(image-resolution 会剥掉本参数),展示与真值分层。
 */
export function withThumbVariant(src: string) {
  if (/^(project-file:|asset-file:)/.test(src) && !src.includes("?")) return `${src}?thumb=1`;
  return src;
}
