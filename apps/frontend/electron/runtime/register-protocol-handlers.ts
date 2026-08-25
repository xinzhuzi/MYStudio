import type { Protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { resolveAssetFilePath, resolveLocalMediaPath, resolveProjectFileUrl } from "../storage/storage-paths";
import { resolveToonflowAssetPath } from "../storage/studio-runtime-assets";
import { createImageThumbCache, type ImageThumbCache } from "./image-thumb-cache";

type ReadFile = (filePath: string) => Uint8Array | Promise<Uint8Array>;

interface ProtocolHandlerOptions {
  protocol: Protocol;
  getMediaRoot: () => string;
  getDataDir: () => string;
  getSkillsRoot: () => string;
  getAssetsRoot: () => string;
  /** 展示缩略图缓存目录(?thumb=1 请求用);不提供则缩略图请求回退原图。 */
  getImageThumbDir?: () => string;
  /** 缓存工厂(测试注入用);默认真 sips 实现。 */
  createThumbCache?: (options: { cacheDir: string }) => ImageThumbCache;
  readFile?: ReadFile;
  resolveLocalMedia?: typeof resolveLocalMediaPath;
  resolveProjectFile?: typeof resolveProjectFileUrl;
  resolveAssetFile?: typeof resolveAssetFilePath;
  resolveToonflowAsset?: typeof resolveToonflowAssetPath;
}

export function registerPrivilegedSchemes(protocol: Protocol) {
  protocol.registerSchemesAsPrivileged([
    "asset-file",
    "local-image",
    "project-file",
    "studio-skill",
    "toonflow-asset",
  ].map((scheme) => ({
    scheme,
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  })));
}

export function getProtocolMimeType(filePath: string) {
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
  };
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

export function registerProtocolHandlers({
  protocol,
  getMediaRoot,
  getDataDir,
  getSkillsRoot,
  getAssetsRoot,
  getImageThumbDir,
  createThumbCache = createImageThumbCache,
  readFile = fs.promises.readFile,
  resolveLocalMedia = resolveLocalMediaPath,
  resolveProjectFile = resolveProjectFileUrl,
  resolveAssetFile = resolveAssetFilePath,
  resolveToonflowAsset = resolveToonflowAssetPath,
}: ProtocolHandlerOptions) {
  // 异步读盘(不阻塞主进程事件环);Buffer/Uint8Array 视图直接作为
  // Response body(带 byteOffset 语义,免去逐字节拷贝——多 MB 大图 ×N
  // 并发时 Uint8Array.from 曾把主进程冻死,2026-08-25 分镜面板卡死根修)。
  const respondWithFile = async (filePath: string) =>
    // 运行时(Electron/undici)接受任意 ArrayBufferView;DOM lib 的 BodyInit
    // 泛型只认 ArrayBuffer 载体,此处视图直传,绝不做逐字节拷贝。
    new Response((await readFile(filePath)) as unknown as BodyInit, {
      headers: { "Content-Type": getProtocolMimeType(filePath) },
    });

  protocol.handle("local-image", async (request) => {
    try {
      return respondWithFile(resolveLocalMedia(getMediaRoot(), request.url));
    } catch (error) {
      console.error("Failed to load local image:", error);
      return new Response("Image not found", { status: 404 });
    }
  });

  // 展示缩略图(sips 按需生成,画布/面板 <img> 专用;角标/预判走
  // image-probe-size 探原图,不受此影响)。生成失败/未启用一律回退原图。
  let thumbCache: ImageThumbCache | null = null;
  const resolveThumb = async (filePath: string) => {
    if (!getImageThumbDir) return null;
    thumbCache ??= createThumbCache({ cacheDir: getImageThumbDir() });
    try {
      return await thumbCache.getOrCreateThumb(filePath);
    } catch {
      return null;
    }
  };

  protocol.handle("project-file", async (request) => {
    try {
      const queryIndex = request.url.indexOf("?");
      const cleanUrl = queryIndex === -1 ? request.url : request.url.slice(0, queryIndex);
      const wantsThumb =
        queryIndex !== -1 && new URLSearchParams(request.url.slice(queryIndex + 1)).has("thumb");
      const filePath = resolveProjectFile(getDataDir(), cleanUrl);
      if (wantsThumb) {
        const thumbPath = await resolveThumb(filePath);
        if (thumbPath) return respondWithFile(thumbPath);
      }
      return respondWithFile(filePath);
    } catch (error) {
      console.error("Failed to load project file:", error);
      return new Response("File not found", { status: 404 });
    }
  });

  protocol.handle("asset-file", async (request) => {
    try {
      return respondWithFile(resolveAssetFile(getAssetsRoot(), request.url));
    } catch (error) {
      // 预生成缩略图(sips 200×200 树)可能不存在:剥 query 找原图,
      // 按需缓存兜底,最后回退原图字节——绝不 404 断图。
      try {
        const queryIndex = request.url.indexOf("?");
        if (queryIndex !== -1) {
          const originalPath = resolveAssetFile(getAssetsRoot(), request.url.slice(0, queryIndex));
          const thumbPath = await resolveThumb(originalPath);
          if (thumbPath) return respondWithFile(thumbPath);
          return respondWithFile(originalPath);
        }
      } catch {
        // 走 404 分支
      }
      console.error("Failed to load asset file:", error);
      return new Response("File not found", { status: 404 });
    }
  });

  protocol.handle("studio-skill", async (request) => {
    try {
      const url = new URL(request.url);
      const relativePath = [url.hostname, ...url.pathname.split("/").filter(Boolean)]
        .map((part) => decodeURIComponent(part))
        .join("/");
      const skillsRoot = path.resolve(getSkillsRoot());
      const filePath = path.resolve(skillsRoot, relativePath);
      if (filePath !== skillsRoot && !filePath.startsWith(skillsRoot + path.sep)) {
        throw new Error("Studio skill file path escapes storage root");
      }
      return respondWithFile(filePath);
    } catch (error) {
      console.error("Failed to load studio skill file:", error);
      return new Response("File not found", { status: 404 });
    }
  });

  protocol.handle("toonflow-asset", async (request) => {
    try {
      return respondWithFile(resolveToonflowAsset(request.url));
    } catch (error) {
      console.error("Failed to load Toonflow asset:", error);
      return new Response("File not found", { status: 404 });
    }
  });
}
