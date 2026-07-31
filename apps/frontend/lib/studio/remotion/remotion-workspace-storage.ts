import type { EditingRenderSettings } from "@/types/editing";
import type {
  RemotionProductionProfileV1,
  RemotionWorkspaceManifestV1,
} from "@/types/remotion-workspace";
import type { StudioWorkflowConfig } from "@/types/studio";
import { fileStorage } from "@/lib/storage/indexed-db-storage";
import { validateRemotionWorkspaceManifest } from "./remotion-manifest-validation";

export const REMOTION_WORKSPACE_STORAGE_SUFFIX = "remotion/project.json";

export const DEFAULT_REMOTION_RENDER_SETTINGS: EditingRenderSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  codec: "h264",
  subtitleMode: "burn-in",
  loudnessLufs: -14,
  truePeakDbtp: -1.5,
};

export interface RemotionWorkspaceRuntimeInfo {
  templateVersion: string;
  remotionVersion: string;
  bundleContentHash: string;
  defaultRenderSettings: EditingRenderSettings;
}

export type RemotionWorkspaceEnsureResult =
  | { status: "ready"; created: boolean; manifest: RemotionWorkspaceManifestV1 }
  | {
      status: "blocked";
      projectId: string;
      code: "invalid-project-id" | "invalid-runtime" | "invalid-existing" | "storage-failure";
      message: string;
      retryable: boolean;
    };

type RemotionWorkspaceBlockedCode =
  | "invalid-project-id"
  | "invalid-runtime"
  | "invalid-existing"
  | "storage-failure";

export interface RemotionWorkspaceStorage {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void | unknown;
}

export interface EnsureRemotionWorkspaceOptions {
  storage?: RemotionWorkspaceStorage;
  now?: () => number;
  productionProfile?: RemotionProductionProfileV1;
}

export type RemotionProductionProfileInput = Pick<StudioWorkflowConfig,
  | "episodeDurationMin"
  | "platformSpec"
  | "visualManualId"
  | "directorManualId"
  | "stylePositioning"
>;

export function buildRemotionProductionProfile(
  config: RemotionProductionProfileInput,
): RemotionProductionProfileV1 | undefined {
  const profile: RemotionProductionProfileV1 = {
    schemaVersion: 1,
    ...(Number.isFinite(config.episodeDurationMin) && (config.episodeDurationMin ?? 0) > 0
      ? { referenceEpisodeDurationMin: config.episodeDurationMin }
      : {}),
    ...(config.platformSpec?.trim() ? { platformSpec: config.platformSpec.trim() } : {}),
    ...(config.visualManualId?.trim() ? { visualManualId: config.visualManualId.trim() } : {}),
    ...(config.directorManualId?.trim() ? { directorManualId: config.directorManualId.trim() } : {}),
    ...(config.stylePositioning?.trim() ? { stylePositioning: config.stylePositioning.trim() } : {}),
  };
  return Object.keys(profile).length > 1 ? profile : undefined;
}

export function remotionWorkspaceStorageKey(projectId: string): string {
  return `_p/${projectId}/${REMOTION_WORKSPACE_STORAGE_SUFFIX}`;
}

