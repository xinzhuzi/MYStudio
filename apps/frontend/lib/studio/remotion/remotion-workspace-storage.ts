import type { EditingRenderSettings } from "@/types/editing";
import type { RemotionWorkspaceManifestV1 } from "@/types/remotion-workspace";
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
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export interface EnsureRemotionWorkspaceOptions {
  storage?: RemotionWorkspaceStorage;
  now?: () => number;
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
    return parseExistingWorkspace(projectId, existing);
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

function parseExistingWorkspace(
  projectId: string,
  raw: string,
): RemotionWorkspaceEnsureResult {
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
  return { status: "ready", created: false, manifest: validation.value };
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
