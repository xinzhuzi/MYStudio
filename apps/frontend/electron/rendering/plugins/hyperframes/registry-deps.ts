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

/** 依赖清单:从 cdn-url-map.json 的本地路径推导 */
export interface RegistryDep {
  /** 本地相对路径(相对 registry-deps 根) */
  localPath: string;
  /** 下载源 URL */
  url: string;
  /** 文件大小估算(bytes) */
  approxSize: number;
}

/** 依赖清单从 cdn-url-map.json 动态构建(单源,不硬编码 URL)。 */

function buildDepList(): RegistryDep[] {
  const deps: RegistryDep[] = [];
  const seen = new Set<string>();

  // 读 cdn-url-map.json 获取所有需要的本地路径
  const mapPath = path.join(__dirname, "../../../../assets/hyperframes-registry/cdn-url-map.json");
  if (!fs.existsSync(mapPath)) return deps;
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8")) as { mappings: Record<string, string> };

  for (const [cdnUrl, localPath] of Object.entries(map.mappings)) {
    if (seen.has(localPath)) continue;
    seen.add(localPath);
    deps.push({
      localPath,
      url: cdnUrl,
      approxSize: 100_000, // 100KB 默认估算
    });
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
  const failed: string[] = [];
  let downloaded = 0;

  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    const targetPath = path.join(depsDir, dep.localPath);
    if (fs.existsSync(targetPath)) {
      downloaded++;
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    try {
      onProgress?.(i + 1, deps.length, dep.localPath);
      // 用 curl 下载(系统自带,无 Node fetch 大文件问题)
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
