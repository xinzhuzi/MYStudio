import type { UpdateManifest } from "../types/update";

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function sanitizeExternalUrl(value?: string) {
  if (!isNonEmptyString(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeVersionParts(version: string) {
  return version.replace(/^v/i, "").split(".").map((part) => {
    const match = part.match(/\d+/);
    return match ? Number(match[0]) : 0;
  });
}

export function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersionParts(left);
  const rightParts = normalizeVersionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

type UpdateManifestDefaults = Pick<UpdateManifest, "githubUrl" | "baiduUrl" | "baiduCode">;

export function normalizeUpdateManifest(
  rawManifest: Partial<UpdateManifest>,
  defaults: UpdateManifestDefaults = {},
): UpdateManifest {
  if (!isNonEmptyString(rawManifest.version)) {
    throw new Error("版本清单缺少有效的 version 字段");
  }
  return {
    version: rawManifest.version.trim(),
    releaseNotes: isNonEmptyString(rawManifest.releaseNotes)
      ? rawManifest.releaseNotes.trim()
      : isNonEmptyString(rawManifest.notes)
        ? rawManifest.notes.trim()
        : undefined,
    publishedAt: isNonEmptyString(rawManifest.publishedAt) ? rawManifest.publishedAt.trim() : undefined,
    githubUrl: sanitizeExternalUrl(rawManifest.githubUrl) ?? defaults.githubUrl,
    baiduUrl: sanitizeExternalUrl(rawManifest.baiduUrl) ?? defaults.baiduUrl,
    baiduCode: isNonEmptyString(rawManifest.baiduCode) ? rawManifest.baiduCode.trim() : defaults.baiduCode,
  };
}
