import path from "node:path";

export const REMOTION_BUNDLE_DIR_NAME = "remotion-bundle";
export const BUNDLE_MANIFEST_FILE_NAME = "manifest.json";
export const BUNDLE_MANIFEST_SCHEMA_VERSION = 1;

export interface RemotionBundleManifest {
  schemaVersion: 1;
  remotionVersion: string;
  compositionId: string;
  contentHash: string;
}

export type BundleManifestValidationResult =
  | { success: true; value: RemotionBundleManifest }
  | { success: false; issues: Array<{ path: string; message: string }> };

export function resolveRemotionBundleDir(appRoot: string): string {
  requireAbsolute(appRoot, "appRoot");
  return path.join(appRoot, ".cache", REMOTION_BUNDLE_DIR_NAME);
}

export function resolveRemotionBundleManifestPath(appRoot: string): string {
  return path.join(resolveRemotionBundleDir(appRoot), BUNDLE_MANIFEST_FILE_NAME);
}

export function validateBundleManifest(
  value: unknown,
): BundleManifestValidationResult {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "bundle manifest 必须是对象" }] };
  }
  const issues: Array<{ path: string; message: string }> = [];
  if (value.schemaVersion !== BUNDLE_MANIFEST_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: "仅支持 bundle manifest schemaVersion=1" });
  }
  if (!isExactSemver(value.remotionVersion)) {
    issues.push({ path: "remotionVersion", message: "bundle manifest 需要精确 Remotion semver" });
  }
  if (!isNonEmptyString(value.compositionId)) {
    issues.push({ path: "compositionId", message: "bundle manifest 需要非空 compositionId" });
  }
  if (!isSha256(value.contentHash)) {
    issues.push({ path: "contentHash", message: "bundle manifest 需要 sha256 contentHash" });
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as RemotionBundleManifest };
}

export function assertBundleMatchesRuntime(
  manifest: unknown,
  runtimeRemotionVersion: string,
): RemotionBundleManifest {
  const result = validateBundleManifest(manifest);
  if (!result.success) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`bundle manifest 无效：${detail}`);
  }
  if (result.value.remotionVersion !== runtimeRemotionVersion) {
    throw new Error(
      `bundle 与运行时 Remotion 版本不一致：bundle=${result.value.remotionVersion} runtime=${runtimeRemotionVersion}`,
    );
  }
  return result.value;
}

function requireAbsolute(value: string, label: string): void {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} 必须是绝对路径`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isExactSemver(value: unknown): value is string {
  return typeof value === "string"
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
