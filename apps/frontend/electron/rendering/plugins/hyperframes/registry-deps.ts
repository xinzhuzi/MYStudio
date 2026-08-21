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

function buildDepList(): RegistryDep[] {
  const mappings = loadUrlMap();
  const deps: RegistryDep[] = [];
  const seen = new Set<string>();
  for (const [cdnUrl, localPath] of Object.entries(mappings)) {
    if (seen.has(localPath)) continue;
    seen.add(localPath);
    deps.push({ localPath, url: cdnUrl });
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
  const missing = deps.filter((dep) => !fs.existsSync(path.join(depsDir, dep.localPath)));
  return {
    installed: missing.length === 0,
    installedCount: deps.length - missing.length,
    totalCount: deps.length,
    missingPaths: missing.map((d) => d.localPath),
  };
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
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      downloaded++;
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    try {
      onProgress?.(i + 1, deps.length, dep.localPath);
      await execFileAsync("curl", ["-sL", "--max-time", "30", "-o", targetPath, dep.url]);
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
