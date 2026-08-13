/**
 * main.ts 版本更新工具 — 从 main.ts 拆出(08-11-structure-refactor)。
 *
 * 提取自包含的更新清单抓取/判定函数:
 * 1. fetchUpdateManifest(config) —— 通过参数接收 packageUpdateConfig,
 *    不再关闭 main.ts 模块级常量。
 * 2. resolveAvailableUpdate(config, currentVersion) —— 同上。
 *
 * 行为与原 main.ts 内联实现逐字节一致(packageUpdateConfig → config 参数)。
 * PackageUpdateConfig 类型从 main.ts 原样复制(verbatim)。
 */
import { net } from "electron";
import type { AvailableUpdateInfo, UpdateManifest } from "../../types/update";
import {
  compareVersions,
  normalizeUpdateManifest,
} from "../runtime/update-policy";
import {
  getDefaultBaiduCode,
  getDefaultBaiduUrl,
  getDefaultGithubUrl,
  getUpdateManifestUrl,
} from "./main-utils";

/** package.json updateConfig 视图(与 main.ts 的 PackageUpdateConfig 一致)。 */
type PackageUpdateConfig = {
  manifestUrl?: string;
  defaultGithubUrl?: string;
  defaultBaiduUrl?: string;
  defaultBaiduCode?: string;
};

export async function fetchUpdateManifest(config: PackageUpdateConfig) {
  const manifestUrl = getUpdateManifestUrl(config);
  if (!manifestUrl) {
    throw new Error("未配置版本清单地址");
  }

  const requestUrl = new URL(manifestUrl);
  requestUrl.searchParams.set("_ts", Date.now().toString());

  const response = await net.fetch(requestUrl.toString());
  if (!response.ok) {
    throw new Error(`版本清单请求失败 (${response.status})`);
  }

  const rawManifest = (await response.json()) as Partial<UpdateManifest>;
  return normalizeUpdateManifest(rawManifest, {
    githubUrl: getDefaultGithubUrl(config),
    baiduUrl: getDefaultBaiduUrl(config),
    baiduCode: getDefaultBaiduCode(config),
  });
}

export async function resolveAvailableUpdate(
  config: PackageUpdateConfig,
  currentVersion: string,
): Promise<AvailableUpdateInfo | null> {
  const manifest = await fetchUpdateManifest(config);
  if (compareVersions(manifest.version, currentVersion) <= 0) {
    return null;
  }

  return {
    currentVersion,
    latestVersion: manifest.version,
    releaseNotes: manifest.releaseNotes,
    publishedAt: manifest.publishedAt,
    githubUrl: manifest.githubUrl,
    baiduUrl: manifest.baiduUrl,
    baiduCode: manifest.baiduCode,
  };
}
