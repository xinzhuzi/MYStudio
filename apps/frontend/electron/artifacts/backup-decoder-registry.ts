// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Mixed backup decoder registry
 *
 * Design rationale:
 * - Fail-closed: Unknown backup formats BLOCK deletion (safer than guessing)
 * - Extensible: New decoders can be added as backup formats are discovered
 * - Decoupled: Registry pattern allows runtime extension without recompilation
 * - Stable: Each decoder has explicit version range and matching logic
 */

import type { MixedBackupDecoder, MixedBackupArtifact } from "@/types/artifacts";
import { createHash } from "node:crypto";

/** Registered backup decoders - order matters (first match wins) */
const BACKUP_DECODERS: MixedBackupDecoder[] = [];

/**
 * Register a new backup decoder
 * Must be called at module initialization time
 */
export function registerBackupDecoder(decoder: MixedBackupDecoder): void {
  if (!BACKUP_DECODERS.some((registered) => registered.formatName === decoder.formatName)) {
    BACKUP_DECODERS.push(decoder);
  }
}

/**
 * Find the best decoder for a given raw JSON blob
 * Returns null if no decoder matches (fail-closed behavior)
 */
export function findBackupDecoder(raw: unknown): MixedBackupDecoder | null {
  return BACKUP_DECODERS.find((d) => d.matches(raw)) || null;
}

/**
 * Decode a mixed backup using the best available decoder
 * Throws error "No decoder found for backup format" if no match
 */
