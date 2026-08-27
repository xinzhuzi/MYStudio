import type {
  EditingAudioEnvelopePoint,
  EditingRenderSettings,
  EditingTransform,
} from "./editing";

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

export const REMOTION_SHOT_AUDIO_ROLES = ["voice", "sfx"] as const;
export type RemotionShotAudioRole = typeof REMOTION_SHOT_AUDIO_ROLES[number];

// 08-18-sfx-beat：sfx=转场音效（chapter-scoped；ducking 不参与语音避让——只落静默尾）。
export const REMOTION_CHAPTER_AUDIO_ROLES = ["bgm", "ambience", "sfx"] as const;
export type RemotionChapterAudioRole = typeof REMOTION_CHAPTER_AUDIO_ROLES[number];

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

export interface RemotionProductionProfileV1 {
  schemaVersion: 1;
  referenceEpisodeDurationMin?: number;
  platformSpec?: string;
  visualManualId?: string;
  directorManualId?: string;
  stylePositioning?: string;
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
  productionProfile?: RemotionProductionProfileV1;
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

export interface RemotionAudioBindingBaseV2 {
  schemaVersion: 2;
  bindingId: string;
  bindingFingerprint: string;
  projectId: string;
  chapterId: string;
  source: ProjectMediaReference;
  sourceFingerprint: string;
  sourceDurationUs: number;
  sourceStartUs: number;
  durationUs: number;
  volume: number;
  fadeInUs: number;
  fadeOutUs: number;
  envelope: EditingAudioEnvelopePoint[];
}

export interface RemotionShotAudioBindingV2 extends RemotionAudioBindingBaseV2 {
  renderScope: "shot";
  shotId: string;
  shotRevision: number;
  role: RemotionShotAudioRole;
  shotStartUs: number;
  ttsInputFingerprint?: string;
}

export interface RemotionChapterAudioDuckingV2 {
  enabled: boolean;
  reductionDb: number;
  attackUs: number;
  releaseUs: number;
}

export interface RemotionChapterAudioBindingV2 extends RemotionAudioBindingBaseV2 {
  renderScope: "chapter";
  role: RemotionChapterAudioRole;
  chapterStartUs: number;
  ducking: RemotionChapterAudioDuckingV2;
}

export interface RemotionShotDefinitionV2
  extends Omit<RemotionShotDefinitionV1, "audioBindings"> {
  audioBindings: RemotionShotAudioBindingV2[];
}

export interface RemotionChapterManifestV2 {
  schemaVersion: 2;
  manifestFingerprint: string;
  projectId: string;
  chapterId: string;
  revision: number;
  sourceSnapshotHash: string;
  requiredShotIds: string[];
  sharedAudioBindings: RemotionChapterAudioBindingV2[];
  shots: RemotionShotDefinitionV2[];
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
  /** 关键帧序列(M2):镜内逐帧视觉源,帧1 ≡ visualSource;缺省=单帧时代数据 */
  keyframes?: Array<{ frameId: string; inUs: number; source: ProjectMediaReference }>;
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
  /** C2 门禁收口:多帧镜的逐帧审核证据(与分镜 keyframes 顺序一致)。
   *  单帧时代数据无此字段;存在时消费方须校验其与当前帧序列精确一致。 */
  evidencePaths?: string[];
}

export type RemotionRenderJobTarget =
  | { kind: "shot"; chapterId: string; shotId: string; shotRevision: number }
  | { kind: "chapter"; chapterId: string; editingProjectId: string; editingRevision: number }
  | { kind: "chapter-scene"; chapterId: string; editingProjectId: string; editingRevision: number; sceneNo: number };

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

export interface RemotionCinematicEvidenceV1 {
  schemaVersion: 1;
  preset: string;
  model: "depth-anything-v2-small";
  inputSha256: string;
  outputSha256: string;
  depthMapPath: string;
  width: number;
  height: number;
}

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
  cinematic?: RemotionCinematicEvidenceV1;
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
