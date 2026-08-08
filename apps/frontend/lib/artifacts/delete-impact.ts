// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { LucideIcon } from "lucide-react";
import { CheckCircle2, AlertTriangle, Lock, Ban, FileArchive, Settings } from "lucide-react";
import type { DeletePolicy } from "@/types/artifacts";

/**
 * Delete-impact level for an artifact, derived from its `deletePolicy`.
 *
 * The list view shows one icon per row so users can tell at a glance whether
 * deleting an item is safe, will ripple through the pipeline, or is blocked.
 * The mapping mirrors the backend categorization in
 * `artifact-dependency-graph.ts getCategoryForPolicy`, so what the icon says
 * matches what the deletion plan will actually do.
 *
 * Levels:
 * - `safe`        — exclusive downstream, no other upstream references.
 *                   Deleting it does NOT affect the rest of the pipeline.
 * - `impactful`   — shared reference. Deleting it forces downstream items to be
 *                   migrated or breaks the chain — i.e. it disturbs the flow.
 * - `protected`   — base asset that must be migrated, never directly deleted.
 * - `blocked`     — ownership unresolved or a job is running; cannot delete now.
 */
export type DeleteImpactLevel = "safe" | "impactful" | "protected" | "blocked" | "backup" | "projectConfig";

export interface DeleteImpactMeta {
  level: DeleteImpactLevel;
  /** Short label shown next to the icon in the list column. */
  label: string;
  /** lucide icon component. */
  icon: LucideIcon;
  /** Tailwind classes for the icon + label chip. */
  className: string;
  /** Longer explanation used in tooltips / a11y titles. */
  hint: string;
  /** Does deleting this item disturb the overall pipeline?
   *  `safe` is the only level where this is false. */
  disturbsFlow: boolean;
}

const DELETION_IMPACT_RECORD: Record<DeleteImpactLevel, DeleteImpactMeta> = {
  safe: {
    level: "safe",
    label: "可删",
    icon: CheckCircle2,
    className: "text-green-600",
    hint: "专属产物,删除不影响其它流程,可放心删除。",
    disturbsFlow: false,
  },
  impactful: {
    level: "impactful",
    label: "影响流程",
    icon: AlertTriangle,
    className: "text-yellow-600",
    hint: "被其它产物共享引用,删除会破坏下游流程,可能需要重新制作。",
    disturbsFlow: true,
  },
  protected: {
    level: "protected",
    label: "受保护",
    icon: Lock,
    className: "text-red-600",
    hint: "受保护的基础资产,删除会破坏整体流程,需先迁移。",
    disturbsFlow: true,
  },
  blocked: {
    level: "blocked",
    label: "阻塞",
    icon: Ban,
    className: "text-red-600",
    hint: "归属未决或仍有进行中的任务,当前不可删除。",
    disturbsFlow: true,
  },
  backup: {
    level: "backup",
    label: "可清理备份",
    icon: FileArchive,
    className: "text-gray-500",
    hint: "历史备份残留,删除不影响当前流程,可放心清理。",
    disturbsFlow: false,
  },
  projectConfig: {
    level: "projectConfig",
    label: "项目配置",
    icon: Settings,
    className: "text-blue-600",
    hint: "项目级配置文件,不属于任何章节,不可删除。",
    disturbsFlow: true,
  },
};

/**
 * Subset of an artifact needed to classify its delete impact. The full
 * `ArtifactRecord` satisfies this, but we keep the shape minimal so callers
 * can pass partial / synthetic artifacts (e.g. dependency-graph blocker rows).
 */
export interface DeleteImpactArtifact {
  deletePolicy?: DeletePolicy | null;
  stage?: string;
  kind?: string;
  physicalRefs?: Array<{ type?: string; path?: string }>;
}

/**
 * Map a `deletePolicy` to its delete-impact metadata. Unknown / missing
 * policies default to `blocked` (safest assumption — matches the backend's
 * `getCategoryForPolicy` default branch).
 *
 * NOTE: this only looks at the policy. For backup / project-config icons use
 * {@link getArtifactDeleteImpact}, which inspects physicalRefs first.
 */
export function getDeleteImpact(policy: DeletePolicy | undefined | null): DeleteImpactMeta {
  switch (policy) {
    case "delete-exclusive-downstream":
      return DELETION_IMPACT_RECORD.safe;
    case "retain-shared-reference":
      return DELETION_IMPACT_RECORD.impactful;
    case "protected-base-asset":
      return DELETION_IMPACT_RECORD.protected;
    case "blocker-missing-ownership":
    case "blocker-running-job":
      return DELETION_IMPACT_RECORD.blocked;
    default:
      return DELETION_IMPACT_RECORD.blocked;
  }
}

/**
 * Classify delete impact for an artifact. Backup detection runs first (the
 * narrowest signal: a `physicalRefs` entry of `type:"backup"` — only the
 * inventory scan's backup branch sets this), then project-config detection,
 * then the policy-based fallback.
 *
 * Backup is intentionally NOT keyed off `stage === "backup"` alone: the
 * dependency graph also injects synthetic blocker rows with
 * `stage:"backup"` / `kind:"media-file"` but no `type:"backup"` ref
 * (artifact-dependency-graph.ts:623). Using only the ref type keeps the two
 * cases distinct — scan-origin backups become "可清理备份" while graph-origin
 * backup blockers still fall through to "阻塞".
 */
export function getArtifactDeleteImpact(artifact: DeleteImpactArtifact): DeleteImpactMeta {
  // 1. Backup: scan-origin backup files carry a physicalRef of type "backup".
  //    This is the narrowest, most reliable signal.
  const isBackup = artifact.physicalRefs?.some((r) => r.type === "backup") ?? false;
  if (isBackup) return DELETION_IMPACT_RECORD.backup;

  // 2. Project-level config: a top-level JSON config (path has no "/") that
  //    has no decoder and no chapter ownership. These land as
  //    blocker-missing-ownership with a project-file ref at the repo root.
  //    Sub-directory configs (path contains "/", e.g. remotion/project.json)
  //    are intentionally excluded here — they fall through to "blocked".
  const isProjectConfig =
    artifact.deletePolicy === "blocker-missing-ownership"
    && (artifact.physicalRefs?.some((r) => r.type === "project-file" && typeof r.path === "string" && !r.path.includes("/")) ?? false);
  if (isProjectConfig) return DELETION_IMPACT_RECORD.projectConfig;

  // 3. Otherwise fall back to the policy-based mapping.
  return getDeleteImpact(artifact.deletePolicy);
}
