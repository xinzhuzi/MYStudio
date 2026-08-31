import fs from "node:fs";
import fsp from "node:fs/promises";
import type { ArtifactKind, ArtifactRecord, PhysicalRef } from "@/types/artifacts";
import { createHash } from "node:crypto";

/**
 * 清单扫描共享底座——终态常量/指纹/记录合并/混合类型推断/备份与章节引用工具。file-size-reduction P1 拆出,体逐字保留。
 */
export const REMOTION_TERMINAL_STATUSES = [
  "succeeded",
  "failed",
  "canceled",
] as const;

export type RemotionTerminalStatus = (typeof REMOTION_TERMINAL_STATUSES)[number];

/** Check if a status is terminal (completed) */
export function isRemotionTerminalStatus(
  status: unknown,
): status is RemotionTerminalStatus {
  return typeof status === "string" &&
    REMOTION_TERMINAL_STATUSES.includes(status as RemotionTerminalStatus);
}

/**
 * Calculate SHA-256 fingerprint of a file
 */
export async function calculateFileFingerprint(filePath: string): Promise<{
  bytes: number;
  hash256: string;
}> {
 
  await fsp.stat(filePath);
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    let bytesRead = 0;

    stream.on("data", (chunk) => {
      hash.update(chunk);
      bytesRead += chunk.length;
    });

    stream.on("end", () => {
      resolve({
        bytes: bytesRead,
        hash256: hash.digest("hex"),
      });
    });

    stream.on("error", reject);
  });
}

export function physicalRefType(
  fileKind: "json" | "backup" | "media" | "other",
  _decoderFormat?: string,
): PhysicalRef["type"] {
  if (fileKind === "backup") return "backup";
  // Decoder format describes the JSON payload, not its physical provenance.
  // Active project JSON must remain a project-file even when it uses a legacy
  // or mixed-backup decoder; only the scanner's suffix classification can mark
  // a source as backup.
  return "project-file";
}

