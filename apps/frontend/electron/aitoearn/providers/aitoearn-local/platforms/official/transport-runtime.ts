import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isPathInsideRoots, resolveSafeLocalAssetPath } from "../../asset-safety";
import { assertSafeOutboundRequestUrl } from "../../../../../security/request-url-guard";
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

interface RefreshTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  data?: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
}

function basicAuthHeader(runtime: OfficialTransportRuntime): string {
  if (!runtime.config.clientSecret) throw new Error(`${runtime.config.platformId} client secret 未配置`);
  return `Basic ${Buffer.from(`${runtime.config.clientId}:${runtime.config.clientSecret}`).toString("base64")}`;
}

async function requestRefreshedCredential(
  runtime: OfficialTransportRuntime,
  credential: LocalOAuthAccountCredential,
): Promise<LocalOAuthAccountCredential> {
  const refreshToken = credential.refreshToken;
  if (!refreshToken) throw new Error("缺少 refresh token");
  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
  let url: string;
  let headers: Record<string, string> = formHeaders;
  let body: Record<string, string>;
  switch (runtime.config.platformId) {
    case "googleBusiness":
    case "youtube":
      url = "https://oauth2.googleapis.com/token";
      body = { grant_type: "refresh_token", refresh_token: refreshToken, client_id: runtime.config.clientId };
      if (runtime.config.clientSecret) body.client_secret = runtime.config.clientSecret;
      break;
    case "linkedin":
      url = "https://www.linkedin.com/oauth/v2/accessToken";
      body = { grant_type: "refresh_token", refresh_token: refreshToken, client_id: runtime.config.clientId };
      if (runtime.config.clientSecret) body.client_secret = runtime.config.clientSecret;
      break;
    case "tiktok":
      url = "https://open.tiktokapis.com/v2/oauth/token/";
      body = { grant_type: "refresh_token", refresh_token: refreshToken, client_key: runtime.config.clientId };
      if (runtime.config.clientSecret) body.client_secret = runtime.config.clientSecret;
      break;
    case "twitter":
      url = "https://api.twitter.com/2/oauth2/token";
      if (runtime.config.clientSecret) headers = { ...formHeaders, authorization: basicAuthHeader(runtime) };
      body = { grant_type: "refresh_token", refresh_token: refreshToken, client_id: runtime.config.clientId };
      break;
    case "pinterest":
      url = "https://api.pinterest.com/v5/oauth/token";
      headers = { ...formHeaders, authorization: basicAuthHeader(runtime) };
      body = { grant_type: "refresh_token", refresh_token: refreshToken, continuous_refresh: "true" };
      break;
    case "bilibili":
      url = "https://api.bilibili.com/x/account-oauth2/v1/token";
      body = { grant_type: "refresh_token", refresh_token: refreshToken, client_id: runtime.config.clientId };
      if (runtime.config.clientSecret) body.client_secret = runtime.config.clientSecret;
      break;
    default:
      throw new Error(`${runtime.config.platformId} 不支持 OAuth 自动续期`);
  }
  const response = await requestJson<RefreshTokenResponse>(runtime, url, {
    method: "POST",
    headers,
    body: new URLSearchParams(body),
  });
  const token = response.data ?? response;
  if (!token.access_token) throw new Error(`${runtime.config.platformId} 续期响应缺少 access token`);
  return {
    kind: "oauth",
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? refreshToken,
    expiresAt: typeof token.expires_in === "number" && token.expires_in > 0
      ? new Date(runtime.now().getTime() + token.expires_in * 1000).toISOString()
      : undefined,
    scope: token.scope ?? credential.scope,
    tokenType: credential.tokenType,
  };
}

// 并发发布/轮询可能同时撞上过期凭据:按账号去重,避免重复续期把轮换后的
// refresh token 用废(部分平台 refresh token 一次性)。
const refreshOperations = new Map<string, Promise<LocalOAuthAccountCredential>>();

