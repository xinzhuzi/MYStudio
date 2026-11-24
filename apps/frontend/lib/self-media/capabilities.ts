import type {
  SelfMediaCapabilityDescriptor,
  SelfMediaPlatform,
  SelfMediaProviderId,
} from "@/types/self-media";

const NO_PLATFORM_OPTIONS = [] as const;

/**
 * Canonical UI/IPC order for the 15 platforms with MYStudio-owned Electron
 * transports in the local provider.
 */
export const SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS = [
  "tiktok",
  "douyin",
  "xhs",
  "wxSph",
  "KWAI",
  "youtube",
  "bilibili",
  "twitter",
  "wxGzh",
  "facebook",
  "instagram",
  "threads",
  "pinterest",
  "linkedin",
  "googleBusiness",
] as const satisfies readonly SelfMediaPlatform[];

export type SelfMediaLocalTransportPlatform = (typeof SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS)[number];

export const SELF_MEDIA_CAPABILITY_MANIFEST = {
  tiktok: {
    providerId: "aitoearn-local",
    platform: "tiktok",
    displayName: "TikTok",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: true,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  douyin: {
    providerId: "aitoearn-local",
    platform: "douyin",
    displayName: "抖音",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: ["location", "allowComment"],
  },
  xhs: {
    providerId: "aitoearn-local",
    platform: "xhs",
    displayName: "小红书",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: ["location", "collection"],
  },
  wxSph: {
    providerId: "aitoearn-local",
    platform: "wxSph",
    displayName: "视频号",
    supportsVideo: true,
    supportsImageText: false,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: ["location", "allowComment"],
  },
  KWAI: {
    providerId: "aitoearn-local",
    platform: "KWAI",
    displayName: "快手",
    supportsVideo: true,
    supportsImageText: false,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: ["location", "allowComment"],
  },
  youtube: {
    providerId: "aitoearn-local",
    platform: "youtube",
    displayName: "YouTube",
    supportsVideo: true,
    supportsImageText: false,
    supportsScheduling: true,
    supportsCancellation: true,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  bilibili: {
    providerId: "aitoearn-local",
    platform: "bilibili",
    displayName: "B站",
    supportsVideo: true,
    supportsImageText: false,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: ["tid"],
  },
  twitter: {
    providerId: "aitoearn-local",
    platform: "twitter",
    displayName: "X（Twitter）",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: true,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  wxGzh: {
    providerId: "aitoearn-local",
    platform: "wxGzh",
    displayName: "微信公众号",
    supportsVideo: false,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  facebook: {
    providerId: "aitoearn-local",
    platform: "facebook",
    displayName: "Facebook",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: true,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  instagram: {
    providerId: "aitoearn-local",
    platform: "instagram",
    displayName: "Instagram",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  threads: {
    providerId: "aitoearn-local",
    platform: "threads",
    displayName: "Threads",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: false,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  pinterest: {
    providerId: "aitoearn-local",
    platform: "pinterest",
    displayName: "Pinterest",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: true,
    optionKeys: ["boardId"],
  },
  linkedin: {
    providerId: "aitoearn-local",
    platform: "linkedin",
    displayName: "LinkedIn",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: true,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
  googleBusiness: {
    providerId: "aitoearn-local",
    platform: "googleBusiness",
    displayName: "Google 商家资料",
    supportsVideo: true,
    supportsImageText: true,
    supportsScheduling: true,
    supportsCancellation: true,
    optionKeys: NO_PLATFORM_OPTIONS,
  },
} satisfies Record<SelfMediaPlatform, SelfMediaCapabilityDescriptor>;

export function getSelfMediaCapabilities(
  providerId: SelfMediaProviderId,
  platform: SelfMediaPlatform,
): SelfMediaCapabilityDescriptor | null {
  return providerId === "aitoearn-local" ? SELF_MEDIA_CAPABILITY_MANIFEST[platform] : null;
}

export function isSelfMediaLocalTransportPlatform(
  providerId: SelfMediaProviderId,
  platform: SelfMediaPlatform,
): platform is SelfMediaLocalTransportPlatform {
  return providerId === "aitoearn-local"
    && (SELF_MEDIA_LOCAL_TRANSPORT_PLATFORMS as readonly SelfMediaPlatform[]).includes(platform);
}

export function isSelfMediaPublishable(
  providerId: SelfMediaProviderId,
  platform: SelfMediaPlatform,
  contentType?: "video" | "image-text",
): boolean {
  if (!isSelfMediaLocalTransportPlatform(providerId, platform)) return false;
  if (!contentType) return true;
  const capability = getSelfMediaCapabilities(providerId, platform);
  return Boolean(capability && (contentType === "video" ? capability.supportsVideo : capability.supportsImageText));
}

// ─── Platform character limits for batch publish auto-trimming ────────────────

/**
 * Per-platform character limits for description auto-trimming.
 * Conservative limits based on known platform constraints.
 */
export const PLATFORM_CHAR_LIMITS: Record<SelfMediaPlatform, number> = {
  xhs: 1000,
  douyin: 300,
  wxSph: 1000,
  KWAI: 500,
  tiktok: 300,
  youtube: 5000,
  bilibili: 2000,
  twitter: 280,
  wxGzh: 20000,
  facebook: 5000,
  instagram: 2200,
  threads: 500,
  pinterest: 500,
  linkedin: 3000,
  googleBusiness: 1500,
} as const;
