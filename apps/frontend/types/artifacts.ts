// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { MediaFile as ImportedMediaFile } from "./media";

/**
 * Artifact workflow stages - finite and ordered
 * From novel import to final export, plus media library
 */
export type ArtifactStage =
  | "novel"
  | "analysis"
  | "script"
  | "assets"
  | "storyboard"
  | "image"
  | "voice"
  | "production"
  | "editing"
  | "remotion"
  | "export"
  | "backup"
  | "media-library"
  | "project-store";

/**
 * Artifact kinds - what type of artifact it is
 */
export type ArtifactKind =
  // Novel/script content roots
  | "novel-chapter"
  | "script-episode"
  | "script-scene"
  // Storyboard and images
  | "storyboard-item"
  | "storyboard-image-workflow"
  // Assets
  | "character-variant"
  | "scene-derivative"
  | "prop-derivative"
  | "base-character"
  | "base-scene"
  | "base-prop"
  // TTS/Voice
  | "tts-scene-voice-line"
  | "tts-voice-profile"
  | "tts-voice-binding"
  // Production tracks
  | "production-track"
  | "video-candidate"
  // 按场分段（Remotion chapter-scene）
  | "scene-segment"
  // Editing
  | "editing-project"
  | "editing-run"
  | "editing-render"
  // Remotion workspace
  | "remotion-manifest"
  | "remotion-job"
  | "remotion-audio"
  | "remotion-output"
  | "remotion-queue"
  | "remotion-current-slot"
  // Continuity bibles
  | "continuity-bible"
  // Agent workflows
  | "agent-workflow-result"
  | "director-entity-extraction"
  | "director-plan"
  // Media files
  | "media-file"
  // Physical exports
  | "export-frame"
  | "export-segment"
  | "export-video"
  | "export-audio"
  | "export-report";

/**
 * Artifact state - current status
 */
export type ArtifactState =
  | "active"
  | "archived"
  | "orphaned"
  | "blocked"
  | "unknown";

/**
 * Deletion policy - what happens when parent scope is deleted
 */
export type DeletePolicy =
  | "delete-exclusive-downstream" // delete if no other upstream references
  | "retain-shared-reference"     // keep if other upstreams exist
  | "protected-base-asset"        // never delete, may need migration
  | "blocker-missing-ownership"   // block until ownership resolved
  | "blocker-running-job";        // block while active jobs exist

/**
 * Discriminated union for IPC request results
 */
export type ArtifactIpcRequest =
  | InventoryRequest
  | PlanRequest
  | ExecuteRequest
  | RecoveryQueryRequest;

interface BaseRequest {
  type: string;
}

/**
 * Inventory IPC request - read-only project scan
 */
export interface InventoryRequest extends BaseRequest {
  type: "inventory";
  payload: { projectId: string; chapterId?: string };
}

/**
 * Deletion plan IPC request - compute deletion scope
 */
export interface PlanRequest extends BaseRequest {
  type: "plan";
  payload: {
    projectId: string;
    chapterId: string;
    scope: "chapter" | "artifacts";
    artifactIds?: string[];
  };
}

/**
 * Deletion execute IPC request - perform destructive operation
 */
export interface ExecuteRequest extends BaseRequest {
  type: "execute";
  payload: {
    planId: string;
    fingerprint: string;
    confirmation: {
      type: "chapter" | "artifacts";
      chapterTitle?: string;
      chapterId?: string;
      artifactCount?: number;
    };
  };
}

/**
 * Transaction recovery query IPC request
 */
export interface RecoveryQueryRequest extends BaseRequest {
  type: "recovery-query";
  payload: { projectId: string };
}

/**
 * IPC response result types - discriminated by success/error
 */
export type InventoryResult =
  | { success: true; data: InventoryData; error?: never }
  | { success: false; error: string; data?: never };

export interface InventoryData {
  projectId: string;
  chapterId?: string;
  artifacts: ArtifactRecord[];
  discrepancies: Discrepancy[];
  blockers: RunningJob[];
  summary: InventorySummary;
}

export interface ArtifactRecord {
  id: string;
  projectId: string;
  chapterId?: string;
  stage: ArtifactStage;
  kind: ArtifactKind;
  state: ArtifactState;
  name: string;
  createdAt: number;
  updatedAt: number;
  bytes?: number;
  physicalRefs: PhysicalRef[];
  upstreamIds: string[];
  downstreamIds: string[];
  deletePolicy: DeletePolicy;
  editRoute?: string;
  retainedReason?: string;
  blockerReason?: string;
  metadata?: MetadataOverlay;
}

