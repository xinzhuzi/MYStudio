import type {
  SelfMediaCapabilityDescriptor,
  SelfMediaPlatform,
  SelfMediaProviderId,
} from "@/types/self-media";

const NO_PLATFORM_OPTIONS = [] as const;

/**
 * Canonical UI/IPC order for the 14 platforms with MYStudio-owned Electron
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