async function refreshStoredCredential(
  runtime: OfficialTransportRuntime,
  record: LocalAccountRecord & { credential: LocalOAuthAccountCredential },
): Promise<LocalAccountRecord & { credential: LocalOAuthAccountCredential }> {
  const key = `${runtime.config.platformId}:${record.id}`;
  let pending = refreshOperations.get(key);
  if (!pending) {
    pending = requestRefreshedCredential(runtime, record.credential)
      .then(async (credential) => {
        await runtime.vault.upsert({ ...record, credential, updatedAt: runtime.now().toISOString() });
        return credential;
      })
      .finally(() => { refreshOperations.delete(key); });
    refreshOperations.set(key, pending);
  }
  const credential = await pending;
  return { ...record, credential };
}

function credentialFailure(platformId: OfficialPlatformId, status: PlatformAccountStatus, credential: LocalOAuthAccountCredential): string {
  if (status === "expired") return `${platformId} OAuth 凭据已过期`;
  const reason = credential.expiresAt ? "到期时间无效" : "缺少到期时间";
  return `${platformId} OAuth 凭据${reason}`;
}

function credentialError(platformId: OfficialPlatformId, status: PlatformAccountStatus, credential: LocalOAuthAccountCredential): Error {
  return new Error(`${credentialFailure(platformId, status, credential)}，请重新登录`);
}

export async function getOfficialAccount(
  runtime: OfficialTransportRuntime,
  accountId: string,
): Promise<LocalAccountRecord & { credential: LocalOAuthAccountCredential }> {
  const record = await runtime.vault.get(accountId);
  if (!record || record.platform !== runtime.config.platformId || !isLocalOAuthAccountCredential(record.credential)) {
    throw new Error(`${runtime.config.platformId} OAuth 账号不存在或凭据无效`);
  }
  const account = record as LocalAccountRecord & { credential: LocalOAuthAccountCredential };
  const status = oauthCredentialStatus(account.credential, runtime.now());
  if (status === "online") return account;
  if (!account.credential.refreshToken) throw credentialError(runtime.config.platformId, status, account.credential);
  let refreshed: LocalAccountRecord & { credential: LocalOAuthAccountCredential };
  const failure = credentialFailure(runtime.config.platformId, status, account.credential);
  try {
    refreshed = await refreshStoredCredential(runtime, account);
  } catch {
    throw new Error(`${failure}，自动续期失败，请重新登录`);
  }
  if (oauthCredentialStatus(refreshed.credential, runtime.now()) !== "online") {
    throw new Error(`${failure}，自动续期未取得有效凭据，请重新登录`);
  }
  return refreshed;
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
      const oauthRecord = record
        && record.platform === runtime.config.platformId
        && isLocalOAuthAccountCredential(record.credential)
        ? record as LocalAccountRecord & { credential: LocalOAuthAccountCredential }
        : null;
      let status: PlatformAccountStatus = oauthRecord ? oauthCredentialStatus(oauthRecord.credential, runtime.now()) : "error";
      if (oauthRecord && status !== "online" && oauthRecord.credential.refreshToken) {
        try {
          const refreshed = await refreshStoredCredential(runtime, oauthRecord);
          status = oauthCredentialStatus(refreshed.credential, runtime.now());
        } catch {
          // 续期失败保持原状态,不阻断账号列表
        }
      }
      return {
        accountId: account.id,
        displayName: account.displayName,
        ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
        status,
      };
    }));
}


/** 09-10 P1:外部调用缺省超时——慢滴流主机曾让发布 promise 永挂,级联 dispose() 退出死锁。 */
function withDefaultTimeout(init: RequestInit | undefined, timeoutMs: number): RequestInit {
  if (init?.signal) return init;
  return { ...init, signal: AbortSignal.timeout(timeoutMs) };
}

export async function requestJson<T>(runtime: OfficialTransportRuntime, url: string, init?: RequestInit): Promise<T> {
  const response = await runtime.fetch(url, withDefaultTimeout(init, 30_000));
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
  const safeUrl = assertSafeOutboundRequestUrl(parsed.toString());
  const response = await runtime.fetch(safeUrl, { signal: AbortSignal.timeout(10 * 60_000) });
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
