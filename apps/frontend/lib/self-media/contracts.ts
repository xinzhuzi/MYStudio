import { getSelfMediaCapabilities } from "./capabilities";
import type { SelfMediaAssetRef, SelfMediaDraft, SelfMediaPlatform, SelfMediaTask } from "@/types/self-media";

export interface SelfMediaValidationIssue {
  path: string;
  message: string;
}

export type SelfMediaValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: SelfMediaValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCredentialLikeKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return ["apikey", "token", "cookie", "authorization", "secret", "password", "credential", "skkey", "auth"].some((word) => normalized.includes(word));
}

export function containsSelfMediaCredentialLikeKey(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsSelfMediaCredentialLikeKey(item, seen));
  return Object.entries(value).some(([key, item]) => isCredentialLikeKey(key) || containsSelfMediaCredentialLikeKey(item, seen));
}

function isSafeAssetUrl(value: string) {
  return /^(?:https?:\/\/|project-file:\/\/|local-(?:image|video):\/\/)/i.test(value)
    && !value.includes("..")
    && !value.includes("\\")
    && !value.includes("\0");
}

function isSafeAssetRef(value: unknown, projectId: string): value is SelfMediaAssetRef {
  if (!isRecord(value) || !isNonEmptyString(value.assetId) || !isNonEmptyString(value.projectId) || value.projectId !== projectId) return false;
  if (value.kind !== "video" && value.kind !== "image") return false;
  if (/^(?:[A-Za-z]:[\\/]|\/|~\/)/.test(value.assetId) || value.assetId.includes("..") || value.assetId.includes("\\") || value.assetId.includes("\0")) return false;
  if (value.approvedUrl !== undefined && (!isNonEmptyString(value.approvedUrl) || !isSafeAssetUrl(value.approvedUrl))) return false;
  if (value.thumbnailUrl !== undefined && (!isNonEmptyString(value.thumbnailUrl) || !isSafeAssetUrl(value.thumbnailUrl))) return false;
  return true;
}

function projectAssetRef(value: SelfMediaAssetRef): SelfMediaAssetRef {
  return {
    assetId: value.assetId,
    projectId: value.projectId,
    kind: value.kind,
    approvedUrl: value.approvedUrl,
    thumbnailUrl: value.thumbnailUrl,
  };
}