export interface MetadataOverlay {
  name?: string;
  tags?: string[];
  notes?: string;
  updatedAt: number;
}

export interface PhysicalRef {
  type: "local-media" | "project-file" | "exports" | "remotion" | "backup";
  path: string; // normalized relative or local-protocol path
  bytes?: number;
  hash256?: string;
  special?: "symlink" | "special-file" | "cross-root";
}

export interface Discrepancy {
  type: "live-vs-disk" | "missing-index" | "invalid-json" | "unresolved-ownership";
  description: string;
  affectedArtifacts: string[];
}

export interface InventorySummary {
  totalArtifacts: number;
  byStage: Record<ArtifactStage, number>;
  byKind: Record<ArtifactKind, number>;
  byState: Record<ArtifactState, number>;
  totalBytes: number;
  deleteEligible: number;
  retainDueToShared: number;
  blockedByJobs: number;
  blockedByUnknown: number;
}

export interface RunningJob {
  jobId: string;
  projectId: string;
  chapterId?: string;
  type: "generation" | "tts" | "editing" | "remotion";
  startedAt: number;
}

/**
 * Deletion plan result
 */
export type PlanResult =
  | { success: true; data: DeletionPlan; error?: never }
  | { success: false; error: string; data?: never };

export interface DeletionPlan {
  planId: string;
  schemaVersion: string;
  projectId: string;
  chapterId: string;
  scope: "chapter" | "artifacts";
  /** Exact renderer selection used to rebuild artifact-scoped plans at execute time. */
  selectedArtifactIds: string[];
  createdAt: number;
  fingerprint: string;
  deleteItems: PlanItem[];
  migrateItems: PlanItem[];
  retainItems: PlanItem[];
  blockerItems: PlanItem[];
  backupImpact: BackupImpact[];
  byteTotals: {
    deleteBytes: number;
    migrateBytes: number;
    retainBytes: number;
    totalBytes: number;
  };
  confirmationRequired: {
    type: "chapter-title" | "chapter-id" | "artifact-count";
    value?: string;
    count?: number;
  };
  executionAllowed: boolean;
}

export interface PlanItem {
  artifactId: string;
  kind: ArtifactKind;
  stage: ArtifactStage;
  name: string;
  bytes?: number;
  physicalPath?: string;
  physicalHash256?: string;
  physicalRefs?: PhysicalRef[];
  reason?: string; // why delete/migrate/retain/block
  upstreamOwnerIds?: string[]; // for retain/blocked items
}

export interface BackupImpact {
  format: "chapter-only-backup" | "mixed-multi-chapter-backup" | "legacy-format";
  filePath: string;
  action: "delete" | "rewrite" | "block";
  reason?: string;
}

/**
 * Execution result
 */
export type ExecuteResult =
  | {
      success: true;
      data: ExecutionSuccessData;
      error?: never;
      journalState: "committed" | "rollback-incomplete";
    }
  | {
      success: false;
      error: TypedExecuteError;
      data?: never;
      journalState: "prepared" | "commit-ready" | "none";
    };

export interface ExecutionSuccessData {
  planId: string;
  chaptersAffected: string[];
  artifactsDeleted: number;
  artifactsMigrated: number;
  bytesFreed: number;
  backupsModified: string[];
  postScan: PostScanResult;
  completedAt: number;
}

export type TypedExecuteError =
  | "fingerprint-drift"
  | "scope-expanded-across-chapters"
  | "confirmation-mismatch"
  | "symlink-detected"
  | "cross-root-path"
  | "special-file-detected"
  | "insufficient-free-space"
  | "project-lock-hold"
  | "per-file-lock-failure"
  | "protected-asset-copy-failed"
  | "json-rewrite-failed"
  | "physical-delete-failed"
  | "store-rehydration-failed"
  | "post-scan-orphans"
  | "post-scan-invalid-paths"
  | "post-scan-residual-chapter"
  | "backup-rewrite-failed"
  | "rollback-bundle-write-failed"
  | "rollback-restore-failed"
  | "pre-fingerprint-mismatch"
  | "post-fingerprint-mismatch"
  | "journal-transition-failed"
  | "bundle-corrupt"
  | "missing-bundle-at-commit-ready"
  | "enospace-at-restore";

/**
 * Deletion confirmation payload - shared by Slice 7 and Slice 8
 */