export async function ensureRemotionWorkspace(
  projectId: string,
  runtime: RemotionWorkspaceRuntimeInfo,
  options: EnsureRemotionWorkspaceOptions = {},
): Promise<RemotionWorkspaceEnsureResult> {
  if (!isSafeProjectId(projectId)) {
    return blocked(projectId, "invalid-project-id", "projectId 不得包含路径逃逸或分隔符", false);
  }
  const storage = options.storage ?? fileStorage;
  const key = remotionWorkspaceStorageKey(projectId);
  let existing: string | null;
  try {
    existing = await storage.getItem(key);
  } catch (error) {
    return blocked(projectId, "storage-failure", `读取 Remotion workspace 失败：${messageOf(error)}`, true);
  }
  if (existing !== null) {
    return parseExistingWorkspace(projectId, existing, { ...options, storage });
  }

  const now = options.now?.() ?? Date.now();
  const manifest: RemotionWorkspaceManifestV1 = {
    schemaVersion: 1,
    projectId,
    workspaceId: `workspace-${projectId}`,
    templateId: "mystudio-remotion-v1",
    templateVersion: runtime.templateVersion,
    remotionVersion: runtime.remotionVersion,
    bundleContentHash: runtime.bundleContentHash,
    compositionIds: ["StoryboardShot", "ChapterVideo"],
    defaultRenderSettings: runtime.defaultRenderSettings,
    ...(options.productionProfile ? { productionProfile: options.productionProfile } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const validation = validateRemotionWorkspaceManifest(manifest);
  if (!validation.success) {
    return blocked(projectId, "invalid-runtime", validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "), false);
  }
  try {
    await storage.setItem(key, `${JSON.stringify(manifest)}\n`);
  } catch (error) {
    return blocked(projectId, "storage-failure", `写入 Remotion workspace 失败：${messageOf(error)}`, true);
  }
  return { status: "ready", created: true, manifest };
}

export async function syncRemotionWorkspaceProductionProfile(
  projectId: string,
  productionProfile: RemotionProductionProfileV1 | undefined,
  storage: RemotionWorkspaceStorage = fileStorage,
): Promise<"updated" | "unchanged" | "missing"> {
  if (!isSafeProjectId(projectId)) return "missing";
  const key = remotionWorkspaceStorageKey(projectId);
  const raw = await storage.getItem(key);
  if (raw === null) return "missing";
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`已有 Remotion workspace 不是有效 JSON：${messageOf(error)}`);
  }
  const validation = validateRemotionWorkspaceManifest(value);
  if (!validation.success || validation.value.projectId !== projectId) {
    const detail = validation.success
      ? "已有 workspace projectId 与当前项目不一致"
      : validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`已有 Remotion workspace 无效：${detail}`);
  }
  const existing = validation.value;
  if (JSON.stringify(existing.productionProfile) === JSON.stringify(productionProfile)) return "unchanged";
  const next: RemotionWorkspaceManifestV1 = { ...existing, updatedAt: Date.now() };
  if (productionProfile) next.productionProfile = productionProfile;
  else delete next.productionProfile;
  const nextValidation = validateRemotionWorkspaceManifest(next);
  if (!nextValidation.success) {
    throw new Error(nextValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  await storage.setItem(key, `${JSON.stringify(next)}\n`);
  return "updated";
}

async function parseExistingWorkspace(
  projectId: string,
  raw: string,
  options: EnsureRemotionWorkspaceOptions & { storage: RemotionWorkspaceStorage },
): Promise<RemotionWorkspaceEnsureResult> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return blocked(projectId, "invalid-existing", `已有 Remotion workspace 不是有效 JSON：${messageOf(error)}`, true);
  }
  const validation = validateRemotionWorkspaceManifest(value);
  if (!validation.success || validation.value.projectId !== projectId) {
    const detail = validation.success
      ? "已有 workspace projectId 与当前项目不一致"
      : validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    return blocked(projectId, "invalid-existing", `已有 Remotion workspace 无效：${detail}`, true);
  }
  const existingManifest = validation.value;
  const requestedProfile = options.productionProfile;
  if (!requestedProfile || JSON.stringify(existingManifest.productionProfile) === JSON.stringify(requestedProfile)) {
    return { status: "ready", created: false, manifest: existingManifest };
  }
  const updatedManifest: RemotionWorkspaceManifestV1 = {
    ...existingManifest,
    productionProfile: requestedProfile,
    updatedAt: options.now?.() ?? Date.now(),
  };
  const updatedValidation = validateRemotionWorkspaceManifest(updatedManifest);
  if (!updatedValidation.success) {
    return blocked(projectId, "invalid-runtime", updatedValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "), false);
  }
  try {
    await options.storage.setItem(remotionWorkspaceStorageKey(projectId), `${JSON.stringify(updatedManifest)}\n`);
  } catch (error) {
    return blocked(projectId, "storage-failure", `更新 Remotion production profile 失败：${messageOf(error)}`, true);
  }
  return { status: "ready", created: false, manifest: updatedManifest };
}

function blocked(
  projectId: string,
  code: RemotionWorkspaceBlockedCode,
  message: string,
  retryable: boolean,
): RemotionWorkspaceEnsureResult {
  return { status: "blocked", projectId, code, message, retryable };
}

function isSafeProjectId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value !== "."
    && value !== ".."
    && !/[\\/\0]/.test(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
