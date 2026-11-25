export type SelfMediaProviderId = "aitoearn-local";

export type SelfMediaPlatform =
  | "douyin"
  | "xhs"
  | "wxSph"
  | "KWAI"
  | "tiktok"
  | "youtube"
  | "bilibili"
  | "twitter"
  | "wxGzh"
  | "facebook"
  | "instagram"
  | "threads"
  | "pinterest"
  | "linkedin"
  | "googleBusiness";

export type SelfMediaAccountStatus = "online" | "offline" | "expired" | "error";
export type SelfMediaContentType = "video" | "image-text";
export type SelfMediaVisibility = "public" | "private" | "friends";

/**
 * L6(1125 二轮收尾): 批量发布批次角色。
 * verification=首发验证(占首槽,失败级联终止本批);member=今天发的成员;
 * queued=排队次日的成员(不进防重复锁,不按未完任务禁用发布按钮)。
 */
export type SelfMediaBatchRole = "verification" | "member" | "queued";
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
  /** B1b: 关联产品 ID(可选,用于历史按产品筛选) */
  productId?: string;
  /** L6: 批量发布批次 ID(同一批任务共用;非批次任务缺省) */
  batchId?: string;
  /** L6: 批次角色(见 SelfMediaBatchRole);非批次任务缺省 */
  batchRole?: SelfMediaBatchRole;
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
  /** B1b: 关联产品 ID(可选,用于历史按产品筛选) */
  productId?: string;
  /** L6: 批量发布批次 ID(同一批任务共用;非批次任务缺省) */
  batchId?: string;
  /** L6: 批次角色(见 SelfMediaBatchRole);非批次任务缺省 */
  batchRole?: SelfMediaBatchRole;
  /** L6: 建单时从草稿平台选项抄来的可靠平台来源;旧任务缺省,视图不假定存在 */
  platform?: SelfMediaPlatform;
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
  availablePlatforms?: SelfMediaPlatform[];
}