export interface DeletionConfirmation {
  type: "chapter" | "artifacts";
  chapterTitle?: string;
  chapterId?: string;
  artifactCount?: number;
}

export interface PostScanResult {
  orphanRecords: number;
  invalidPaths: number;
  residualChapterFiles: number;
  backupResidue: number;
  crossProjectLeak: number;
  transactionResidue: number;
}

/**
 * Recovery query result
 */
export type RecoveryQueryResult =
  | { success: true; data: RecoveryState; error?: never }
  | { success: false; error: string; data?: never };

export type JournalState = "committed" | "commit-ready" | "prepared" | "none";

export interface RecoveryState {
  journalState: JournalState;
  bundleExists: boolean;
  bundleValid: boolean;
  preFingerprint?: string;
  postFingerprint?: string;
  canAutoRecover: boolean; // committed with GC, or rollback scenarios
  requiredAction: "none" | "gc-bundle" | "rollback" | "manual-recovery";
  errorMessage?: string;
}

/**
 * Metadata update result
 */
export type MetadataUpdateResult =
  | { success: true; data: MetadataOverlay; error?: never }
  | { success: false; error: string; data?: never };

export interface MetadataOverlay {
  artifactId: string;
  name?: string;
  tags?: string[];
  notes?: string;
  updatedAt: number;
}

/**
 * Shared decoder types for persisted stores and backups
 */
export type StoreDecoder =
  | StudioStoreDecoder
  | ScriptStoreDecoder
  | DirectorStoreDecoder
  | EditingStoreDecoder
  | TTSSStoreDecoder
  | MediaStoreDecoder
  | RemotionStoreDecoder
  | MixedBackupDecoder;

export interface StudioStoreDecoder {
  type: "studio-store";
  version: number;
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { projectId?: string; episodeId?: string; novelChapters?: NovelChapter[] };
}

export interface ScriptStoreDecoder {
  type: "script-store";
  version: number;
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { projectId?: string; scriptData?: { episodes: Episode[] } };
}

export interface Episode {
  id: string;
  index: number;
  title?: string;
  scenes?: Scene[];
}

export interface Scene {
  id: string;
  shotList?: Shot[];
}

export interface Shot {
  id: string;
  episodeId: string;
}

export interface NovelChapter {
  id: string;
  chapterNumber: number;
  contentRef?: string;
}

export interface DirectorStoreDecoder {
  type: "director-store";
  version: number;
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { storyboardItems: StoryboardItem[] };
}

export interface StoryboardItem {
  id: string;
  episodeId: string;
  index: number;
  target?: { kind: string; id?: string };
}

export interface EditingStoreDecoder {
  type: "editing-store";
  version: number;
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { editingProjects: EditingProject[] };
}

export interface EditingProject {
  id: string;
  projectId: string;
  episodeId?: string;
}

export interface TTSSStoreDecoder {
  type: "tts-store";
  version: number;
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { voiceLines: SceneVoiceLine[]; profiles?: VoiceProfile[] };
}

export interface SceneVoiceLine {
  sceneId: number; // legacy numeric, new has projectId/chapterId
  projectId?: string;
  chapterId?: string;
  audioRef?: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
}

export interface MediaStoreDecoder {
  type: "media-store";
  version: number;
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { mediaFiles: ImportedMediaFile[] };
}

export interface RemotionStoreDecoder {
  type: "remotion-store";
  version: number;
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { manifest?: RemotionManifest; jobs?: RemotionJob[] };
}

/**
 * All Remotion records are chapter-scoped, never episode-scoped
 */
export interface RemotionManifest {
  chapterId?: string;  // ← Never episodeId!
  projectId?: string;
}

/**
 * All Remotion records are chapter-scoped, never episode-scoped
 */
export interface RemotionJob {
  id: string;
  chapterId?: string;  // ← Never episodeId!
  projectId?: string;
}

export interface MixedBackupDecoder {
  type: "mixed-backup";
  formatName: string;
  versionRange?: [number, number];
  matches: (data: unknown) => boolean;
  decode: (raw: unknown) => { artifacts: MixedBackupArtifact[]; untouchedProjectionHash?: string };
  /** Rewrite the raw backup without changing records outside the target scope. */
  rewrite?: (raw: unknown, chapterId: string, artifactIds: ReadonlySet<string>) => unknown;
}

export interface MixedBackupArtifact {
  projectId: string;
  chapterId?: string;
  stage: string;
  data: unknown;
}
