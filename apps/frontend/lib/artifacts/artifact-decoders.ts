// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Runtime decoders for artifact IPC contracts and persisted snapshots.
 * Strict validation: rejects unknown fields to prevent scope expansion.
 */

import { z } from "zod";

// ============== Shared Primitive Schemas ==============

const ArtifactStageSchema = z.enum([
  "novel",
  "analysis",
  "script",
  "assets",
  "storyboard",
  "image",
  "voice",
  "production",
  "editing",
  "remotion",
  "export",
  "backup",
  "media-library",
]);

export type ArtifactStage = z.infer<typeof ArtifactStageSchema>;

const ArtifactKindSchema = z.enum([
  // Novel/script content roots
  "novel-chapter",
  "script-episode",
  "script-scene",
  // Storyboard and images
  "storyboard-item",
  "storyboard-image-workflow",
  // Assets
  "character-variant",
  "scene-derivative",
  "prop-derivative",
  "base-character",
  "base-scene",
  "base-prop",
  // TTS/Voice
  "tts-scene-voice-line",
  "tts-voice-profile",
  "tts-voice-binding",
  // Production tracks
  "production-track",
  "video-candidate",
  // Editing
  "editing-project",
  "editing-run",
  "editing-render",
  // Remotion workspace
  "remotion-manifest",
  "remotion-job",
  "remotion-audio",
  "remotion-output",
  "remotion-queue",
  "remotion-current-slot",
  // Continuity bibles
  "continuity-bible",
  // Agent workflows
  "agent-workflow-result",
  "director-entity-extraction",
  "director-plan",
  // Media files
  "media-file",
  // Physical exports
  "export-frame",
  "export-segment",
  "export-video",
  "export-audio",
  "export-report",
]);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

const ArtifactStateSchema = z.enum(["active", "archived", "orphaned", "blocked", "unknown"]);

export type ArtifactState = z.infer<typeof ArtifactStateSchema>;

const DeletePolicySchema = z.enum([
  "delete-exclusive-downstream",
  "retain-shared-reference",
  "protected-base-asset",
  "blocker-missing-ownership",
  "blocker-running-job",
]);

export type DeletePolicy = z.infer<typeof DeletePolicySchema>;

const PhysicalRefTypeSchema = z.enum(["local-media", "project-file", "exports", "remotion", "backup"]);

export type PhysicalRefType = z.infer<typeof PhysicalRefTypeSchema>;

const SpecialFileTypeSchema = z.enum(["symlink", "special-file", "cross-root"]);

export type SpecialFileType = z.infer<typeof SpecialFileTypeSchema>;

const JournalStateSchema = z.enum(["committed", "commit-ready", "prepared", "none"]);

export type JournalState = z.infer<typeof JournalStateSchema>;

const BackupFormatSchema = z.enum(["chapter-only-backup", "mixed-multi-chapter-backup", "legacy-format"]);

export type BackupFormat = z.infer<typeof BackupFormatSchema>;

const RunningJobTypeSchema = z.enum(["generation", "tts", "editing", "remotion"]);

export type RunningJobType = z.infer<typeof RunningJobTypeSchema>;

const DiscrepancyTypeSchema = z.enum([
  "live-vs-disk",
  "missing-index",
  "invalid-json",
  "unresolved-ownership",
]);

export type DiscrepancyType = z.infer<typeof DiscrepancyTypeSchema>;

const ConfirmTypeSchema = z.enum(["chapter-title", "chapter-id", "artifact-count"]);

export type ConfirmType = z.infer<typeof ConfirmTypeSchema>;

const BackupActionSchema = z.enum(["delete", "rewrite", "block"]);

export type BackupAction = z.infer<typeof BackupActionSchema>;

