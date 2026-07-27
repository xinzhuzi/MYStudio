export type SelfMediaProviderId = "aitoearn-local";

export type SelfMediaPlatform =
  | "douyin"
  | "xhs"
  | "wxSph"
  | "KWAI";

export type SelfMediaAccountStatus = "online" | "offline" | "expired" | "error";
export type SelfMediaContentType = "video" | "image-text";
export type SelfMediaVisibility = "public" | "private" | "friends";
export type SelfMediaTaskStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "success"
  | "failure"
  | "partial"
  | "audit"
  | "canceled"
  | "expired-login";

export interface SelfMediaCapabilityDescriptor {
  providerId: SelfMediaProviderId;
  platform: SelfMediaPlatform;
  displayName: string;
  supportsVideo: boolean;
  supportsImageText: boolean;
  supportsScheduling: boolean;
  supportsCancellation: boolean;
  optionKeys: readonly string[];
}

export interface SelfMediaAccount {
  id: string;
  providerId: SelfMediaProviderId;
  platform: SelfMediaPlatform;
  displayName: string;
  avatarUrl?: string;
  status: SelfMediaAccountStatus;
  capabilities: SelfMediaCapabilityDescriptor;
  lastCheckedAt?: string;
  errorCode?: string;
}

export interface SelfMediaAssetRef {
  assetId: string;
  projectId: string;
  kind: "video" | "image";
  approvedUrl?: string;
  thumbnailUrl?: string;
}

export interface SelfMediaDraft {
  id: string;
  projectId: string;
  contentType: SelfMediaContentType;
  title: string;
  description: string;
  topics: string[];
  cover?: SelfMediaAssetRef;
  assets: SelfMediaAssetRef[];
  accountIds: string[];
  visibility: SelfMediaVisibility;
  platformOptions: Record<string, string | number | boolean>;
  scheduledAt?: string;
  updatedAt: string;
}

export interface SelfMediaTaskError {
  code: string;
  message: string;
  providerId: SelfMediaProviderId;
  retryable: boolean;
}

export interface SelfMediaTask {
  id: string;
  attemptId: string;
  draftId?: string;
  previousTaskId?: string;
  projectId: string;
  providerId: SelfMediaProviderId;
  accountId: string;
  sourceAssetIds: string[];
  status: SelfMediaTaskStatus;
  progress: number;
  scheduledAt?: string;
  providerTaskId?: string;
  resultUrl?: string;
  error?: SelfMediaTaskError;
  createdAt: string;
  updatedAt: string;
}

export interface SelfMediaHistoryRecord extends SelfMediaTask {
  finishedAt?: string;
}

export interface SelfMediaProviderSummary {
  id: SelfMediaProviderId;
  displayName: string;
  enabled: boolean;
  reason?: string;
}
