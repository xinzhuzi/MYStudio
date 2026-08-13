/* eslint-disable no-console -- 日志基础设施:包装/恢复 console 方法 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  getSelfMediaCapabilities,
  isSelfMediaPublishable,
} from "../../../../lib/self-media/capabilities";
import type { SelfMediaAccount, SelfMediaDraft, SelfMediaPlatform } from "../../../../types/self-media";
import {
  SelfMediaProviderError,
  type AitoearnLocalPlatformBridge,
  type SelfMediaProviderPublishContext,
  type SelfMediaProviderTaskResult,
} from "../../provider-registry";
import { createLocalAccountVault, isLocalSessionAccountCredential, type LocalAccountCredential, type LocalAccountRecord } from "../../local-account-vault";
import { parseSafeRemoteAssetUrl, resolveSafeLocalAssetPath } from "./asset-safety";
import {
  createPlatformAdapterRegistry,
  PlatformAdapterError,
  type PlatformAdapterTransport,
  type PlatformId,
  type PlatformTaskProjection,
} from "./platforms";
import { xiaohongshuService } from "@aitoearn/xhs";
import { douyinService } from "@aitoearn/douyin";
import { shipinhaoService } from "@aitoearn/wx";
import { kwaiPub } from "@aitoearn/kwai";
import {
  withDestroyedWindowDevToolsGuard,
  withLoginWindowCloseCancellation,
} from "./compatibility/login-window";

type LocalPlatform = Extract<SelfMediaPlatform, "xhs" | "douyin" | "wxSph" | "KWAI">;
type Cookie = Electron.Cookie;

const PLATFORM_NAMES: Record<LocalPlatform, string> = {
  xhs: "小红书",
  douyin: "抖音",
  wxSph: "视频号",
  KWAI: "快手",
};

function isLocalPlatform(value: SelfMediaPlatform): value is LocalPlatform {
  return value === "xhs" || value === "douyin" || value === "wxSph" || value === "KWAI";
}

function isKnownPlatform(value: unknown): value is SelfMediaPlatform {
  return typeof value === "string" && Boolean(getSelfMediaCapabilities("aitoearn-local", value as SelfMediaPlatform));
}

function parseCookies(value: unknown): Cookie[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("平台凭据格式无效");
  return parsed.filter((cookie): cookie is Cookie => Boolean(cookie && typeof cookie === "object" && typeof (cookie as { name?: unknown }).name === "string" && typeof (cookie as { value?: unknown }).value === "string"));
}

function identityFromUserInfo(userInfo: unknown, fallback: string) {
  if (!userInfo || typeof userInfo !== "object") return fallback;
  const value = userInfo as Record<string, unknown>;
  const nested = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value;
  const user = nested.userInfo && typeof nested.userInfo === "object" ? nested.userInfo as Record<string, unknown> : nested.user as Record<string, unknown> | undefined;
  const identity = [value.authorId, value.uid, value.userId, value.id, nested.authorId, nested.uid, nested.userId, nested.id, user?.userId, user?.id].find((item): item is string | number => typeof item === "string" || typeof item === "number");
  return identity === undefined ? fallback : String(identity);
}

function displayNameFromUserInfo(userInfo: unknown, fallback: string) {
  if (!userInfo || typeof userInfo !== "object") return fallback;
  const value = userInfo as Record<string, unknown>;
  const nested = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value;
  const user = nested.userInfo && typeof nested.userInfo === "object" ? nested.userInfo as Record<string, unknown> : nested.user as Record<string, unknown> | undefined;
  const name = [value.nickname, value.name, nested.nickname, nested.name, user?.name, user?.nickname].find((item): item is string => typeof item === "string" && item.trim().length > 0);
  return name?.trim() || fallback;
}

function avatarFromUserInfo(userInfo: unknown) {
  if (!userInfo || typeof userInfo !== "object") return undefined;
  const value = userInfo as Record<string, unknown>;
  const nested = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value;
  const user = nested.userInfo && typeof nested.userInfo === "object" ? nested.userInfo as Record<string, unknown> : nested.user as Record<string, unknown> | undefined;
  const avatar = [value.avatar, value.avatarUrl, nested.avatar, nested.avatarUrl, user?.avatar].find((item): item is string => typeof item === "string" && item.startsWith("http"));
  return avatar;
}

function accountId(platform: LocalPlatform, identity: string) {
  const digest = createHash("sha256").update(`${platform}:${identity}`).digest("hex").slice(0, 20);
  return `aitoearn-local:${platform}:${digest}`;
}

function toAccount(record: LocalAccountRecord, status: SelfMediaAccount["status"], errorCode?: string): SelfMediaAccount {
  const capabilities = getSelfMediaCapabilities("aitoearn-local", record.platform);
  if (!capabilities) throw new Error(`未注册的平台能力：${record.platform}`);
  return {
    id: record.id,
    providerId: "aitoearn-local",
    platform: record.platform,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    status,
    capabilities,
    lastCheckedAt: new Date().toISOString(),
    errorCode,
  };
}

function credentialCookies(credential: LocalAccountCredential) {
  if (!isLocalSessionAccountCredential(credential)) {
    throw new SelfMediaProviderError("aitoearn-local", "credential-invalid", "本地平台凭据类型无效，请重新登录", false);
  }
  try {
    return parseCookies(credential.cookies);
  } catch {
    throw new SelfMediaProviderError("aitoearn-local", "credential-invalid", "本地平台凭据已损坏，请重新登录", false);
  }
}

function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return "[redacted]";
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = /cookie|token|secret|password|privatekey|webprotect|authorization|localstorage/i.test(key) ? "[redacted]" : redactValue(child, seen);
  }
  return result;
}

let credentialRedactionQueue = Promise.resolve();

async function withCredentialRedaction<T>(operation: () => Promise<T>) {
  let releaseQueue: () => void = () => undefined;
  const previous = credentialRedactionQueue;
  credentialRedactionQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
  await previous;
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    trace: console.trace,
  };
  const wrap = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args.map((item) => redactValue(item)));
  console.log = wrap(original.log);
  console.error = wrap(original.error);
  console.warn = wrap(original.warn);
  console.info = wrap(original.info);
  console.debug = wrap(original.debug);
  console.trace = wrap(original.trace);
  try {
    return await operation();
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
    console.info = original.info;
    console.debug = original.debug;
    console.trace = original.trace;
    releaseQueue();
  }
}

async function materializeAsset(url: string, tempFiles: string[], allowedAssetRoots: readonly string[], allowedRemoteAssetHosts: readonly string[]) {
  if (path.isAbsolute(url)) {
    const resolved = resolveSafeLocalAssetPath(url, allowedAssetRoots);
    if (!resolved) throw new Error("本地资产路径不在受控存储目录内");
    return resolved;
  }
  const parsedUrl = parseSafeRemoteAssetUrl(url);
  if (!parsedUrl || !allowedRemoteAssetHosts.includes(parsedUrl.hostname.toLowerCase())) {
    throw new Error("远程资产域名未获准，平台只接受受控的本地资产或白名单 HTTPS URL");
  }
  const response = await fetch(parsedUrl.toString());
  if (!response.ok) throw new Error(`资产下载失败 (${response.status})`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 512 * 1024 * 1024) throw new Error("资产超过 512MB 限制");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > 512 * 1024 * 1024) throw new Error("资产超过 512MB 限制");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-self-media-"));
  const extension = new URL(url).pathname.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ".bin";
  const filePath = path.join(directory, `asset${extension}`);
  await fs.writeFile(filePath, body, { mode: 0o600 });
  tempFiles.push(directory);
  return filePath;
}

function visibilityForXhs(value: SelfMediaDraft["visibility"]): 0 | 1 | 4 {
  return value === "private" ? 1 : value === "friends" ? 4 : 0;
}

function visibilityForDouyin(value: SelfMediaDraft["visibility"]): 0 | 1 | 2 {
  return value === "private" ? 1 : value === "friends" ? 2 : 0;
}

function visibilityForKwai(value: SelfMediaDraft["visibility"]): 1 | 2 | 4 {
  return value === "private" ? 2 : value === "friends" ? 4 : 1;
}

function normalizeResult(result: unknown): SelfMediaProviderTaskResult {
  const value = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const publishId = [value.publishId, value.lastPublishId, value.photoIdStr, value.itemId].find((item): item is string => typeof item === "string" && item.length > 0);
  const shareLink = [value.shareLink, value.previewVideoLink].find((item): item is string => typeof item === "string" && /^https?:\/\//.test(item));
  return { status: "success", progress: 100, providerTaskId: publishId, resultUrl: shareLink };
}

function projectOfficialTask(result: PlatformTaskProjection): SelfMediaProviderTaskResult {
  return {
    status: result.status,
    progress: result.progress,
    providerTaskId: result.providerTaskId ?? result.taskId,
    resultUrl: result.resultUrl,
    error: result.error
      ? { ...result.error, providerId: "aitoearn-local" }
      : undefined,
  };
}

function officialProviderError(error: unknown): never {
  if (error instanceof PlatformAdapterError) {
    throw new SelfMediaProviderError("aitoearn-local", "platform-transport-unavailable", error.message, false);
  }
  throw error;
}

export function createAitoearnLocalPlatformBridge(bridgeOptions: {
  userDataPath: string;
  allowedAssetRoots?: () => readonly string[];
  allowedRemoteAssetHosts?: () => readonly string[];
  platformTransports?: Partial<Record<PlatformId, PlatformAdapterTransport>>;
}): AitoearnLocalPlatformBridge {
  const vault = createLocalAccountVault(bridgeOptions.userDataPath);
  const platformRegistry = createPlatformAdapterRegistry(bridgeOptions.platformTransports);
  const availablePlatforms: SelfMediaPlatform[] = [
    "douyin",
    "xhs",
    "wxSph",
    "KWAI",
    ...Object.keys(bridgeOptions.platformTransports ?? {}) as PlatformId[],
  ];

  async function listAccounts() {
    const summaries = await vault.list();
    const accounts: SelfMediaAccount[] = [];
    for (const summary of summaries) {
      const record = await vault.get(summary.id);
      if (!record) {
        accounts.push(toAccount({ ...summary, credential: { cookies: [] } }, "error", "credential-unavailable"));
        continue;
      }
      try {
        if (!isLocalPlatform(record.platform)) {
          continue;
        }
        const cookies = credentialCookies(record.credential);
        const online = await checkOnline(record.platform, cookies);
        accounts.push(toAccount(record, online ? "online" : "expired", online ? undefined : "login-expired"));
      } catch {
        accounts.push(toAccount(record, "error", "account-check-failed"));
      }
    }
    for (const manifest of platformRegistry.list()) {
      if (isLocalPlatform(manifest.id)) continue;
      const adapter = platformRegistry.get(manifest.id);
      if (!adapter) continue;
      try {
        const projected = await adapter.listAccounts();
        const capabilities = getSelfMediaCapabilities("aitoearn-local", manifest.id);
        if (!capabilities) continue;
        accounts.push(...projected.map((account) => ({
          id: account.accountId,
          providerId: "aitoearn-local" as const,
          platform: manifest.id,
          displayName: account.displayName,
          avatarUrl: account.avatarUrl,
          status: account.status,
          capabilities,
          lastCheckedAt: new Date().toISOString(),
        })));
      } catch (error) {
        if (!(error instanceof PlatformAdapterError) || error.code !== "transport-unavailable") throw error;
      }
    }
    return accounts;
  }

  async function startLogin(_projectId: string, platform: SelfMediaPlatform) {
    if (!isKnownPlatform(platform)) throw new SelfMediaProviderError("aitoearn-local", "platform-not-supported", "本地 provider 不支持该平台");
    if (!isLocalPlatform(platform)) {
      const adapter = platformRegistry.get(platform);
      if (!adapter || !availablePlatforms.includes(platform)) {
        throw new SelfMediaProviderError("aitoearn-local", "platform-transport-unavailable", "当前平台尚未完成应用凭据配置", false);
      }
      try {
        const result = await adapter.authenticate();
        if (!result.authenticated) throw new SelfMediaProviderError("aitoearn-local", "login-failed", "平台授权未完成", false);
        return { started: true };
      } catch (error) {
        officialProviderError(error);
      }
    }
    const login = await withCredentialRedaction(async () => {
      if (platform === "xhs") return withLoginWindowCloseCancellation(() => xiaohongshuService.loginOrView("login"));
      if (platform === "douyin") {
        return withDestroyedWindowDevToolsGuard(
          () => withLoginWindowCloseCancellation(() => douyinService.loginOrView("login")),
        );
      }
      if (platform === "wxSph") return withLoginWindowCloseCancellation(() => shipinhaoService.loginOrView("login"));
      return withLoginWindowCloseCancellation(() => kwaiPub.login());
    });
    const result = login as Record<string, unknown>;
    if (result.success === false) throw new SelfMediaProviderError("aitoearn-local", "login-failed", typeof result.error === "string" ? result.error : "平台登录失败", false);
    const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : result;
    const cookies = parseCookies(data.cookie ?? data.cookies);
    const userInfo = data.userInfo;
    const fallbackIdentity = "unidentified";
    const identity = identityFromUserInfo(userInfo, fallbackIdentity);
    const record: LocalAccountRecord = {
      id: accountId(platform, identity),
      platform,
      displayName: `${PLATFORM_NAMES[platform]} · ${displayNameFromUserInfo(userInfo, identity === fallbackIdentity ? "未命名账号" : identity)}`,
      avatarUrl: avatarFromUserInfo(userInfo),
      credential: { cookies, localStorage: typeof data.localStorage === "string" ? data.localStorage : undefined },
      updatedAt: new Date().toISOString(),
    };
    try {
      await vault.upsert(record);
    } catch (error) {
      if (error instanceof Error && error.message.includes("safeStorage 不可用")) {
        throw new SelfMediaProviderError("aitoearn-local", "credential-unavailable", "系统凭据加密不可用，账号未保存", false);
      }
      throw error;
    }
    return { started: true };
  }

  async function publish(context: SelfMediaProviderPublishContext): Promise<SelfMediaProviderTaskResult> {
    const platformValue = context.draft.platformOptions.platform;
    if (!isKnownPlatform(platformValue)) throw new SelfMediaProviderError("aitoearn-local", "platform-not-supported", "草稿未选择已注册平台");
    const platform = platformValue;
    if (!isSelfMediaPublishable("aitoearn-local", platform, context.draft.contentType)) {
      throw new SelfMediaProviderError("aitoearn-local", "platform-transport-unavailable", "当前平台暂未接入本地发布能力", false);
    }
    const record = await vault.get(context.task.accountId);
    if (!record || record.platform !== platform) throw new SelfMediaProviderError("aitoearn-local", "account-not-found", "本地平台账号不存在，请先登录", false);
    if (!isLocalPlatform(platform)) {
      const adapter = platformRegistry.get(platform);
      if (!adapter || !availablePlatforms.includes(platform)) {
        throw new SelfMediaProviderError("aitoearn-local", "platform-transport-unavailable", "当前平台尚未完成应用凭据配置", false);
      }
      const assets = await Promise.all(context.draft.assets.map((asset) => context.resolveAsset(asset.assetId)));
      const cover = context.draft.cover ? await context.resolveAsset(context.draft.cover.assetId) : undefined;
      try {
        const result = await adapter.publish({
          accountId: context.task.accountId,
          contentType: context.draft.contentType,
          assets,
          cover,
          title: context.draft.title,
          description: context.draft.description,
          topics: context.draft.topics,
          visibility: context.draft.visibility,
          scheduledAt: context.draft.scheduledAt,
          options: context.draft.platformOptions,
        });
        return projectOfficialTask(result);
      } catch (error) {
        officialProviderError(error);
      }
    }
    const sessionCredential = record.credential;
    if (!isLocalSessionAccountCredential(sessionCredential)) {
      throw new SelfMediaProviderError("aitoearn-local", "credential-invalid", "本地平台凭据类型无效，请重新登录", false);
    }
    const cookies = credentialCookies(sessionCredential);
    const assets = await Promise.all(context.draft.assets.map((asset) => context.resolveAsset(asset.assetId)));
    const video = assets.find((asset) => asset.kind === "video");
    const images = assets.filter((asset) => asset.kind === "image");
    const coverRef = context.draft.cover ? await context.resolveAsset(context.draft.cover.assetId) : images[0] ?? undefined;
    if (context.draft.contentType === "video" && !video) throw new SelfMediaProviderError("aitoearn-local", "video-required", "视频发布需要视频资产");
    if (!coverRef) throw new SelfMediaProviderError("aitoearn-local", "cover-required", "发布需要封面资产");
    if (context.draft.scheduledAt) throw new SelfMediaProviderError("aitoearn-local", "schedule-not-supported", "当前本地平台未启用原生定时发布，请改为立即发布", false);

    const tempFiles: string[] = [];
    try {
      const allowedAssetRoots = bridgeOptions.allowedAssetRoots?.() ?? [];
      const allowedRemoteAssetHosts = bridgeOptions.allowedRemoteAssetHosts?.().map((host) => host.toLowerCase()) ?? [];
      const videoPath = video ? await materializeAsset(video.url, tempFiles, allowedAssetRoots, allowedRemoteAssetHosts) : undefined;
      const coverPath = await materializeAsset(coverRef.url, tempFiles, allowedAssetRoots, allowedRemoteAssetHosts);
      const imagePaths = await Promise.all(images.map((asset) => materializeAsset(asset.url, tempFiles, allowedAssetRoots, allowedRemoteAssetHosts)));
      const topics = context.draft.topics.map((topic) => topic.startsWith("#") ? topic : `#${topic}`);
      const title = context.draft.title;
      const description = context.draft.description;
      const options = context.draft.platformOptions;
      const result = await withCredentialRedaction(async () => {
        if (platform === "xhs") {
          const settings = { title, desc: description, topicsDetail: topics.map((topic) => ({ topicId: topic, topicName: topic })), cover: coverPath, visibility_type: visibilityForXhs(context.draft.visibility), proxy: "" };
          if (context.draft.contentType === "image-text") return xiaohongshuService.publishImageWorkApi(JSON.stringify(cookies), imagePaths, settings);
          return xiaohongshuService.publishVideoWorkApi(JSON.stringify(cookies), videoPath as string, settings, context.emitProgress);
        }
        if (platform === "douyin") {
          const settings = { title, caption: description, topics, cover: coverPath, visibility_type: visibilityForDouyin(context.draft.visibility), proxyIp: "", ...(typeof options.allowComment === "boolean" ? { allowComment: options.allowComment } : {}) };
          const tokens = sessionCredential.localStorage ? JSON.parse(sessionCredential.localStorage) : {};
          if (context.draft.contentType === "image-text") return douyinService.publishImageWorkApi(JSON.stringify(cookies), tokens, imagePaths, settings);
          return douyinService.publishVideoWorkApi(JSON.stringify(cookies), tokens, videoPath as string, settings, context.emitProgress);
        }
        if (platform === "wxSph") {
          const settings = { title, topics, des: description, cover: coverPath, postFlag: 1 as const, proxy: "" };
          return shipinhaoService.publishVideoWorkApi(cookies, videoPath as string, settings, context.emitProgress);
        }
        return kwaiPub.pubVideo({ cookies, topics, desc: `${title}${description ? `\n${description}` : ""}`, videoPath: videoPath as string, coverPath, callback: context.emitProgress, photoStatus: visibilityForKwai(context.draft.visibility), proxy: "" });
      });
      return normalizeResult(result);
    } catch (error) {
      if (error instanceof SelfMediaProviderError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/login|cookie|session|授权|掉线|过期/i.test(message)) throw new SelfMediaProviderError("aitoearn-local", "login-expired", "平台登录状态已失效，请重新登录", false);
      throw new SelfMediaProviderError("aitoearn-local", "local-publish-failed", message || "本地平台发布失败", true);
    } finally {
      await Promise.all(tempFiles.map((directory) => fs.rm(directory, { recursive: true, force: true })));
    }
  }

  async function checkOnline(platform: LocalPlatform, cookies: Cookie[]) {
    if (platform === "xhs") {
      await xiaohongshuService.getUserInfo(cookies);
      return true;
    }
    if (platform === "douyin") return douyinService.checkLoginStatus(JSON.stringify(cookies));
    if (platform === "wxSph") return shipinhaoService.checkLoginStatus(JSON.stringify(cookies));
    const result = await kwaiPub.getAccountInfo(cookies);
    return result.status === 200 && Boolean(result.data?.data?.userInfo);
  }

  return {
    availablePlatforms,
    listAccounts,
    startLogin,
    publish,
    poll: async (task) => {
      const record = await vault.get(task.accountId);
      if (!record) throw new SelfMediaProviderError("aitoearn-local", "account-not-found", "本地平台账号不存在，无法查询任务", false);
      if (isLocalPlatform(record.platform)) throw new SelfMediaProviderError("aitoearn-local", "poll-not-supported", "本地平台不支持查询已提交请求", false);
      const adapter = platformRegistry.get(record.platform);
      if (!adapter || !availablePlatforms.includes(record.platform)) {
        throw new SelfMediaProviderError("aitoearn-local", "platform-transport-unavailable", "当前平台尚未完成应用凭据配置", false);
      }
      try {
        return projectOfficialTask(await adapter.poll({ accountId: task.accountId, taskId: task.providerTaskId ?? task.id }));
      } catch (error) {
        officialProviderError(error);
      }
    },
    cancel: async (task) => {
      const record = await vault.get(task.accountId);
      if (!record) throw new SelfMediaProviderError("aitoearn-local", "account-not-found", "本地平台账号不存在，无法取消任务", false);
      if (isLocalPlatform(record.platform)) {
        throw new SelfMediaProviderError("aitoearn-local", "cancel-not-supported", "本地平台发布不支持取消已提交请求", false);
      }
      const adapter = platformRegistry.get(record.platform);
      if (!adapter || !availablePlatforms.includes(record.platform)) {
        throw new SelfMediaProviderError("aitoearn-local", "platform-transport-unavailable", "当前平台尚未完成应用凭据配置", false);
      }
      try {
        return projectOfficialTask(await adapter.cancel({ accountId: task.accountId, taskId: task.providerTaskId ?? task.id }));
      } catch (error) {
        officialProviderError(error);
      }
    },
    dispose: async () => undefined,
  };
}