const TypedExecuteErrorSchema = z.enum([
  "fingerprint-drift",
  "scope-expanded-across-chapters",
  "confirmation-mismatch",
  "symlink-detected",
  "cross-root-path",
  "special-file-detected",
  "insufficient-free-space",
  "project-lock-hold",
  "per-file-lock-failure",
  "protected-asset-copy-failed",
  "json-rewrite-failed",
  "physical-delete-failed",
  "store-rehydration-failed",
  "post-scan-orphans",
  "post-scan-invalid-paths",
  "post-scan-residual-chapter",
  "backup-rewrite-failed",
  "rollback-bundle-write-failed",
  "rollback-restore-failed",
  "pre-fingerprint-mismatch",
  "post-fingerprint-mismatch",
  "journal-transition-failed",
  "bundle-corrupt",
  "missing-bundle-at-commit-ready",
  "enospace-at-restore",
]);

export type TypedExecuteError = z.infer<typeof TypedExecuteErrorSchema>;

const RequiredActionSchema = z.enum(["none", "gc-bundle", "rollback", "manual-recovery"]);

export type RequiredAction = z.infer<typeof RequiredActionSchema>;

// ============== IPC Request Decoders ==============

/**
 * Base request schema - strict mode rejects unknown fields
 */
const BaseRequestSchema = z.object({
  type: z.string(),
});

/**
 * Inventory request decoder - validates projectId + optional chapterId
 */
export const InventoryRequestDecoder = BaseRequestSchema.extend({
  type: z.literal("inventory"),
  payload: z.object({
    projectId: z.string().min(1),
    chapterId: z.string().optional(),
  }).catchall(z.never()),
});

/**
 * Plan request decoder - validates project/chapter identity + scope
 */
export const PlanRequestDecoder = BaseRequestSchema.extend({
  type: z.literal("plan"),
  payload: z.object({
    projectId: z.string().min(1),
    chapterId: z.string().min(1),
    scope: z.enum(["chapter", "artifacts"]),
    artifactIds: z.array(z.string()).optional(),
  }).catchall(z.never()),
});

/**
 * Execute request decoder - validates planId + fingerprint + confirmation structure
 */
export const ExecuteRequestDecoder = BaseRequestSchema.extend({
  type: z.literal("execute"),
  payload: z.object({
    planId: z.string().min(1),
    fingerprint: z.string().min(1),
    confirmation: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("chapter"),
        chapterTitle: z.string().optional(),
        chapterId: z.string().optional(),
      }).refine(data => data.chapterTitle !== undefined || data.chapterId !== undefined, {
        message: "chapter confirmation requires either chapterTitle or chapterId",
      }),
      z.object({
        type: z.literal("artifacts"),
        artifactCount: z.number().int().positive(),
      }),
    ]),
  }).catchall(z.never()),
});

/**
 * Recovery query request decoder
 */
export const RecoveryQueryRequestDecoder = BaseRequestSchema.extend({
  type: z.literal("recovery-query"),
  payload: z.object({
    projectId: z.string().min(1),
  }).catchall(z.never()),
});

// ============== IPC Result Decoders ==============

/**
 * Generic success/error response wrapper
 */
const SuccessWrapperSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.discriminatedUnion("success", [
    z.object({
      success: z.literal(true),
      data: dataSchema,
      error: z.undefined(),
    }),
    z.object({
      success: z.literal(false),
      error: z.string(),
      data: z.undefined(),
    }),
  ]);

/**
 * Inventory result decoder
 */
const PhysicalRefSchema = z.object({
  type: PhysicalRefTypeSchema,
  path: z.string().min(1),
  bytes: z.number().optional(),
  hash256: z.string().optional(),
  special: SpecialFileTypeSchema.optional(),
}).strict();

const ArtifactRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  chapterId: z.string().optional(),
  stage: ArtifactStageSchema,
  kind: ArtifactKindSchema,
  state: ArtifactStateSchema,
  name: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  bytes: z.number().optional(),
  physicalRefs: z.array(PhysicalRefSchema),
  upstreamIds: z.array(z.string()),
  downstreamIds: z.array(z.string()),
  deletePolicy: DeletePolicySchema,
  editRoute: z.string().optional(),
  retainedReason: z.string().optional(),
  blockerReason: z.string().optional(),
}).strict();

const RunningJobSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  chapterId: z.string().optional(),
  type: RunningJobTypeSchema,
  startedAt: z.number(),
}).strict();