export function decodeMixedBackup(raw: unknown): any {
  const decoder = findBackupDecoder(raw);
  if (!decoder) {
    throw new Error(
      `No decoder found for backup format: ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }

  return decoder.decode(raw);
}

export interface BackupRewriteResult {
  value: unknown;
  changed: boolean;
  untouchedProjectionHash: string;
  decoderFormat: string;
}

function recordBelongsToChapter(value: unknown, chapterId: string, artifactIds: ReadonlySet<string>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.chapterId === chapterId
    || record.episodeId === chapterId
    || record.id === chapterId
    || typeof record.id === "string" && artifactIds.has(record.id);
}

function rewriteRecordTree(value: unknown, chapterId: string, artifactIds: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !recordBelongsToChapter(item, chapterId, artifactIds))
      .map((item) => rewriteRecordTree(item, chapterId, artifactIds));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [
    key,
    rewriteRecordTree(child, chapterId, artifactIds),
  ]));
}

function artifactBelongsToChapter(artifact: MixedBackupArtifact, chapterId: string, artifactIds: ReadonlySet<string>): boolean {
  if (artifact.chapterId === chapterId) return true;
  return recordBelongsToChapter(artifact.data, chapterId, artifactIds);
}

function untouchedProjection(decoder: MixedBackupDecoder, raw: unknown, chapterId: string, artifactIds: ReadonlySet<string>): string {
  const retained = decoder.decode(raw).artifacts
    .filter((artifact) => !artifactBelongsToChapter(artifact, chapterId, artifactIds))
    .map((artifact) => ({
      projectId: artifact.projectId,
      chapterId: artifact.chapterId,
      stage: artifact.stage,
      data: artifact.data,
    }));
  return cryptoHash(JSON.stringify(retained));
}

/**
 * Rewrite a registered backup without guessing its shape.  The decoder gate
 * runs before the conservative record walk; an unregistered .bak therefore
 * blocks deletion instead of being silently pruned by filename.
 */
export function rewriteRegisteredBackup(raw: unknown, chapterId: string, artifactIds: ReadonlySet<string>): BackupRewriteResult {
  const decoder = findBackupDecoder(raw);
  if (!decoder) throw new Error("No decoder found for backup format");
  if (!decoder.rewrite) throw new Error("No rewrite implementation for backup format");
  const before = JSON.stringify(raw);
  const beforeProjection = untouchedProjection(decoder, raw, chapterId, artifactIds);
  const value = decoder.rewrite(raw, chapterId, artifactIds);
  const afterDecoded = decoder.decode(value).artifacts;
  if (afterDecoded.some((artifact) => artifactBelongsToChapter(artifact, chapterId, artifactIds))) {
    throw new Error("Backup rewrite left target chapter records");
  }
  const afterProjection = untouchedProjection(decoder, value, chapterId, artifactIds);
  if (beforeProjection !== afterProjection) throw new Error("Backup untouched projection changed");
  return {
    value,
    changed: JSON.stringify(value) !== before,
    untouchedProjectionHash: afterProjection,
    decoderFormat: decoder.formatName,
  };
}

// ============================================================================
// Registered persisted formats. Unknown JSON/.bak shapes remain blockers.
// ============================================================================

/**
 * Legacy single-chapter backup format.
 * Expected structure:
 * {
 *   projectId: string
 *   chapters: [{ id: string; title?: string; content?: string }]
 *   meta: { version: number; timestamp: number }
 * }
 */
const LEGACY_SINGLECHAPTER_DECODER: MixedBackupDecoder = {
  type: "mixed-backup",
  formatName: "legacy-single-chapter",
  versionRange: [1, 1] as [number, number],

  matches(raw): boolean {
    if (typeof raw !== "object" || raw === null) return false;
    const data = raw as any;

    // Check required fields
    if (typeof data.projectId !== "string") return false;
    if (!Array.isArray(data.chapters)) return false;
    if (!data.meta || typeof data.meta !== "object") return false;

    // Verify all chapters have valid ID strings
    return data.chapters.every(
      (c: any) => typeof c.id === "string" && c.id.length > 0,
    );
  },

  decode(raw): { artifacts: MixedBackupArtifact[]; untouchedProjectionHash?: string } {
    const data = raw as any;
    const artifacts: MixedBackupArtifact[] = data.chapters.map((c: any) => ({
      projectId: data.projectId,
      chapterId: c.id,
      stage: "novel",
      data: {
        id: c.id,
        title: c.title,
        content: c.content,
      },
    }));

    // Generate hash of unchanged projection for verification
    const untouchedHash = cryptoHash(JSON.stringify({
      chapters: data.chapters.filter((c: any) => c.id !== "current-chapter"),
      meta: data.meta,
    }));

    return { artifacts, untouchedProjectionHash: untouchedHash };
  },
  rewrite(raw, chapterId, artifactIds) {
    const data = raw as { chapters: unknown[] };
    return {
      ...data,
      chapters: data.chapters.filter((chapter) => !recordBelongsToChapter(chapter, chapterId, artifactIds)),
    };
  },
};

/**
 * Multi-chapter serialized state format.
 * Expected structure:
 * {
 *   state: {
 *     novelChapters: [...],
 *     scriptData: { episodes: [...] },
 *     editingProjects: [...],
 *     // ... other store data
 *   }
 *   projectId: string
 *   timestamp: number
 *   version: number
 * }
 */
const MULTICHAPTER_STATE_DECODER: MixedBackupDecoder = {
  type: "mixed-backup",
  formatName: "multi-chapter-state",
  versionRange: [1, 2] as [number, number],

  matches(raw): boolean {
    if (typeof raw !== "object" || raw === null) return false;
    const data = raw as any;

    // Check for nested state object
    if (typeof data.state !== "object" || data.state === null) return false;

    // At least one store should be present
    const hasNovel = Array.isArray(data.state.novelChapters);
    const hasScript =
      data.state.scriptData &&
      Array.isArray(data.state.scriptData.episodes);

    // Must have at least one major store
    if (!hasNovel && !hasScript) return false;

    // Verify metadata
    if (typeof data.projectId !== "string") return false;
    if (typeof data.timestamp !== "number") return false;

    return true;
  },

  decode(raw): { artifacts: MixedBackupArtifact[]; untouchedProjectionHash?: string } {
    const data = raw as any;
    const state = data.state;
    const artifacts: MixedBackupArtifact[] = [];

    // Extract novel chapters
    if (Array.isArray(state.novelChapters)) {
      state.novelChapters.forEach((c: any) => {
        if (c && typeof c.id === "string") {
          artifacts.push({
            projectId: data.projectId,
            chapterId: c.id,
            stage: "novel",
            data: { ...c },
          });
        }
      });
    }

    // Extract script episodes
    if (state.scriptData?.episodes && Array.isArray(state.scriptData.episodes)) {
      state.scriptData.episodes.forEach((e: any) => {
        if (e && typeof e.id === "string") {
          artifacts.push({
            projectId: data.projectId,
            chapterId: e.id,
            stage: "script",
            data: { ...e },
          });
        }
      });
    }

    // Add more stages as needed (storyboard, production, etc.)

    // Generate hash of untouched projection
    const untouchedHash = cryptoHash(JSON.stringify(state));

    return { artifacts, untouchedProjectionHash: untouchedHash };
  },
  rewrite(raw, chapterId, artifactIds) {
    return rewriteRecordTree(raw, chapterId, artifactIds);
  },
};

// Helper function to generate simple SHA-256-like hashes for verification
function cryptoHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

registerBackupDecoder(MULTICHAPTER_STATE_DECODER);
registerBackupDecoder(LEGACY_SINGLECHAPTER_DECODER);

const ZUSTAND_PROJECT_STATE_DECODER: MixedBackupDecoder = {
  type: "mixed-backup",
  formatName: "zustand-project-state",
  versionRange: [0, Number.MAX_SAFE_INTEGER],
  matches(raw): boolean {
    if (typeof raw !== "object" || raw === null) return false;
    const data = raw as Record<string, unknown>;
    if (!data.state || typeof data.state !== "object" || Array.isArray(data.state)) return false;
    const state = data.state as Record<string, unknown>;
    return typeof data.projectId === "string"
      || Array.isArray(state.novelChapters)
      || Array.isArray(state.storyboards)
      || Array.isArray(state.mediaFiles)
      || Boolean(state.scriptData)
      || Boolean(state.projects);
  },
  decode(raw) {
    const data = raw as { projectId?: string; state: Record<string, unknown> };
    const artifacts: MixedBackupArtifact[] = [];
    const add = (value: unknown, stage: MixedBackupArtifact["stage"], idIsChapter = false) => {
      if (!Array.isArray(value)) return;
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const record = item as { id?: unknown; chapterId?: unknown; episodeId?: unknown };
        if (typeof record.id !== "string") continue;
        artifacts.push({
          projectId: data.projectId ?? "",
          chapterId: typeof record.chapterId === "string" ? record.chapterId : typeof record.episodeId === "string" ? record.episodeId : idIsChapter ? record.id : undefined,
          stage,
          data: item,
        });
      }
    };
    add(data.state.novelChapters, "novel", true);
    add(data.state.episodes, "script", true);
    add(data.state.storyboards, "storyboard");
    add(data.state.tracks, "production");
    add(data.state.productionTracks, "production");
    add(data.state.videoCandidates, "production");
    add(data.state.mediaFiles, "media-library");
    const scriptData = data.state.scriptData;
    if (scriptData && typeof scriptData === "object") {
      const script = scriptData as Record<string, unknown>;
      add(script.episodes, "script", true);
      add(script.scenes, "script");
    }
    const projects = data.state.projects;
    if (projects && typeof projects === "object" && !Array.isArray(projects)) {
      for (const project of Object.values(projects as Record<string, unknown>)) {
        if (!project || typeof project !== "object") continue;
        const projectData = project as Record<string, unknown>;
        const nestedScript = projectData.scriptData;
        if (nestedScript && typeof nestedScript === "object") {
          const script = nestedScript as Record<string, unknown>;
          add(script.episodes, "script", true);
          add(script.scenes, "script");
        }
      }
    }
    return { artifacts, untouchedProjectionHash: cryptoHash(JSON.stringify(data.state)) };
  },
  rewrite(raw, chapterId, artifactIds) {
    return rewriteRecordTree(raw, chapterId, artifactIds);
  },
};
registerBackupDecoder(ZUSTAND_PROJECT_STATE_DECODER);

// Export templates for regression tests and tooling
export { LEGACY_SINGLECHAPTER_DECODER, MULTICHAPTER_STATE_DECODER };