export function validateSelfMediaDraft(value: unknown): SelfMediaValidationResult<SelfMediaDraft> {
  if (!isRecord(value)) return { success: false, issues: [{ path: "", message: "草稿必须是对象" }] };
  if (containsSelfMediaCredentialLikeKey(value)) {
    return { success: false, issues: [{ path: "", message: "草稿不能包含凭据字段" }] };
  }
  const issues: SelfMediaValidationIssue[] = [];
  if (!isNonEmptyString(value.id)) issues.push({ path: "id", message: "缺少草稿 ID" });
  if (!isNonEmptyString(value.projectId)) issues.push({ path: "projectId", message: "缺少项目 ID" });
  if (value.contentType !== "video" && value.contentType !== "image-text") {
    issues.push({ path: "contentType", message: "内容类型必须是 video 或 image-text" });
  }
  if (!isNonEmptyString(value.title) || value.title.trim().length > 100) {
    issues.push({ path: "title", message: "标题不能为空且不能超过 100 个字符" });
  }
  if (typeof value.description !== "string" || value.description.length > 5000) {
    issues.push({ path: "description", message: "描述必须是字符串且不能超过 5000 个字符" });
  }
  const projectId = typeof value.projectId === "string" ? value.projectId : "";
  const assets = Array.isArray(value.assets) ? value.assets : [];
  if (assets.length === 0) {
    issues.push({ path: "assets", message: "至少选择一个媒体资产" });
  } else if (assets.some((asset) => !isSafeAssetRef(asset, projectId))) {
    issues.push({ path: "assets", message: "媒体资产必须属于当前项目且只能使用受控资产引用" });
  }
  if (!isNonEmptyStringList(value.accountIds) || value.accountIds.length === 0) {
    issues.push({ path: "accountIds", message: "至少选择一个账号" });
  }
  if (!isNonEmptyStringList(value.topics)) {
    issues.push({ path: "topics", message: "话题必须是字符串数组" });
  }
  const platformOptions: Record<string, string | number | boolean> = {};
  if (!isRecord(value.platformOptions)) {
    issues.push({ path: "platformOptions", message: "平台选项必须是对象" });
  } else if (value.platformOptions.platform !== undefined) {
    const capability = typeof value.platformOptions.platform === "string"
      ? getSelfMediaCapabilities("aitoearn-local", value.platformOptions.platform as SelfMediaPlatform)
      : undefined;
    if (!capability) {
      issues.push({ path: "platformOptions.platform", message: "目标平台未注册" });
    } else if ((value.contentType === "video" && !capability.supportsVideo) || (value.contentType === "image-text" && !capability.supportsImageText)) {
      issues.push({ path: "contentType", message: `${capability.displayName} 不支持当前内容类型` });
    } else {
      const allowedKeys = new Set(["platform", ...capability.optionKeys]);
      for (const [key, option] of Object.entries(value.platformOptions)) {
        if (allowedKeys.has(key) && (typeof option === "string" || typeof option === "number" || typeof option === "boolean")) {
          platformOptions[key] = option;
        } else if (allowedKeys.has(key)) {
          issues.push({ path: `platformOptions.${key}`, message: "平台选项必须是字符串、数字或布尔值" });
        }
      }
    }
  }
  if (value.cover !== undefined && !isSafeAssetRef(value.cover, projectId)) {
    issues.push({ path: "cover", message: "封面必须是当前项目中的受控资产引用" });
  }
  if (value.contentType === "video" && !assets.some((asset) => isSafeAssetRef(asset, projectId) && asset.kind === "video")) {
    issues.push({ path: "assets", message: "视频内容必须选择视频资产" });
  }
  if (value.contentType === "image-text" && !assets.some((asset) => isSafeAssetRef(asset, projectId) && asset.kind === "image")) {
    issues.push({ path: "assets", message: "图文内容必须选择图片资产" });
  }
  if (value.scheduledAt !== undefined) {
    const timestamp = typeof value.scheduledAt === "string" ? Date.parse(value.scheduledAt) : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      issues.push({ path: "scheduledAt", message: "定时发布时间必须是未来的有效时间" });
    }
  }
  if (value.visibility !== "public" && value.visibility !== "private" && value.visibility !== "friends") {
    issues.push({ path: "visibility", message: "可见范围无效" });
  }
  if (!isValidDateString(value.updatedAt)) {
    issues.push({ path: "updatedAt", message: "更新时间无效" });
  }
  if (issues.length > 0) return { success: false, issues };
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.projectId) ||
    (value.contentType !== "video" && value.contentType !== "image-text") ||
    !isNonEmptyString(value.title) ||
    typeof value.description !== "string" ||
    !isNonEmptyStringList(value.topics) ||
    !isNonEmptyStringList(value.accountIds) ||
    (value.visibility !== "public" && value.visibility !== "private" && value.visibility !== "friends") ||
    !isValidDateString(value.updatedAt) ||
    (value.scheduledAt !== undefined && typeof value.scheduledAt !== "string")
  ) {
    return { success: false, issues: [{ path: "", message: "草稿字段无效" }] };
  }
  const normalizedAssets = assets
    .filter((asset): asset is SelfMediaAssetRef => isSafeAssetRef(asset, projectId))
    .map(projectAssetRef);
  const cover = isSafeAssetRef(value.cover, projectId) ? projectAssetRef(value.cover) : undefined;
  return {
    success: true,
    value: {
      id: value.id,
      projectId,
      contentType: value.contentType,
      title: value.title,
      description: value.description,
      topics: [...value.topics],
      cover,
      assets: normalizedAssets,
      accountIds: [...value.accountIds],
      visibility: value.visibility,
      platformOptions,
      scheduledAt: value.scheduledAt,
      updatedAt: value.updatedAt,
    },
  };
}

export function isSelfMediaTask(value: unknown): value is SelfMediaTask {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.attemptId) &&
    isNonEmptyString(value.projectId) &&
    value.providerId === "aitoearn-local" &&
    isNonEmptyString(value.accountId) &&
    typeof value.status === "string" &&
    ["draft", "scheduled", "running", "success", "failure", "partial", "audit", "canceled", "expired-login"].includes(value.status) &&
    typeof value.progress === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}