const InventorySummarySchema = z.object({
  totalArtifacts: z.number().int().nonnegative(),
  byStage: z.record(ArtifactStageSchema, z.number().int().nonnegative()),
  byKind: z.record(ArtifactKindSchema, z.number().int().nonnegative()),
  byState: z.record(ArtifactStateSchema, z.number().int().nonnegative()),
  totalBytes: z.number().int().nonnegative(),
  deleteEligible: z.number().int().nonnegative(),
  retainDueToShared: z.number().int().nonnegative(),
  blockedByJobs: z.number().int().nonnegative(),
  blockedByUnknown: z.number().int().nonnegative(),
}).strict();

const DiscrepancySchema = z.object({
  type: DiscrepancyTypeSchema,
  description: z.string().min(1),
  affectedArtifacts: z.array(z.string()),
}).strict();

const InventoryDataSchema = z.object({
  projectId: z.string().min(1),
  chapterId: z.string().optional(),
  artifacts: z.array(ArtifactRecordSchema),
  discrepancies: z.array(DiscrepancySchema),
  blockers: z.array(RunningJobSchema),
  summary: InventorySummarySchema,
}).strict();

export const InventoryResultDecoder = SuccessWrapperSchema(InventoryDataSchema);

/**
 * Deletion plan item decoder
 */
const PlanItemSchema = z.object({
  artifactId: z.string().min(1),
  kind: ArtifactKindSchema,
  stage: ArtifactStageSchema,
  name: z.string().min(1),
  bytes: z.number().optional(),
  physicalPath: z.string().optional(),
  physicalHash256: z.string().optional(),
  reason: z.string().optional(),
  upstreamOwnerIds: z.array(z.string()).optional(),
}).strict();

const BackupImpactSchema = z.object({
  format: BackupFormatSchema,
  filePath: z.string().min(1),
  action: BackupActionSchema,
  reason: z.string().optional(),
}).strict();

const ByteTotalsSchema = z.object({
  deleteBytes: z.number().int().nonnegative(),
  migrateBytes: z.number().int().nonnegative(),
  retainBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
}).strict();

const ConfirmationRequiredSchema = z.object({
  type: ConfirmTypeSchema,
  value: z.string().optional(),
  count: z.number().int().nonnegative().optional(),
}).strict();

const DeletionPlanSchema = z.object({
  planId: z.string().min(1),
  schemaVersion: z.string(),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  scope: z.enum(["chapter", "artifacts"]),
  createdAt: z.number(),
  fingerprint: z.string().min(1),
  deleteItems: z.array(PlanItemSchema),
  migrateItems: z.array(PlanItemSchema),
  retainItems: z.array(PlanItemSchema),
  blockerItems: z.array(PlanItemSchema),
  backupImpact: z.array(BackupImpactSchema),
  byteTotals: ByteTotalsSchema,
  confirmationRequired: ConfirmationRequiredSchema,
  executionAllowed: z.boolean(),
}).strict();

export const PlanResultDecoder = SuccessWrapperSchema(DeletionPlanSchema);

/**
 * Execution success data decoder
 */
const PostScanResultSchema = z.object({
  orphanRecords: z.number().int().nonnegative(),
  invalidPaths: z.number().int().nonnegative(),
  residualChapterFiles: z.number().int().nonnegative(),
  backupResidue: z.number().int().nonnegative(),
  crossProjectLeak: z.number().int().nonnegative(),
  transactionResidue: z.number().int().nonnegative(),
}).strict();

const ExecutionSuccessDataSchema = z.object({
  planId: z.string().min(1),
  chaptersAffected: z.array(z.string()),
  artifactsDeleted: z.number().int().nonnegative(),
  artifactsMigrated: z.number().int().nonnegative(),
  bytesFreed: z.number().int().nonnegative(),
  backupsModified: z.array(z.string()),
  postScan: PostScanResultSchema,
  completedAt: z.number(),
}).strict();

