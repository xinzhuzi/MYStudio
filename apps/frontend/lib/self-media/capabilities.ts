import type {
  SelfMediaCapabilityDescriptor,
  SelfMediaPlatform,
  SelfMediaProviderId,
} from "@/types/self-media";

const LOCAL_CAPABILITIES: Record<SelfMediaPlatform, SelfMediaCapabilityDescriptor> = {
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
};

export const SELF_MEDIA_PROVIDER_SUMMARIES = [
  { id: "aitoearn-local", displayName: "AiToEarn 本地适配器", enabled: false, reason: "本地平台适配器正在迁移" },
] as const;

export function getSelfMediaCapabilities(
  providerId: SelfMediaProviderId,
  platform: SelfMediaPlatform,
): SelfMediaCapabilityDescriptor | null {
  if (providerId === "aitoearn-local" && platform in LOCAL_CAPABILITIES) {
    return LOCAL_CAPABILITIES[platform as keyof typeof LOCAL_CAPABILITIES];
  }
  return null;
}
