import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isPathInsideRoots, resolveSafeLocalAssetPath } from "../../asset-safety";
import {
  createLocalAccountVault,
  isLocalOAuthAccountCredential,
  type LocalAccountRecord,
  type LocalAccountVault,
  type LocalOAuthAccountCredential,
} from "../../../../local-account-vault";
import type { PlatformAccountInput } from "../platform-adapter";
import type { PlatformAccountStatus } from "../platform-types";
import type { OfficialPlatformConfig, OfficialPlatformId } from "./platform-config";
import { openOAuthAuthorizationWindow, type OAuthWindowRequest } from "./oauth-window";

export interface OfficialTransportRuntime {
  config: OfficialPlatformConfig;
  vault: LocalAccountVault;
  fetch: typeof fetch;
  authorize: (request: OAuthWindowRequest) => Promise<URL>;
  now: () => Date;
  allowedAssetRoots?: () => readonly string[];
}

export interface OfficialTransportRuntimeOptions {
  config: OfficialPlatformConfig;
  userDataPath: string;
  fetch?: typeof fetch;
  authorize?: (request: OAuthWindowRequest) => Promise<URL>;
  now?: () => Date;
  allowedAssetRoots?: () => readonly string[];
}

export function createOfficialTransportRuntime(options: OfficialTransportRuntimeOptions): OfficialTransportRuntime {
  return {
    config: options.config,
    vault: createLocalAccountVault(options.userDataPath),
    fetch: options.fetch ?? fetch,
    authorize: options.authorize ?? openOAuthAuthorizationWindow,
    now: options.now ?? (() => new Date()),
    allowedAssetRoots: options.allowedAssetRoots,
  };
}

export function officialAccountId(platformId: OfficialPlatformId, providerAccountId: string): string {
  const digest = createHash("sha256").update(`${platformId}:${providerAccountId}`).digest("hex").slice(0, 20);
  return `aitoearn-local:${platformId}:${digest}`;
}

function oauthCredentialStatus(
  credential: LocalOAuthAccountCredential,
  now: Date,
): PlatformAccountStatus {
  if (!credential.expiresAt) return "error";
  const expiresAt = Date.parse(credential.expiresAt);
  if (!Number.isFinite(expiresAt)) return "error";
  return expiresAt > now.getTime() ? "online" : "expired";
}

export async function saveOfficialAccount(
  runtime: OfficialTransportRuntime,
  account: Omit<LocalAccountRecord, "id" | "platform" | "updatedAt" | "credential"> & {
    providerAccountId: string;
    credential: LocalOAuthAccountCredential;
  },
): Promise<LocalAccountRecord> {
  const record: LocalAccountRecord = {
    id: officialAccountId(runtime.config.platformId, account.providerAccountId),
    platform: runtime.config.platformId,
    providerAccountId: account.providerAccountId,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    credential: account.credential,
    updatedAt: runtime.now().toISOString(),
  };
  await runtime.vault.upsert(record);
  return record;
}

export async function getOfficialAccount(
  runtime: OfficialTransportRuntime,
  accountId: string,
): Promise<LocalAccountRecord & { credential: LocalOAuthAccountCredential }> {
  const record = await runtime.vault.get(accountId);
  if (!record || record.platform !== runtime.config.platformId || !isLocalOAuthAccountCredential(record.credential)) {
    throw new Error(`${runtime.config.platformId} OAuth 账号不存在或凭据无效`);
  }
  const status = oauthCredentialStatus(record.credential, runtime.now());
  if (status === "expired") throw new Error(`${runtime.config.platformId} OAuth 凭据已过期，请重新登录`);
  if (status === "error") {
    const reason = record.credential.expiresAt ? "到期时间无效" : "缺少到期时间";
    throw new Error(`${runtime.config.platformId} OAuth 凭据${reason}，请重新登录`);
  }
  return record as LocalAccountRecord & { credential: LocalOAuthAccountCredential };
}

export function requireProviderAccountId(account: LocalAccountRecord): string {
  if (!account.providerAccountId?.trim()) {
    throw new Error(`${account.platform} 平台账号 ID 缺失，请重新登录`);
  }
  return account.providerAccountId;
}

export async function listOfficialAccounts(runtime: OfficialTransportRuntime): Promise<PlatformAccountInput[]> {
  const summaries = await runtime.vault.list();
  return Promise.all(summaries
    .filter((account) => account.platform === runtime.config.platformId)
    .map(async (account) => {
      const record = await runtime.vault.get(account.id);
      const status = record
        && record.platform === runtime.config.platformId
        && isLocalOAuthAccountCredential(record.credential)
        ? oauthCredentialStatus(record.credential, runtime.now())
        : "error";
      return {
        accountId: account.id,
        displayName: account.displayName,
        ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
        status,
      };
    }));
}

export async function requestJson<T>(runtime: OfficialTransportRuntime, url: string, init?: RequestInit): Promise<T> {
  const response = await runtime.fetch(url, init);
  const body = await response.text();
  let parsed: unknown = null;
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    throw new Error(`${runtime.config.platformId} API 请求失败 (${response.status})`);
  }
  return parsed as T;
}

const MAX_ASSET_BYTES = 512 * 1024 * 1024;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export interface OfficialAssetBytes {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

function assetMetadata(url: string, contentType?: string | null) {
  const pathname = path.isAbsolute(url) ? url : new URL(url).pathname;
  const filename = path.basename(pathname) || "asset.bin";
  return {
    filename,
    contentType: contentType?.split(";", 1)[0]?.trim()
      || CONTENT_TYPES[path.extname(filename).toLowerCase()]
      || "application/octet-stream",
  };
}

export async function readOfficialAsset(runtime: OfficialTransportRuntime, url: string): Promise<OfficialAssetBytes> {
  if (path.isAbsolute(url)) {
    const allowedRoots = runtime.allowedAssetRoots?.() ?? [];
    const lexicalPath = resolveSafeLocalAssetPath(url, allowedRoots);
    if (!lexicalPath) throw new Error("平台本地资产路径不在受控存储目录内");
    const canonicalPath = await fs.realpath(lexicalPath);
    const canonicalRoots = (await Promise.all(allowedRoots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        return null;
      }
    }))).filter((root): root is string => root !== null);
    if (!isPathInsideRoots(canonicalPath, canonicalRoots)) {
      throw new Error("平台本地资产路径不在受控存储目录内");
    }
    const stat = await fs.stat(canonicalPath);
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) throw new Error("平台资产无效或超过 512MB 限制");
    const bytes = await fs.readFile(canonicalPath);
    return { bytes, ...assetMetadata(canonicalPath) };
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("官方平台资产只允许受控本地文件或 HTTPS URL");
  const response = await runtime.fetch(parsed);
  if (!response.ok) throw new Error(`${runtime.config.platformId} 资产读取失败 (${response.status})`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ASSET_BYTES) throw new Error("平台资产超过 512MB 限制");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("平台资产超过 512MB 限制");
  return { bytes, ...assetMetadata(url, response.headers.get("content-type")) };
}

export function requireHttpsAssetUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("该平台要求可公网访问的 HTTPS 媒体 URL");
  return parsed.toString();
}
