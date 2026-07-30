import type { EditingRenderSettings, EditingTransform } from "./editing";

export const REMOTION_STAGE_STATUSES = [
  "pending",
  "blocked",
  "ready",
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "stale",
] as const;

export type RemotionStageStatus = typeof REMOTION_STAGE_STATUSES[number];

export const REMOTION_STAGE_IDS = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"] as const;
export type RemotionStageId = typeof REMOTION_STAGE_IDS[number];

export const REMOTION_COMPOSITION_IDS = ["StoryboardShot", "ChapterVideo"] as const;
export type RemotionCompositionId = typeof REMOTION_COMPOSITION_IDS[number];

export const REMOTION_MEDIA_ROLES = ["voice", "bgm", "sfx", "ambience"] as const;
export type RemotionMediaRole = typeof REMOTION_MEDIA_ROLES[number];

export const REMOTION_STUDIO_ALLOWED_WRITE_FIELDS = [
  "shotOrder",
  "duration",
  "crop",
  "transform",
  "volume",
  "subtitle",
  "transition",
] as const;

export type RemotionStudioAllowedWriteField = typeof REMOTION_STUDIO_ALLOWED_WRITE_FIELDS[number];

export interface RemotionMediaProvenanceV1 {
  sourceKind: "storyboard" | "generated" | "imported" | "remotion-output";
  sourceId: string;
  sourceVersion: string;
}

export interface ProjectMediaReference {
  kind: "project-file" | "local-import";
  projectId: string;
  relativePath: string;
  contentSha256: string;
  provenance: RemotionMediaProvenanceV1;
}

export interface ShotMotionSpec {
  kind: "static" | "pan-zoom";
  fromScale?: number;
  toScale?: number;
  originX?: number;
  originY?: number;
}

export interface RemotionWorkspaceManifestV1 {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  templateId: "mystudio-remotion-v1";
  templateVersion: string;
  remotionVersion: string;
  bundleContentHash: string;
  compositionIds: ["StoryboardShot", "ChapterVideo"];
  defaultRenderSettings: EditingRenderSettings;
  createdAt: number;
  updatedAt: number;
}

export interface RemotionChapterManifestV1 {
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  revision: number;
  sourceSnapshotHash: string;
  requiredShotIds: string[];
  sharedAudioTracks: RemotionSharedAudioTrackV1[];
  shots: RemotionShotDefinitionV1[];
  renderSettings: EditingRenderSettings;
  createdAt: number;
  updatedAt: number;
}

export interface RemotionSharedAudioTrackV1 {
  trackId: string;
  role: RemotionMediaRole;
  source: ProjectMediaReference;
  sourceFingerprint: string;
}

export type RemotionShotAudioBindingV1 =
  | {
      renderScope: "shot";
      role: RemotionMediaRole;
      source: ProjectMediaReference;
      sourceStartUs: number;
      shotStartUs: number;
      durationUs: number;
      volume: number;
    }
  | {
      renderScope: "chapter";
      role: RemotionMediaRole;
      sharedTrackId: string;
      sourceStartUs: number;
      chapterStartUs: number;
      durationUs: number;
      volume: number;
    };

export interface RemotionShotDefinitionV1 {
  shotId: string;
  storyboardId: string;
  index: number;
  revision: number;
  sourceFingerprint: string;
  durationUs: number;
  visualSource: ProjectMediaReference;
  subtitleText?: string;
  audioBindings: RemotionShotAudioBindingV1[];
  motion: ShotMotionSpec;
  transform: EditingTransform;
  approvedContinuityVersion?: string;
}

/**
 * A first-chapter visual approval receipt.  It is deliberately separate from
 * StoryboardItem.visualReview so the queue can prove that the approval belongs
 * to this project, chapter, shot revision and exact visual input.
 */
export interface RemotionShotHumanApprovalV1 {
  schemaVersion: 1;
  projectId: string;
  chapterId: string;
  shotId: string;
  shotRevision: number;
  inputFingerprint: string;
  reviewer: "human";
  approvedAt: number;
  evidencePath: string;
}

export type RemotionRenderJobTarget =
  | { kind: "shot"; chapterId: string; shotId: string; shotRevision: number }
  | { kind: "chapter"; chapterId: string; editingProjectId: string; editingRevision: number };

export interface RemotionRenderJobIdentityV1 {
  projectId: string;
  target: RemotionRenderJobTarget;
  inputHash: string;
  bundleContentHash: string;
  renderSettingsHash: string;
}

export interface RemotionJobError {
  code: string;
  message: string;
  stage: RemotionStageId;
}

export interface RemotionRenderJobV1 extends RemotionRenderJobIdentityV1 {
  schemaVersion: 1;
  jobId: string;
  templateVersion: string;
  remotionVersion: string;
  status: RemotionStageStatus;
  attempt: number;
  /** Normalized progress ratio in the inclusive range 0..1. */
  progress: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: RemotionJobError;
  outputPath?: string;
  evidencePath?: string;
}

export type RemotionMediaProbeStreamV1 =
  | { kind: "video"; codec: "h264"; width: number; height: number }
  | { kind: "audio"; codec: "aac"; channels: number; sampleRate: number };

export interface RemotionEvidenceV1 extends RemotionRenderJobIdentityV1 {
  schemaVersion: 1;
  jobId: string;
  templateVersion: string;
  remotionVersion: string;
  attempt: number;
  compositionId: RemotionCompositionId;
  renderer: { requested: "remotion"; actual: "remotion" };
  outputPath: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  width: number;
  height: number;
  durationUs: number;
  streams: RemotionMediaProbeStreamV1[];
  inputManifestPath: string;
  renderPlanPath?: string;
  snapshotPath?: string;
  startedAt: number;
  completedAt: number;
}

export interface RemotionCurrentSlotPathsV1 {
  jobPath: string;
  evidencePath: string;
  outputPath: string;
}

export interface RemotionCurrentSlotV1 extends RemotionCurrentSlotPathsV1 {
  schemaVersion: 1;
  projectId: string;
  target: RemotionRenderJobTarget;
  job: RemotionRenderJobV1;
  evidence: RemotionEvidenceV1;
  publishedAt: number;
}

export interface RemotionStagedOutputV1 {
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
}

export interface RemotionCurrentSlotPublicationV1 {
  schemaVersion: 1;
  publicationId: string;
  projectId: string;
  target: RemotionRenderJobTarget;
  currentPaths: RemotionCurrentSlotPathsV1;
  stagedJobPath: string;
  stagedEvidencePath: string;
  stagedOutput: RemotionStagedOutputV1;
  job: RemotionRenderJobV1;
  evidence: RemotionEvidenceV1;
  preparedAt: number;
}

export interface RemotionStudioSourceInspectionV1 {
  unknownImports: string[];
  unknownJsxNodes: string[];
  unknownMediaReferences: string[];
  unknownShotIds: string[];
  structureValid: boolean;
}

export interface RemotionStudioSessionContractV1 {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  chapterId: string;
  editingProjectId: string;
  editingRevision: number;
  projectionSourceHash: string;
  projectionSourcePath: string;
  allowedWriteFields: RemotionStudioAllowedWriteField[];
  status: RemotionStageStatus;
  createdAt: number;
  updatedAt: number;
}

export interface RemotionStudioWriteRequestV1 {
  schemaVersion: 1;
  sessionId: string;
  projectId: string;
  chapterId: string;
  editingProjectId: string;
  editingRevision: number;
  projectionSourceHash: string;
  projectionSourcePath: string;
  changedFields: RemotionStudioAllowedWriteField[];
  sourceInspection: RemotionStudioSourceInspectionV1;
}
