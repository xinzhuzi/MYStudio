// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ipcMain } from "electron";
import {
  resolveAssetFilePath,
  resolveLocalMediaPath,
  resolveProjectFileUrl,
} from "../../storage/storage-paths";
import { parseImageHeaderSize } from "./image-header-size";

/**
 * `image-probe-size` IPC — 分辨率角标的尺寸探测通道。
 *
 * 渲染层量图片尺寸如果走 `new Image()` 会把整张原图拉进渲染层解码;
 * 图片密集视图(分镜面板 82 卡全 4K)同发即冻结。本通道在主进程只读
 * 文件头前 128KB 解析宽高,零整图传输、零解码。
 *
 * 路径解析复用协议 handler 同款 resolver(受管 scheme 天然限定在各自
 * 存储根内);file:// 仅回宽高不回内容。解析不出/异常一律返回 null,
 * 渲染层自行回退 `new Image()` 探测。
 */

/** 头部读取上限:IHDR/SOF/VP8 均在头部;EXIF 超长扫不到就走渲染层回退。 */
const HEADER_READ_LIMIT = 128 * 1024;

export type ReadFileHead = (filePath: string, limit: number) => Promise<Uint8Array>;

async function defaultReadFileHead(filePath: string, limit: number): Promise<Uint8Array> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

interface RegisterImageProbeIpcHandlersContext {
  getDataDir: () => string;
  getMediaRoot: () => string;
  getAssetsRoot: () => string;
  readFileHead?: ReadFileHead;
  resolveProjectFile?: typeof resolveProjectFileUrl;
  resolveAssetFile?: typeof resolveAssetFilePath;
  resolveLocalMedia?: typeof resolveLocalMediaPath;
}

export function registerImageProbeIpcHandlers({
  getDataDir,
  getMediaRoot,
  getAssetsRoot,
  readFileHead = defaultReadFileHead,
  resolveProjectFile = resolveProjectFileUrl,
  resolveAssetFile = resolveAssetFilePath,
  resolveLocalMedia = resolveLocalMediaPath,
}: RegisterImageProbeIpcHandlersContext) {
  const resolveProbeFilePath = (url: string): string | null => {
    if (url.startsWith("project-file://")) return resolveProjectFile(getDataDir(), url);
    if (url.startsWith("asset-file://")) return resolveAssetFile(getAssetsRoot(), url);
    if (url.startsWith("local-image://")) return resolveLocalMedia(getMediaRoot(), url);
    if (url.startsWith("file://")) return fileURLToPath(url);
    return null;
  };

  ipcMain.handle("image-probe-size", async (_event, url: string) => {
    try {
      const filePath = resolveProbeFilePath(String(url ?? ""));
      if (!filePath) return null;
      const bytes = await readFileHead(filePath, HEADER_READ_LIMIT);
      return parseImageHeaderSize(bytes);
    } catch {
      return null;
    }
  });
}
