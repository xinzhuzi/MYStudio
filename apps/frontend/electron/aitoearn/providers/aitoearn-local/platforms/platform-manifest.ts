import type {
  PlatformCapabilityRoute,
  PlatformCapabilityRouting,
  PlatformManifest,
} from "./platform-types";
import { AITOEARN_LOCAL_PROVIDER_ID, PLATFORM_IDS, type PlatformId } from "./platform-types";

const unavailableRouting = (
  overrides: Partial<PlatformCapabilityRouting> = {},
): PlatformCapabilityRouting => ({
  accountListing: "unavailable",
  authentication: "unavailable",
  videoPublish: "unavailable",
  imageTextPublish: "unavailable",
  scheduling: "unavailable",
  polling: "unavailable",
  cancellation: "unavailable",
  ...overrides,
});

const vendorVideoRouting: PlatformCapabilityRouting = {
  accountListing: "vendor-electron",
  authentication: "vendor-electron",
  videoPublish: "vendor-electron",
  imageTextPublish: "unavailable",
  scheduling: "mystudio-task-runtime",
  polling: "mystudio-task-runtime",
  cancellation: "unavailable",
};

const vendorVideoAndImageTextRouting: PlatformCapabilityRouting = {
  ...vendorVideoRouting,
  imageTextPublish: "vendor-electron",
};

const videoOnly = (supportsScheduling = false, supportsPolling = false, supportsCancellation = false) => ({
  contentTypes: ["video"] as const,
  supportsScheduling,
  supportsPolling,
  supportsCancellation,
});

const videoAndImageText = (supportsScheduling = false, supportsPolling = false, supportsCancellation = false) => ({
  contentTypes: ["video", "image-text"] as const,
  supportsScheduling,
  supportsPolling,
  supportsCancellation,
});

const imageTextOnly = (supportsScheduling = false, supportsPolling = false, supportsCancellation = false) => ({
  contentTypes: ["image-text"] as const,
  supportsScheduling,
  supportsPolling,
  supportsCancellation,
});

const apiVideoRouting = (overrides: Partial<PlatformCapabilityRouting> = {}): PlatformCapabilityRouting => unavailableRouting({
  accountListing: "official-api",
  authentication: "official-oauth",
  videoPublish: "official-api",
  ...overrides,
});

const apiVideoAndImageTextRouting = (overrides: Partial<PlatformCapabilityRouting> = {}): PlatformCapabilityRouting => unavailableRouting({
  accountListing: "official-api",
  authentication: "official-oauth",
  videoPublish: "official-api",
  imageTextPublish: "official-api",
  ...overrides,
});

const manifest = <T extends PlatformManifest>(value: T): T => value;

export const PLATFORM_MANIFESTS = {
  tiktok: manifest({
    id: "tiktok",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "TikTok",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoAndImageText(true, true, true),
    capabilityRouting: apiVideoAndImageTextRouting({ scheduling: "mystudio-task-runtime", polling: "official-api", cancellation: "official-api" }),
  }),
  douyin: manifest({
    id: "douyin",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "抖音",
    adapterVersion: "0.1.0",
    authStrategy: "vendor-electron-session",
    capabilities: videoAndImageText(true),
    capabilityRouting: vendorVideoAndImageTextRouting,
  }),
  xhs: manifest({
    id: "xhs",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "小红书",
    adapterVersion: "0.1.0",
    authStrategy: "vendor-electron-session",
    capabilities: videoAndImageText(true),
    capabilityRouting: vendorVideoAndImageTextRouting,
  }),
  wxSph: manifest({
    id: "wxSph",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "视频号",
    adapterVersion: "0.1.0",
    authStrategy: "vendor-electron-session",
    capabilities: videoOnly(true),
    capabilityRouting: vendorVideoRouting,
  }),
  KWAI: manifest({
    id: "KWAI",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "快手",
    adapterVersion: "0.1.0",
    authStrategy: "vendor-electron-session",
    capabilities: videoOnly(true),
    capabilityRouting: vendorVideoRouting,
  }),
  youtube: manifest({
    id: "youtube",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "YouTube",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoOnly(true, true, true),
    capabilityRouting: apiVideoRouting({ scheduling: "mystudio-task-runtime", polling: "official-api", cancellation: "official-api" }),
  }),
  bilibili: manifest({
    id: "bilibili",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "B站",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoOnly(true, true),
    capabilityRouting: apiVideoRouting({ scheduling: "mystudio-task-runtime", polling: "official-api" }),
  }),
  twitter: manifest({
    id: "twitter",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "X（Twitter）",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoAndImageText(true, true, true),
    capabilityRouting: apiVideoAndImageTextRouting({ scheduling: "mystudio-task-runtime", polling: "official-api", cancellation: "official-api" }),
  }),
  wxGzh: manifest({
    id: "wxGzh",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "微信公众号",
    adapterVersion: "0.1.0",
    authStrategy: "official-api-credentials",
    capabilities: imageTextOnly(true, true),
    capabilityRouting: unavailableRouting({ accountListing: "official-api", authentication: "official-api", imageTextPublish: "official-api", scheduling: "mystudio-task-runtime", polling: "official-api" }),
  }),
  facebook: manifest({
    id: "facebook",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "Facebook",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoAndImageText(true, true, true),
    capabilityRouting: apiVideoAndImageTextRouting({ scheduling: "mystudio-task-runtime", polling: "official-api", cancellation: "official-api" }),
  }),
  instagram: manifest({
    id: "instagram",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "Instagram",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoAndImageText(true, true),
    capabilityRouting: apiVideoAndImageTextRouting({ scheduling: "mystudio-task-runtime", polling: "official-api" }),
  }),
  threads: manifest({
    id: "threads",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "Threads",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoAndImageText(true, true),
    capabilityRouting: apiVideoAndImageTextRouting({ scheduling: "mystudio-task-runtime", polling: "official-api" }),
  }),
  pinterest: manifest({
    id: "pinterest",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "Pinterest",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoAndImageText(true, true, true),
    capabilityRouting: apiVideoAndImageTextRouting({ scheduling: "mystudio-task-runtime", polling: "official-api", cancellation: "official-api" }),
  }),
  linkedin: manifest({
    id: "linkedin",
    providerId: AITOEARN_LOCAL_PROVIDER_ID,
    displayName: "LinkedIn",
    adapterVersion: "0.1.0",
    authStrategy: "official-oauth",
    capabilities: videoAndImageText(true, true, true),
    capabilityRouting: apiVideoAndImageTextRouting({ scheduling: "mystudio-task-runtime", polling: "official-api", cancellation: "official-api" }),
  }),
} as const satisfies Readonly<Record<PlatformId, PlatformManifest>>;

export function getPlatformManifest(platformId: PlatformId): PlatformManifest {
  return PLATFORM_MANIFESTS[platformId];
}

export function listPlatformManifests(): readonly PlatformManifest[] {
  return PLATFORM_IDS.map((platformId) => PLATFORM_MANIFESTS[platformId]);
}
