// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type {
  ArtifactRecord,
  Discrepancy,
  RunningJob,
  InventorySummary,
} from "@/types/artifacts";

/**
 * Compare live artifacts with disk artifacts to find discrepancies
 */
export function computeDiscrepancies(
  liveArtifacts: Map<string, ArtifactRecord>,
  diskArtifacts: Map<string, ArtifactRecord>,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Check for disk artifacts not in live state
  for (const [diskId, diskArtifact] of diskArtifacts) {
    if (!liveArtifacts.has(diskId)) {
      discrepancies.push({
        type: "missing-index",
        description: `Artifact on disk not found in live state: ${diskArtifact.name}`,
        affectedArtifacts: [diskId],
      });
    }
  }

  // A live record without a physical reference is valid for in-memory roots;
  // only a disk record missing from the live projection is a discrepancy.

  return discrepancies;
}

/**
 * Calculate inventory summary
 */
export function calculateSummary(
  artifacts: ArtifactRecord[],
  _blockers: RunningJob[],
): InventorySummary {
  const byStage: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let totalBytes = 0;
  let deleteEligible = 0;
  let retainDueToShared = 0;
  let blockedByJobs = 0;
  let blockedByUnknown = 0;

  for (const artifact of artifacts) {
    byStage[artifact.stage] = (byStage[artifact.stage] || 0) + 1;
    byKind[artifact.kind] = (byKind[artifact.kind] || 0) + 1;
    byState[artifact.state] = (byState[artifact.state] || 0) + 1;

    if (artifact.bytes) {
      totalBytes += artifact.bytes;
    }

    if (artifact.deletePolicy === "delete-exclusive-downstream") {
      deleteEligible++;
    } else if (artifact.deletePolicy === "retain-shared-reference") {
      retainDueToShared++;
    } else if (artifact.deletePolicy === "blocker-running-job") {
      blockedByJobs++;
    } else if (artifact.deletePolicy === "blocker-missing-ownership") {
      blockedByUnknown++;
    }
  }

  return {
    totalArtifacts: artifacts.length,
    byStage,
    byKind,
    byState,
    totalBytes,
    deleteEligible,
    retainDueToShared,
    blockedByJobs,
    blockedByUnknown,
  };
}