const ExecuteSuccessVariant = z.object({
  success: z.literal(true),
  data: ExecutionSuccessDataSchema,
  error: z.undefined(),
  journalState: z.union([z.literal("committed"), z.literal("rollback-incomplete")]),
});

const ExecuteFailureVariant = z.object({
  success: z.literal(false),
  error: TypedExecuteErrorSchema,
  data: z.undefined(),
  journalState: z.union([z.literal("prepared"), z.literal("commit-ready"), z.literal("none")]),
});

export const ExecuteResultDecoder = z.union([ExecuteSuccessVariant, ExecuteFailureVariant]);

/**
 * Recovery state decoder
 */
const RecoveryStateSchema = z.object({
  journalState: JournalStateSchema,
  bundleExists: z.boolean(),
  bundleValid: z.boolean(),
  preFingerprint: z.string().optional(),
  postFingerprint: z.string().optional(),
  canAutoRecover: z.boolean(),
  requiredAction: RequiredActionSchema,
  errorMessage: z.string().optional(),
}).strict();

const RecoverySuccessVariant = z.object({
  success: z.literal(true),
  data: RecoveryStateSchema,
  error: z.undefined(),
});

const RecoveryFailureVariant = z.object({
  success: z.literal(false),
  error: z.string(),
  data: z.undefined(),
});

export const RecoveryQueryResultDecoder = z.union([RecoverySuccessVariant, RecoveryFailureVariant]);

/**
 * Metadata overlay decoder
 */
const MetadataOverlaySchema = z.object({
  artifactId: z.string().min(1),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  updatedAt: z.number(),
}).strict();

const MetadataSuccessVariant = z.object({
  success: z.literal(true),
  data: MetadataOverlaySchema,
  error: z.undefined(),
});

const MetadataFailureVariant = z.object({
  success: z.literal(false),
  error: z.string(),
  data: z.undefined(),
});

export const MetadataUpdateResultDecoder = z.union([MetadataSuccessVariant, MetadataFailureVariant]);

// ============== Store Decoder Registry ==============

/**
 * Store decoder interface schemas
 */
export const StudioStoreDecoderSchema = z.object({
  type: z.literal("studio-store"),
  version: z.number().int().positive(),
  matches: z.function(),
  decode: z.function(),
}).strict();

export const ScriptStoreDecoderSchema = z.object({
  type: z.literal("script-store"),
  version: z.number().int().positive(),
  matches: z.function(),
  decode: z.function(),
}).strict();

export const DirectorStoreDecoderSchema = z.object({
  type: z.literal("director-store"),
  version: z.number().int().positive(),
  matches: z.function(),
  decode: z.function(),
}).strict();

export const EditingStoreDecoderSchema = z.object({
  type: z.literal("editing-store"),
  version: z.number().int().positive(),
  matches: z.function(),
  decode: z.function(),
}).strict();

export const TTSSStoreDecoderSchema = z.object({
  type: z.literal("tts-store"),
  version: z.number().int().positive(),
  matches: z.function(),
  decode: z.function(),
}).strict();

export const MediaStoreDecoderSchema = z.object({
  type: z.literal("media-store"),
  version: z.number().int().positive(),
  matches: z.function(),
  decode: z.function(),
}).strict();

export const RemotionStoreDecoderSchema = z.object({
  type: z.literal("remotion-store"),
  version: z.number().int().positive(),
  matches: z.function(),
  decode: z.function(),
}).strict();

export const MixedBackupDecoderSchema = z.object({
  type: z.literal("mixed-backup"),
  formatName: z.string(),
  versionRange: z.tuple([z.number(), z.number()]).optional(),
  matches: z.function(),
  decode: z.function(),
}).strict();

/**
 * Get all registered store decoders for inventory scanning
 */
export function getRegisteredStoreDecoders(): Array<{
  decoder: z.ZodType;
  sourceFile: string;
}> {
  return [];
}

/**
 * Validate a raw JSON object against an IPC request schema and return typed result
 */
export function validateIpcRequest<T extends z.ZodType>(schema: T, rawData: unknown): any {
  return schema.safeParse(rawData);
}
