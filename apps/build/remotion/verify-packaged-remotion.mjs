import fs from "node:fs";
import path from "node:path";
import { listPackage } from "@electron/asar";

const forbiddenAsarPathPrefixes = [
  "node_modules/@remotion/bundler/",
  "node_modules/@remotion/cli/",
  ".agents/skills/",
  ".codex/skills/",
];

const forbiddenAsarFiles = new Set([
  "skills-lock.json",
  ".agents/skills-lock.json",
  ".codex/skills-lock.json",
]);

export function inspectPackagedRemotionApp(appPath, options = {}) {
  if (typeof appPath !== "string" || !path.isAbsolute(appPath)) {
    throw new Error("应用路径必须是绝对路径");
  }
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const appAsarPath = path.join(resourcesPath, "app.asar");
  const bundlePath = path.join(resourcesPath, "remotion-bundle");
  const manifestPath = path.join(bundlePath, "manifest.json");
  const bundleEntryPath = path.join(bundlePath, "bundle.js");
  const bundleSourceMapPath = path.join(bundlePath, "bundle.js.map");
  const compositorPath = path.join(
    resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@remotion",
    "compositor-darwin-arm64",
  );
  const manifest = readJson(manifestPath, "Remotion bundle manifest");
  if (manifest.schemaVersion !== 1
    || typeof manifest.remotionVersion !== "string"
    || typeof manifest.compositionId !== "string"
    || !/^[a-f0-9]{64}$/.test(String(manifest.contentHash))) {
    throw new Error(`Remotion bundle manifest 无效: ${manifestPath}`);
  }
  const missingBundleFiles = [bundleEntryPath, bundleSourceMapPath]
    .filter((filePath) => !isFile(filePath))
    .map((filePath) => path.basename(filePath));
  if (missingBundleFiles.length > 0) {
    throw new Error(`Remotion bundle 缺少文件: ${missingBundleFiles.join(", ")}`);
  }
  const requiredCompositorFiles = ["ffmpeg", "ffprobe", "remotion"];
  const missingCompositorFiles = requiredCompositorFiles.filter(
    (fileName) => !isFile(path.join(compositorPath, fileName)),
  );
  if (missingCompositorFiles.length > 0) {
    throw new Error(`macOS arm64 compositor 缺少文件: ${missingCompositorFiles.join(", ")}`);
  }
  if (!isFile(appAsarPath)) {
    throw new Error(`app.asar不存在: ${appAsarPath}`);
  }
  const asarEntries = readAsarEntries(appAsarPath, options.listAsarEntries);
  const forbiddenEntries = asarEntries.filter(isForbiddenAsarEntry);
  if (forbiddenEntries.length > 0) {
    throw new Error(`安装包包含禁止的 Remotion 开发/浏览器资源: ${forbiddenEntries.join(", ")}`);
  }
  return {
    appPath,
    resourcesPath,
    appAsarPath,
    bundlePath,
    manifestPath,
    bundleEntryPath,
    bundleSourceMapPath,
    compositorPath,
    manifest,
  };
}

function readAsarEntries(appAsarPath, listAsarEntries = listPackage) {
  try {
    const entries = listAsarEntries(appAsarPath);
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      throw new Error("asar 目录表必须是字符串数组");
    }
    return entries;
  } catch (error) {
    throw new Error(`app.asar无法检查: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isForbiddenAsarEntry(entry) {
  const normalized = entry.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
  return normalized.includes("headless-shell")
    || forbiddenAsarFiles.has(normalized)
    || forbiddenAsarPathPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function readJson(filePath, label) {
  if (!isFile(filePath)) throw new Error(`${label}不存在: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label}无法解析: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const appPath = process.argv[2];
  if (!appPath) {
    console.error("用法: node build/remotion/verify-packaged-remotion.mjs <应用.app>");
    process.exitCode = 1;
  } else {
    try {
      const result = inspectPackagedRemotionApp(path.resolve(appPath));
      console.log(`Packaged Remotion runtime verified: ${result.manifest.remotionVersion}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
