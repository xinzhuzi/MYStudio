// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseImageHeaderSize } from "../ipc/media/image-header-size";

/**
 * 按需图片缩略图缓存(project-file 展示加速)。
 *
 * 画布/面板的分镜瓦片若直接展示原始 4K 图,缩放每帧都要对数十张
 * 33MB 级解码位图重栅格化,GPU 直接跪(2026-08-25 画布缩放卡顿根修)。
 * 本模块在首次请求 `?thumb=1` 时用 macOS `sips` 子进程异步生成 512px
 * JPEG(保纵横比),按 `sha1(路径:mtime:size:边长)` 落盘缓存;并发限 4
 * + 同 key 去重(沿用 studio-assets-storage 的队列纪律,防止一次性
 * spawn 一堆 sips 拖死主进程)。生成失败/图本就小于目标边长返回 null,
 * 调用方回退原图字节,功能永不劣化。
 */

const HEADER_READ_LIMIT = 128 * 1024;
/** sips 并发上限:足够吞吐首屏,又不至于堆满子进程。 */
const SIPS_CONCURRENCY = 4;

type ExecFileFn = (
  command: string,
  args: string[],
  callback: (error: Error | null) => void,
) => void;
type StatFileFn = (filePath: string) => Promise<{ mtimeMs: number; size: number }>;
type ReadHeadFn = (filePath: string, limit: number) => Promise<Uint8Array>;
type ExistsFn = (filePath: string) => boolean;
type MkdirFn = (dirPath: string) => void;

export interface ImageThumbCacheDeps {
  execFile?: ExecFileFn;
  statFile?: StatFileFn;
  readHead?: ReadHeadFn;
  exists?: ExistsFn;
  mkdir?: MkdirFn;
}

export interface ImageThumbCache {
  getOrCreateThumb(sourcePath: string): Promise<string | null>;
}

function defaultStatFile(filePath: string) {
  return fs.promises.stat(filePath).then((stat) => ({ mtimeMs: stat.mtimeMs, size: stat.size }));
}

async function defaultReadHead(filePath: string, limit: number): Promise<Uint8Array> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function createImageThumbCache({
  cacheDir,
  longSide = 512,
  deps = {},
}: {
  cacheDir: string;
  longSide?: number;
  deps?: ImageThumbCacheDeps;
}): ImageThumbCache {
  const {
    execFile: runSips = execFile as unknown as ExecFileFn,
    statFile = defaultStatFile,
    readHead = defaultReadHead,
    exists = (filePath: string) => fs.existsSync(filePath),
    mkdir = (dirPath: string) => fs.mkdirSync(dirPath, { recursive: true }),
  } = deps;

  const inflight = new Map<string, Promise<string | null>>();
  let activeSips = 0;
  const queue: Array<() => void> = [];

  const pump = () => {
    while (activeSips < SIPS_CONCURRENCY && queue.length > 0) {
      const job = queue.shift()!;
      activeSips += 1;
      job();
    }
  };

  const generate = (sourcePath: string, thumbPath: string) =>
    new Promise<string | null>((resolve) => {
      const run = () => {
        runSips(
          "sips",
          [
            "--resampleHeightWidthMax",
            String(longSide),
            String(longSide),
            sourcePath,
            "--out",
            thumbPath,
          ],
          (error) => {
            activeSips -= 1;
            pump();
            resolve(error || !exists(thumbPath) ? null : thumbPath);
          },
        );
      };
      queue.push(run);
      pump();
    });

  const getOrCreateThumb = async (sourcePath: string): Promise<string | null> => {
    let keyInput: string;
    try {
      const stat = await statFile(sourcePath);
      keyInput = `${path.resolve(sourcePath)}:${stat.mtimeMs}:${stat.size}:${longSide}`;
    } catch {
      return null; // 源文件读不到,交调用方回退原图(也会 404,行为一致)
    }
    const thumbPath = path.join(cacheDir, `${createHash("sha1").update(keyInput).digest("hex")}.jpg`);
    if (exists(thumbPath)) return thumbPath;

    const pending = inflight.get(thumbPath);
    if (pending) return pending;

    const job = (async () => {
      // 图本就不超过目标边长:不值得生成,直接回退原图
      const header = await readHead(sourcePath, HEADER_READ_LIMIT).catch(() => null);
      const size = header ? parseImageHeaderSize(header) : null;
      if (size && Math.max(size.width, size.height) <= longSide) return null;
      try {
        mkdir(cacheDir);
      } catch {
        return null;
      }
      return generate(sourcePath, thumbPath);
    })();
    inflight.set(thumbPath, job);
    const result = await job.finally(() => inflight.delete(thumbPath));
    return result;
  };

  return { getOrCreateThumb };
}
