import type { StoryboardMediaRef, StudioMaterial } from "@/types/studio";

export interface CreateMaterialRecordInput {
  name: string;
  localPath: string;
  size: number;
  importedAt?: number;
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]);

export function inferMaterialKind(nameOrPath: string): StudioMaterial["kind"] {
  const ext = getExtension(nameOrPath);
  if (imageExtensions.has(ext)) return "image";
  if (videoExtensions.has(ext)) return "video";
  if (audioExtensions.has(ext)) return "audio";
  return "image";
}

export function createMaterialRecord(input: CreateMaterialRecordInput): StudioMaterial {
  const importedAt = input.importedAt ?? Date.now();
  const sourceName = input.name.trim() || "material";
  return {
    id: `material-${importedAt}-${slugify(sourceName)}`,
    name: sourceName,
    kind: inferMaterialKind(sourceName || input.localPath),
    localPath: input.localPath,
    sourceName,
    size: Math.max(0, input.size || 0),
    importedAt,
  };
}

export function buildMediaRefFromMaterial(material: StudioMaterial): StoryboardMediaRef {
  return {
    kind: material.kind,
    path: material.localPath,
  };
}

function getExtension(value: string) {
  const clean = value.split("?")[0]?.split("#")[0] ?? value;
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index).toLowerCase() : "";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "material";
}
