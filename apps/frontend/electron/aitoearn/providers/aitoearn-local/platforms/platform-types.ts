export const AITOEARN_LOCAL_PROVIDER_ID = "aitoearn-local" as const;

export const PLATFORM_IDS = [
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
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
export type PlatformContentType = "video" | "image-text";
export type PlatformAuthStrategy =
  | "vendor-electron-session"
  | "official-oauth"
  | "official-api-credentials";

export type PlatformCapability =
  | "accountListing"
  | "authentication"
  | "videoPublish"
  | "imageTextPublish"
  | "scheduling"
  | "polling"
  | "cancellation";

export type PlatformCapabilityRoute =
  | "vendor-electron"
  | "mystudio-task-runtime"
  | "official-oauth"
  | "official-api"
  | "unavailable";

export type PlatformCapabilityRouting = Readonly<Record<PlatformCapability, PlatformCapabilityRoute>>;

export interface PlatformCapabilities {
  readonly contentTypes: readonly PlatformContentType[];
  readonly supportsScheduling: boolean;
  readonly supportsPolling: boolean;
  readonly supportsCancellation: boolean;
}

export interface PlatformManifest {
  readonly id: PlatformId;
  readonly providerId: typeof AITOEARN_LOCAL_PROVIDER_ID;
  readonly displayName: string;
  readonly adapterVersion: string;
  readonly authStrategy: PlatformAuthStrategy;
  readonly capabilities: PlatformCapabilities;
  readonly capabilityRouting: PlatformCapabilityRouting;
}

export type PlatformAccountStatus = "online" | "offline" | "expired" | "error";

export type PlatformTaskStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "success"
  | "failure"
  | "partial"
  | "audit"
  | "canceled"
  | "expired-login";
