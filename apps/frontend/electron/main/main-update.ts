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

type GitHubLatestRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
};

/**
 * 更新清单事实源 = 本仓库 GitHub Releases:发版打 tag 即生效,无需自建清单服务器。
 * api.github.com 的 latest release 响应映射为 UpdateManifest(tag→version,
 * body→releaseNotes,html_url→githubUrl,过 sanitizeUpdateDownloadUrl 域白名单)。
 */
function isGitHubReleasesApiUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "api.github.com" && parsed.pathname.startsWith("/repos/");
  } catch {
    return false;
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mapGitHubLatestRelease(
  release: GitHubLatestRelease,
): Partial<UpdateManifest> {
  return {
    version: readOptionalString(release.tag_name) ?? readOptionalString(release.name),
    releaseNotes: readOptionalString(release.body),
    publishedAt: readOptionalString(release.published_at),
    githubUrl: readOptionalString(release.html_url),
  };
}

async function fetchGitHubLatestReleaseManifest(
  manifestUrl: string,
): Promise<UpdateManifest> {
  const response = await net.fetch(manifestUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "manying-studio-updater",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub release 请求失败 (${response.status})`);
  }
  const release = (await response.json()) as GitHubLatestRelease;
  return normalizeUpdateManifest(mapGitHubLatestRelease(release));
}

export async function fetchUpdateManifest(config: PackageUpdateConfig) {
  const manifestUrl = getUpdateManifestUrl(config);
  if (!manifestUrl) {
    throw new Error("未配置版本清单地址");
  }
  if (isGitHubReleasesApiUrl(manifestUrl)) {
    return fetchGitHubLatestReleaseManifest(manifestUrl);
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
