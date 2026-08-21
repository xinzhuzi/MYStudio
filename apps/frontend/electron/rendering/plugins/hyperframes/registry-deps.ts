/**
 * HyperFrames Registry 依赖管理(08-21 Child1):
 * 管理从 CDN 下载到本地的特效依赖(GSAP/Three.js/D3/字体等),
 * 供 registry HTML 模板在离线环境中渲染。
 *
 * 目录规范(与 model/TTS 同款): <userData>/hyperframes-registry-deps/<pkg>/<version>/<file>
 * 下载策略: 首次使用时下载(显式,不自动),设置页提供入口。
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Google Fonts 直连不稳(SSL 被掐),loli 镜像作兜底源 */
function fontMirrorUrl(url: string): string {
  return url.replace("fonts.googleapis.com", "fonts.loli.net").replace("fonts.gstatic.com", "gstatic.loli.net");
}

async function curlToFile(url: string, targetPath: string): Promise<void> {
  // -f: HTTP 4xx/5xx 直接失败,避免把错误 body 当文件写入
  await execFileAsync("curl", ["-sfL", "--max-time", "30", "-o", targetPath, url]);
}

export interface RegistryDep {
  localPath: string;
  url: string;
}

/**
 * 解析 cdn-url-map.json 位置——dev 与打包两种路径:
 * - dev: apps/frontend/assets/hyperframes-registry/cdn-url-map.json(相对源码)
 * - 打包: Resources/hyperframes-registry/cdn-url-map.json(extraResources)
 */
function resolveMapPath(): string | null {
  const candidates = [
    // dev(从 electron/rendering/plugins/hyperframes/ 向上 5 级到 apps/)
    path.join(__dirname, "../../../../../frontend/assets/hyperframes-registry/cdn-url-map.json"),
    // 打包(从 out/main/ 到 Resources/hyperframes-registry/)
    path.join(process.resourcesPath ?? "", "hyperframes-registry", "cdn-url-map.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadUrlMap(): Record<string, string> {
  const mapPath = resolveMapPath();
  if (!mapPath) return {};
  try {
    const data = JSON.parse(fs.readFileSync(mapPath, "utf8")) as { mappings?: Record<string, string> };
    return data.mappings ?? {};
  } catch {
    return {};
  }
}

/** map 里字体条目带 ../../registry-deps/ 前缀(HTML 相对路径语义),归一化为相对 deps 根 */
function normalizeLocalPath(localPath: string): string {
  return localPath.replace(/^(\.\.\/)+registry-deps\//, "");
}

function buildDepList(): RegistryDep[] {
  const mappings = loadUrlMap();
  const deps: RegistryDep[] = [];
  const seen = new Set<string>();
  for (const [cdnUrl, localPath] of Object.entries(mappings)) {
    const normalized = normalizeLocalPath(localPath);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deps.push({ localPath: normalized, url: cdnUrl });
  }
  return deps;
}

export function getRegistryDepsDir(userDataDir: string): string {
  return path.join(userDataDir, "hyperframes-registry-deps");
}

export function listRegistryDeps(): RegistryDep[] {
  return buildDepList();
}

export function checkRegistryDepsInstalled(depsDir: string): { installed: boolean; installedCount: number; totalCount: number; missingPaths: string[] } {
  const deps = buildDepList();
  if (deps.length === 0) return { installed: false, installedCount: 0, totalCount: 0, missingPaths: ["cdn-url-map.json 不可读"] };
  const missing = deps.filter((dep) => !depFileReady(path.join(depsDir, dep.localPath)));
  return {
    installed: missing.length === 0,
    installedCount: deps.length - missing.length,
    totalCount: deps.length,
    missingPaths: missing.map((d) => d.localPath),
  };
}

/** 字体 CSS 是否已本地化:内部 url() 全为相对路径且文件实存(gstatic 外链=未完成) */
function fontCssIsLocalized(cssPath: string): boolean {
  let css: string;
  try {
    css = fs.readFileSync(cssPath, "utf8");
  } catch {
    return false;
  }
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].trim().replace(/^["']|["']$/g, ""));
  if (urls.length === 0) return false;
  return urls.every((u) => {
    if (/^https?:\/\//.test(u)) return false;
    return fs.existsSync(path.join(path.dirname(cssPath), u));
  });
}

function depFileReady(filePath: string): boolean {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return false;
  if (filePath.endsWith(".css")) return fontCssIsLocalized(filePath);
  return true;
}

/**
 * 下载字体依赖并本地化:CSS 内的字体文件本体一并下载到 _files/
 * 并改写 CSS 为相对路径——离线渲染字形不退化。
 * 直连失败自动切 loli 镜像;旧版只下了 CSS 未下本体的存量自动补齐。
 */
async function downloadFontCssDep(dep: RegistryDep, targetPath: string): Promise<boolean> {
  if (fontCssIsLocalized(targetPath)) return true;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    try {
      await curlToFile(dep.url, targetPath);
    } catch {
      await curlToFile(fontMirrorUrl(dep.url), targetPath);
    }
    const css = fs.readFileSync(targetPath, "utf8");
    const fontUrls = [...new Set([...css.matchAll(/url\((https:\/\/[^)"']+)\)/g)].map((m) => m[1]))];
    const filesDir = path.join(path.dirname(targetPath), "_files");
    for (const url of fontUrls) {
      const filename = path.basename(new URL(url).pathname);
      const fontPath = path.join(filesDir, filename);
      if (!fs.existsSync(fontPath) || fs.statSync(fontPath).size === 0) {
        fs.mkdirSync(filesDir, { recursive: true });
        try {
          await curlToFile(url, fontPath);
        } catch {
          await curlToFile(fontMirrorUrl(url), fontPath);
        }
      }
    }
    let localized = css;
    for (const url of fontUrls) {
      const filename = path.basename(new URL(url).pathname);
      localized = localized.split(url).join(`_files/${filename}`);
    }
    fs.writeFileSync(targetPath, localized, "utf8");
  } catch {
    return false;
  }
  return fontCssIsLocalized(targetPath);
}

export async function downloadRegistryDeps(
  depsDir: string,
  onProgress?: (current: number, total: number, name: string) => void,
): Promise<{ success: boolean; downloaded: number; failed: string[] }> {
  const deps = buildDepList();
  if (deps.length === 0) return { success: false, downloaded: 0, failed: ["依赖清单为空(cdn-url-map.json 不可读)"] };
  const failed: string[] = [];
  let downloaded = 0;

  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    const targetPath = path.join(depsDir, dep.localPath);
    onProgress?.(i + 1, deps.length, dep.localPath);
    if (dep.localPath.endsWith(".css")) {
      // 字体依赖:CSS + 字体本体一起本地化(depFileReady 兼容旧存量自动重下)
      if (await downloadFontCssDep(dep, targetPath)) {
        downloaded++;
      } else {
        failed.push(dep.localPath);
      }
      continue;
    }
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      downloaded++;
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    try {
      await curlToFile(dep.url, targetPath);
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
        downloaded++;
      } else {
        failed.push(dep.localPath);
      }
    } catch {
      failed.push(dep.localPath);
    }
  }
  return { success: failed.length === 0, downloaded, failed };
}
