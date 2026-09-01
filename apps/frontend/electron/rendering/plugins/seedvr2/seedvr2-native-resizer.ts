// SeedVR2 输入缩放器(Electron nativeImage/CoreGraphics)。
// 独立成文件:本模块静态引 electron,只在主进程生产装配时被动态加载,
// 测试环境(seam 注入假缩放器)永远不 import 它。

import { nativeImage } from "electron";

import { SEEDVR2_MAX_INPUT_PIXELS } from "./seedvr2-restore-client";

export function nativeImageResizer(buffer: Buffer, maxPixels: number = SEEDVR2_MAX_INPUT_PIXELS): Buffer {
  const image = nativeImage.createFromBuffer(buffer);
  const size = image.getSize();
  if (size.width * size.height <= maxPixels) return buffer;
  const scale = Math.sqrt(maxPixels / (size.width * size.height));
  const resized = image.resize({
    width: Math.max(2, Math.round(size.width * scale)),
    height: Math.max(2, Math.round(size.height * scale)),
  });
  const out = resized.toPNG();
  return out.length > 0 ? out : buffer;
}
