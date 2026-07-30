export const REMOTION_WORKSPACE_RUNTIME_CHANNEL = "remotion-workspace-runtime";

export interface RemotionWorkspaceRuntimeReply {
  schemaVersion: 1;
  templateId: "mystudio-remotion-v1";
  templateVersion: "1.0.0";
  remotionVersion: string;
  bundleContentHash: string;
  compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"];
}

export type RemotionWorkspaceRuntimeValidationResult =
  | { success: true; value: RemotionWorkspaceRuntimeReply }
  | { success: false; issues: Array<{ path: string; message: string }> };

export function validateRemotionWorkspaceRuntimeReply(
  value: unknown,
): RemotionWorkspaceRuntimeValidationResult {
  if (!isRecord(value)) return failure("$", "Remotion workspace runtime 必须是对象");
  const issues: Array<{ path: string; message: string }> = [];
  if (value.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "必须为 1" });
  if (value.templateId !== "mystudio-remotion-v1") issues.push({ path: "templateId", message: "templateId 无效" });
  if (value.templateVersion !== "1.0.0") issues.push({ path: "templateVersion", message: "templateVersion 无效" });
  if (!isSemver(value.remotionVersion)) issues.push({ path: "remotionVersion", message: "remotionVersion 必须是精确 semver" });
  if (!isSha256(value.bundleContentHash)) issues.push({ path: "bundleContentHash", message: "bundleContentHash 必须是 SHA-256" });
  if (!sameOrderedStrings(value.compositionIds, ["StoryboardShot", "ChapterVideo", "DaojieTimeline"])) {
    issues.push({ path: "compositionIds", message: "compositionIds 顺序或内容无效" });
  }
  return issues.length > 0 ? { success: false, issues } : { success: true, value: value as unknown as RemotionWorkspaceRuntimeReply };
}

function failure(path: string, message: string): RemotionWorkspaceRuntimeValidationResult {
  return { success: false, issues: [{ path, message }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSemver(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function sameOrderedStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}