export function mergeArtifactRecords(existing: ArtifactRecord, incoming: ArtifactRecord): ArtifactRecord {
  const refs = new Map<string, PhysicalRef>();
  for (const ref of [...existing.physicalRefs, ...incoming.physicalRefs]) {
    refs.set(`${ref.type}:${ref.path}`, ref);
  }
  const physicalRefs = [...refs.values()];
  const referencedBytes = physicalRefs.reduce((sum, ref) => sum + (ref.bytes ?? 0), 0);
  return {
    ...existing,
    chapterId: existing.chapterId ?? incoming.chapterId,
    state: existing.state === "blocked" || incoming.state === "blocked"
      ? "blocked"
      : existing.state === "active" || incoming.state === "active"
        ? "active"
        : existing.state,
    bytes: referencedBytes || existing.bytes || incoming.bytes,
    physicalRefs,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function firstText(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function inferMixedArtifactKind(stage: string, rawData: unknown): ArtifactKind {
  const data = asRecord(rawData);
  switch (stage) {
    case "novel":
      return "novel-chapter";
    case "analysis":
      return Array.isArray(data.entities) || Array.isArray(data.extractions)
        ? "director-entity-extraction"
        : "agent-workflow-result";
    case "script":
      return typeof data.sceneId === "string" || Array.isArray(data.dialogue) || Array.isArray(data.shots)
        ? "script-scene"
        : "script-episode";
    case "assets": {
      const subtype = firstText(data, ["subtype", "type", "assetType"]);
      if (subtype === "character") return data.category === "chapter-exclusive" ? "character-variant" : "base-character";
      if (subtype === "scene") return data.category === "chapter-exclusive" ? "scene-derivative" : "base-scene";
      if (subtype === "prop") return data.category === "chapter-exclusive" ? "prop-derivative" : "base-prop";
      return "media-file";
    }
    case "storyboard":
      return "storyboard-item";
    case "image":
      return "storyboard-image-workflow";
    case "voice":
      return "tts-scene-voice-line";
    case "production":
      return Array.isArray(data.candidateVideoIds) || Array.isArray(data.storyboardIds)
        ? "production-track"
        : "video-candidate";
    case "editing":
      return data.outputPath || data.outputRef ? "editing-render" : data.startedAt ? "editing-run" : "editing-project";
    case "remotion":
      return data.jobId || data.status ? "remotion-job" : data.manifestId || data.compositionId ? "remotion-manifest" : "remotion-output";
    case "export": {
      const pathValue = firstText(data, ["path", "filePath", "outputPath"]);
      if (/\.(?:mp4|webm|mov)$/i.test(pathValue ?? "")) return "export-video";
      if (/\.(?:wav|mp3|m4a|aac|flac)$/i.test(pathValue ?? "")) return "export-audio";
      if (/\.(?:png|jpe?g|webp|gif)$/i.test(pathValue ?? "")) return "export-frame";
      return "export-report";
    }
    default:
      return "media-file";
  }
}

export function inferMixedArtifactName(stage: string, rawData: unknown, index: number): string {
  const data = asRecord(rawData);
  const name = firstText(data, ["name", "title", "displayName", "chapterTitle", "label", "filename", "fileName"]);
  if (name) return name;
  const id = firstText(data, ["id", "chapterId", "episodeId", "sceneId", "panelId", "jobId"]);
  return id ? `${stage} · ${id}` : `${stage} · 条目 ${index + 1}`;
}

export function legacyArtifactIdFor(artifact: ArtifactRecord): string {
  const parts = artifact.id.split(":");
  return parts.length >= 3 ? `${parts[0]}:media-file:${parts.slice(2).join(":")}` : artifact.id;
}

/**
 * Matches historical backup file suffixes so their physical source is
 * classified as `kind:"backup"`. Registered JSON content is still decoded;
 * unregistered or malformed content remains a fail-closed backup blocker.
 *
 * Matches (against the basename, anchored to end):
 * - `.bak`, `.bak-xxx`, `.bak_xxx`
 * - `.bak-sharded-<digits>.json` — renderer-side sharding rename goes through
 *   the file-storage IPC which always appends `.json`, so this exact shape is
 *   carved out (CLI-side rename keeps the suffix-less `.json.bak-sharded-<ts>`
 *   shape already covered by the generic `.bak-xxx` rule above).
 * - `.codex-xxx`, `.codex-white-screen-test-backup`
 * - `.smoke-xxx`
 *
 * Design notes:
 * - Every alternative ends with `$` and uses the no-dot class `[^.]*` after
 *   the separator, so `.codex-` / `.smoke-` only match as the FINAL suffix.
 *   This prevents false positives like `data.codex-backup.json`,
 *   `chapter.codex-snapshot.json` or `report.smoke-test.json` (the `.json`
 *   after `.codex-...` would otherwise be swallowed by a greedy `.*`).
 * - The char class is `[-_]` only — `-` at the start of a class is a literal,
 *   so this is a valid range-free class (no SyntaxError, unlike the addendum's
 *   invalid `[-_-.]` range).
 */
export const BACKUP_SUFFIX_RE = /\.(?:bak(?:[-_][^.]*)?$|bak-sharded-\d+\.json$|codex[-_][^.]*$|smoke[-_][^.]*$)/i;

/**
 * Project-root subdirectories that hold whole-store snapshots rather than live
 * data. Their contents are plain-named `.json` (e.g. `studio-workflow-store.json`)
 * with no `.bak`/`.codex` suffix, so files below these roots must inherit backup
 * provenance while still being decoded and merged into the logical inventory.
 *
 * - `backups` — the unified backup home (08-18 起所有备份写入点收拢于此：
 *   continuity/ storyboard-flow/ visual-continuity/ store/ remotion/ video-use/
 *   分类，见其 README.md)；child JSON files do not carry a backup suffix.
 * - `visual-continuity-backups` — legacy home of promote-pipeline snapshots
 *   (`storyboard-promotion-<timestamp>-<sha>/studio-workflow-store.json`);
 *   new snapshots go to `backups/visual-continuity/`, this root stays
 *   recognized for pre-migration projects.
 *
 * Add further whole-store-snapshot roots here as they are introduced.
 */
export const BACKUP_ROOT_DIRS = new Set<string>(["backups", "visual-continuity-backups"]);

const CHAPTER_REFERENCE_RE = /\b(?:chapter|episode)[-_]\d+\b/gi;

export function collectChapterReferences(value: unknown, output = new Set<string>()): string[] {
  if (typeof value === "string") {
    for (const match of value.matchAll(CHAPTER_REFERENCE_RE)) output.add(match[0].toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) collectChapterReferences(item, output);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectChapterReferences(key, output);
      collectChapterReferences(child, output);
    }
  }
  return [...output].sort();
}

