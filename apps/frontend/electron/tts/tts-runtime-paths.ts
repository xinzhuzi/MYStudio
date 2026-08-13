/**
 * tts-runtime 路径与文件系统纯工具函数 — 从 tts-runtime.ts 拆出(08-11-structure-refactor)。
 *
 * 这些函数处理路由/路径规整、HF Hub 缓存解析、SHA-256 校验与目录覆盖判定,
 * 无 TTS 运行时依赖,提取到独立文件降低 tts-runtime.ts 主文件行数。
 */

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export function normalizeRoutePath(routePath: string) {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

export function sidecarMainPath(sidecarRoot: string) {
  return path.join(sidecarRoot, "tts", "main.py");
}

export function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))];
}

export function expandHome(inputPath: string) {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

export function normalizeUserPath(inputPath: string) {
  return path.resolve(expandHome(inputPath.trim()));
}

export function resolveHfHubCacheDir(modelCacheDir: string, fileExists: (filePath: string) => boolean) {
  if (path.basename(modelCacheDir) === "huggingface") {
    return path.join(modelCacheDir, "hub");
  }
  if (path.basename(modelCacheDir) !== "hub" && fileExists(path.join(modelCacheDir, "hub"))) {
    return path.join(modelCacheDir, "hub");
  }
  return modelCacheDir;
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function directoryIsCoveredBy(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const source = fs.lstatSync(sourcePath);
    const target = fs.lstatSync(targetPath);
    if (source.isSymbolicLink() || target.isSymbolicLink()) {
      return source.isSymbolicLink()
        && target.isSymbolicLink()
        && fs.readlinkSync(sourcePath) === fs.readlinkSync(targetPath);
    }
    if (source.isDirectory() || target.isDirectory()) {
      if (!source.isDirectory() || !target.isDirectory()) return false;
      const targetEntries = new Set(fs.readdirSync(targetPath));
      for (const entry of fs.readdirSync(sourcePath)) {
        if (!targetEntries.has(entry)) return false;
        if (!await directoryIsCoveredBy(path.join(sourcePath, entry), path.join(targetPath, entry))) return false;
      }
      return true;
    }
    if (!source.isFile() || !target.isFile() || source.size !== target.size) return false;
    return (await sha256File(sourcePath)) === (await sha256File(targetPath));
  } catch {
    return false;
  }
}
