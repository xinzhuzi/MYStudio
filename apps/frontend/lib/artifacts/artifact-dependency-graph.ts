// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { ArtifactRecord, DeletePolicy, PlanItem, DeletionPlan, BackupImpact, PhysicalRef } from "@/types/artifacts";

/**
 * Exclusive downstream cascade: collect all artifacts that are exclusively
 * downstream of the selected set (no other live upstream references).
 */
export interface DependencyGraphResult {
  deleteSet: string[];
  migrateSet: string[]; // protected assets needing migration
  retainSet: string[]; // shared references
  blockerSet: string[]; // blocked items
}

/**
 * Build a dependency graph from artifact records and compute deletion scope
 * based on deletePolicy rules.
 */
export function buildDeletionScope(
  allArtifacts: ArtifactRecord[],
  selectedArtifactIds: string[],
  chapterId?: string
): DependencyGraphResult {
  if (!allArtifacts || !Array.isArray(allArtifacts)) {
    return { deleteSet: [], migrateSet: [], retainSet: [], blockerSet: [] };
  }

  const artifactMap = new Map<string, ArtifactRecord>();
  allArtifacts.forEach((a) => artifactMap.set(a.id, a));

  const deleteSet = new Set<string>();
  const migrateSet = new Set<string>();
  const retainSet = new Set<string>();
  const blockerSet = new Set<string>();

  // Build reverse index: which artifacts reference each artifact as upstream
  const reverseIndex = new Map<string, string[]>();
  allArtifacts.forEach((artifact) => {
    artifact.upstreamIds.forEach((upId) => {
      if (!reverseIndex.has(upId)) {
        reverseIndex.set(upId, []);
      }
      reverseIndex.get(upId)?.push(artifact.id);
    });
  });

  // Unknown ownership is a blocker only when it can affect the requested
  // scope. Unrelated project-level files (for example a shared asset with no
  // chapter id) must not make an otherwise valid chapter deletion impossible.
  const selectedIds = new Set(selectedArtifactIds);
  // Artifact-level selection (scope="artifacts"): block the plan ONLY for the
  // selected items themselves (you cannot delete an item you selected that has
  // no unique chapter ownership) — never scan the whole project for unrelated
  // blockers. Otherwise picking one orphan backup surfaces dozens of unrelated
  // project-level blockers in the dialog and disables the confirm button.
  // Chapter-wide plans keep the full-tree scan (chapter delete cascades).
  const isArtifactScope = selectedIds.size > 0;
  allArtifacts.forEach((artifact) => {
    const inScopeForBlocker = isArtifactScope
      ? selectedIds.has(artifact.id)
      : (!chapterId
        || artifact.chapterId === chapterId
        || artifact.physicalRefs.some((ref) => ref.path.includes(chapterId)));
    if (inScopeForBlocker && (artifact.deletePolicy === "blocker-missing-ownership" || artifact.deletePolicy === "blocker-running-job")) {
      blockerSet.add(artifact.id);
    }
  });

  // A chapter plan starts at that chapter's roots.  Never use every project
  // record as an implicit root: doing so silently expands a chapter delete.
  const chapterArtifacts = chapterId
    ? allArtifacts.filter((artifact) => artifact.chapterId === chapterId)
    : [];
  const chapterRoots = chapterArtifacts
    .filter((artifact) => artifact.upstreamIds.every((upstreamId) => {
      const upstream = artifactMap.get(upstreamId);
      return !upstream || upstream.chapterId !== chapterId;
    }))
    .map((artifact) => artifact.id);
  const queue = [...(selectedArtifactIds.length === 0
    ? (chapterRoots.length > 0 ? chapterRoots : chapterArtifacts.map((artifact) => artifact.id))
    : selectedArtifactIds)];
  const visited = new Set<string>();
  const projectId = allArtifacts[0]?.projectId;

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const artifact = artifactMap.get(currentId);
    if (!artifact) continue;

    if (projectId && artifact.projectId !== projectId) {
      blockerSet.add(currentId);
      continue;
    }

    if (selectedArtifactIds.length === 0 && chapterId && artifact.chapterId && artifact.chapterId !== chapterId) {
      retainSet.add(currentId);
      continue;
    }

    if (artifact.deletePolicy === "blocker-missing-ownership" || artifact.deletePolicy === "blocker-running-job") {
      blockerSet.add(currentId);
    } else if (artifact.deletePolicy === "protected-base-asset") {
      migrateSet.add(currentId);
    } else if (artifact.deletePolicy === "retain-shared-reference") {
      retainSet.add(currentId);
    } else {
      const otherUpstream = artifact.upstreamIds.some((uid) => {
        const upstream = artifactMap.get(uid);
        if (!upstream) return true;
        if (deleteSet.has(uid) || visited.has(uid)) return false;
        // For an artifact-only plan, an unselected upstream is shared even
        // when it belongs to the same chapter. Chapter-wide plans may cascade
        // through all roots in the requested chapter as one unit.
        return selectedArtifactIds.length > 0 || !chapterId || upstream.chapterId !== chapterId;
      });
      if (otherUpstream) retainSet.add(currentId);
      else deleteSet.add(currentId);
    }

    // Visit only downstream records in the same requested chapter.  A shared
    // downstream record in another chapter remains retained and is shown in
    // the plan rather than silently widening the deletion scope.
    for (const did of reverseIndex.get(currentId) ?? []) {
      const downstream = artifactMap.get(did);
      if (!downstream || visited.has(did)) continue;
      if (chapterId && downstream.chapterId && downstream.chapterId !== chapterId) {
        retainSet.add(did);
        continue;
      }
      queue.push(did);
    }
  }

  // Propagate blockers: if an upstream is blocked, all its downstream are blocked too
  propagateBlockers(artifactMap, blockerSet, deleteSet, reverseIndex, chapterId);

  return {
    deleteSet: Array.from(deleteSet),
    migrateSet: Array.from(migrateSet),
    retainSet: Array.from(retainSet),
    blockerSet: Array.from(blockerSet),
  };
}

/**
 * Propagate blockers through downstream chain
 * If an upstream becomes blocked, its downstream exclusives become blocked too
 */
function propagateBlockers(
  artifactMap: Map<string, ArtifactRecord>,
  blockerSet: Set<string>,
  deleteSet: Set<string>,
  reverseIndex: Map<string, string[]>,
  chapterId?: string,
): void {
  let changed = true;

  while (changed) {
    changed = false;
    const currentBlockers = Array.from(blockerSet);

    for (const blockerId of currentBlockers) {
      const downstreams = reverseIndex.get(blockerId) ?? [];
      downstreams.forEach((downId) => {
        // Only convert to blocker if it wasn't deleted AND hasn't been processed yet
        if (!deleteSet.has(downId) && !blockerSet.has(downId)) {
          const downstream = artifactMap.get(downId);
          if (chapterId && downstream?.chapterId && downstream.chapterId !== chapterId) return;
          if (downstream && downstream.deletePolicy === "delete-exclusive-downstream") {
            blockerSet.add(downId);
            deleteSet.delete(downId); // Remove from delete set
            changed = true;
          }
        }
      });
    }
  }
}

/**
 * Compute deterministic ordering for deletion (topological sort)
 * Ensures children are deleted before parents
 */
export function computeDeletionOrder(
  artifactIds: string[],
  allArtifacts: ArtifactRecord[]
): string[] {
  if (!artifactIds || !Array.isArray(artifactIds) || !allArtifacts || !Array.isArray(allArtifacts)) {
    return [];
  }

  const artifactMap = new Map<string, ArtifactRecord>();
  artifactIds.forEach((id) => artifactMap.set(id, allArtifacts.find((a) => a.id === id)!));

  const degree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  artifactIds.forEach((id) => {
    degree.set(id, 0);
    adj.set(id, []);
  });

  // Build subgraph of selected artifacts
  // For topological sort: we want children first, so edges go FROM parent TO child
  // Degree counts how many parents an item has
  artifactIds.forEach((id) => {
    const artifact = artifactMap.get(id)!;
    const downstreams = artifact.downstreamIds?.filter((d) => artifactIds.includes(d)) ?? [];
    downstreams.forEach((downId) => {
      // Edge from parent (id) to child (downId)
      // Child has one more parent, so increment its degree
      const downDegree = degree.get(downId) ?? 0;
      degree.set(downId, downDegree + 1);
      // Add edge: parent -> child
      const parentAdj = adj.get(id) ?? [];
      parentAdj.push(downId);
      adj.set(id, parentAdj);
    });
  });

  // Kahn's algorithm for topological sort (items with no parents come first)
  const queue: string[] = [];
  artifactIds.forEach((id) => {
    if ((degree.get(id) ?? 0) === 0) {
      queue.push(id);
    }
  });

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    const children = adj.get(current) ?? [];
    children.forEach((child) => {
      const childDegree = degree.get(child) ?? 0;
      degree.set(child, childDegree - 1);
      if ((degree.get(child) ?? 0) === 0) {
        queue.push(child);
      }
    });
  }

  // Reverse: we want parents AFTER children in deletion order
  return result.reverse();
}

/**
 * Check if deletion would create orphaned references
 */
export function detectOrphanedReferences(
  allArtifacts: ArtifactRecord[],
  deleteIds: string[]
): { orphans: string[]; reason: string }[] {
  const artifactMap = new Map<string, ArtifactRecord>();
  allArtifacts.forEach((a) => artifactMap.set(a.id, a));

  const orphaned = new Set<string>();
  const reasons: { orphans: string[]; reason: string }[] = [];

  deleteIds.forEach((delId) => {
    const artifact = artifactMap.get(delId);
    if (!artifact) return;

    // Check if any retained artifact depends on this one
    allArtifacts.forEach((retained) => {
      if (deleteIds.includes(retained.id)) return; // Will be deleted together

      if (retained.upstreamIds.includes(delId)) {
        orphaned.add(retained.id);
        reasons.push({
          orphans: [retained.id],
          reason: `Retained artifact ${retained.name} depends on deleted artifact ${artifact.name}`,
        });
      }
    });
  });

  return Array.from(orphaned).map((id) => ({
    orphans: [id],
    reason: `Orphaned reference detected`,
  }));
}

/**
 * Verify consistency of deletion plan
 */
export function validateDeletionPlan(
  deleteIds: string[],
  retainIds: string[],
  migrateIds: string[],
  blockerIds: string[],
  allArtifacts?: ArtifactRecord[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const allIds = new Set([...deleteIds, ...retainIds, ...migrateIds, ...blockerIds]);

  // Check for duplicates (same ID appearing in multiple categories)
  const seen = new Set<string>();
  [deleteIds, retainIds, migrateIds, blockerIds].forEach((arr) => {
    arr.forEach((id) => {
      if (seen.has(id)) {
        errors.push(`Artifact ID ${id} appears in multiple categories`);
      }
      seen.add(id);
    });
  });

  // If no artifact catalog provided, policy-consistency cannot be verified.
  // Report it as an error so callers know the plan is not fully validated.
  if (!allArtifacts || !Array.isArray(allArtifacts)) {
    errors.push("Cannot verify policy-consistent categorization without artifact catalog");
    return { valid: false, errors };
  }

  // Check all IDs exist in artifact map
  const artifactMap = new Map(allArtifacts.map((a) => [a.id, a]));
  allIds.forEach((id) => {
    if (!artifactMap.has(id)) {
      errors.push(`Unknown artifact ID: ${id}`);
    }
  });

  // Check policy-consistent categorization
  [deleteIds, retainIds, migrateIds, blockerIds].forEach((arr, categoryIdx) => {
    const categoryNames = ["delete", "retain", "migrate", "blocker"];
    arr.forEach((id) => {
      const artifact = artifactMap.get(id);
      if (!artifact) return;

      const expectedPolicy = getCategoryForPolicy(artifact.deletePolicy);
      const actualCategory = categoryNames[categoryIdx];

      // Allow some flexibility: blockers can include any policy
      if (categoryIdx !== 3 && expectedPolicy !== actualCategory) {
        errors.push(
          `Artifact ${id} (${artifact.name}) has policy ${artifact.deletePolicy} but categorized as ${actualCategory}`
        );
      }
    });
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

function getCategoryForPolicy(policy: DeletePolicy): string {
  switch (policy) {
    case "delete-exclusive-downstream":
      return "delete";
    case "retain-shared-reference":
    case "protected-base-asset":
      return "migrate";
    case "blocker-missing-ownership":
    case "blocker-running-job":
      return "blocker";
    default:
      return "blocker";
  }
}

// ============================================================================
// DELETION PLANNING (SLICE 5)
// ============================================================================

/**
 * Build a deterministic fingerprint for a deletion plan
 * Based on normalized representation of affected artifacts
 */
function computePlanFingerprint(
  deleteIds: string[],
  migrateIds: string[],
  retainIds: string[],
  blockerIds: string[]
): string {
  const sorted = {
    delete: [...deleteIds].sort(),
    migrate: [...migrateIds].sort(),
    retain: [...retainIds].sort(),
    blocker: [...blockerIds].sort(),
  };

  const canonical = JSON.stringify(sorted);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  // Simple deterministic hash (could use crypto.subtle for SHA-256 if needed)
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }

  // Convert to hex string (first 16 chars)
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const timestamp = Date.now().toString(16).padStart(8, '0');
  return `${hex}-${timestamp}`;
}

/**
 * Group artifacts by category with totals
 */
function groupArtifactsByCategory(
  items: string[],
  allArtifacts: Map<string, ArtifactRecord>
): PlanItem[] {
  return items.map((id) => {
    const artifact = allArtifacts.get(id);
    if (!artifact) {
      return {
        artifactId: id,
        kind: "unknown" as any,
        stage: "unknown" as any,
        name: `Unknown artifact ${id}`,
      } as unknown as PlanItem;
    }

    const physicalRef = artifact.physicalRefs[0];
    const physicalPath = physicalRef?.path;
    const reason = getReasonForCategory(artifact.deletePolicy, id, artifact, allArtifacts);

    return {
      artifactId: id,
      kind: artifact.kind,
      stage: artifact.stage,
      name: artifact.name,
      bytes: artifact.bytes,
      physicalPath,
      physicalHash256: physicalRef?.hash256,
      physicalRefs: artifact.physicalRefs.map((ref): PhysicalRef => ({ ...ref })),
      reason,
      upstreamOwnerIds: artifact.upstreamIds.filter((uid) => allArtifacts.has(uid)),
    };
  });
}

/**
 * Generate human-readable reason for why an artifact is categorized this way
 */
function getReasonForCategory(
  policy: DeletePolicy,
  artifactId: string,
  artifact: ArtifactRecord,
  allArtifacts: Map<string, ArtifactRecord>
): string {
  switch (policy) {
    case "delete-exclusive-downstream":
      return "No other upstream references - safe to delete";

    case "retain-shared-reference": {
      const owners = artifact.upstreamIds
        .filter((uid) => allArtifacts.has(uid))
        .map((uid) => allArtifacts.get(uid)?.name ?? uid);
      return `Shared with: ${owners.join(", ")}`;
    }

    case "protected-base-asset":
      return "Protected base asset - will be copied to stable location";

    case "blocker-missing-ownership":
      return artifact.blockerReason ?? "Ownership not assigned";

    case "blocker-running-job":
      return artifact.blockerReason ?? "Active job running";

    default:
      return "Policy-based categorization";
  }
}

/**
 * Analyze backup impact for a deletion plan
 * Returns which backup files will be deleted or rewritten
 */
function analyzeBackupImpact(
  deleteItems: PlanItem[],
  migrateItems: PlanItem[],
  allArtifacts: ArtifactRecord[],
  projectId: string,
  chapterId?: string
): BackupImpact[] {
  const impacts: BackupImpact[] = [];

  // Collect all unique backup paths from physical refs
  const backupPaths = new Set<string>();

  const selectedIds = new Set([...deleteItems, ...migrateItems].map((item) => item.artifactId));
  allArtifacts
    .filter((artifact) => selectedIds.has(artifact.id))
    .flatMap((artifact) => artifact.physicalRefs.filter((ref) => ref.type === "backup").map((ref) => ({ artifact, ref })))
    .forEach(({ artifact, ref }) => {
      backupPaths.add(ref.path);
      if (artifact.state === "unknown" || artifact.deletePolicy === "blocker-missing-ownership") {
        impacts.push({
          format: "legacy-format",
          filePath: ref.path,
          action: "block",
          reason: "备份格式或归属无法安全解析，必须先完成解码",
        });
      }
    });

  backupPaths.forEach((backupPath) => {
    if (impacts.some((impact) => impact.filePath === backupPath && impact.action === "block")) return;
    // Determine backup format based on structure
    let format: BackupImpact["format"] = "legacy-format";

    if (chapterId && backupPath.includes(chapterId)) {
      format = "chapter-only-backup";
    } else if (projectId && backupPath.includes(projectId)) {
      format = "mixed-multi-chapter-backup";
    }

    // Chapter-only backups are deleted entirely
    // Mixed backups are rewritten to remove entries
    const action: BackupImpact["action"] =
      format === "chapter-only-backup" ? "delete" : "rewrite";

    impacts.push({
      format,
      filePath: backupPath,
      action,
      reason: format === "chapter-only-backup"
        ? "Chapter-specific backup file removed"
        : "Multi-chapter backup rewritten to exclude deleted entries",
    });
  });

  return impacts;
}

/**
 * Build a complete deletion plan for a chapter or batch of artifacts
 *
 * This is READ-ONLY planning - no actual deletion occurs here.
 * The plan can be reviewed by the user before execution.
 *
 * @param allArtifacts Complete artifact catalog from inventory scan
 * @param selectedArtifactIds User-selected artifact IDs OR empty for chapter-wide
 * @param chapterId Chapter scope identifier (required for chapter-wide plans)
 * @returns DeletionPlan with 4 categories + metadata
 */
export function buildDeletionPlan(
  allArtifacts: ArtifactRecord[],
  selectedArtifactIds: string[],
  chapterId?: string
): { plan: DeletionPlan; valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Input validation
  if (!allArtifacts || !Array.isArray(allArtifacts) || allArtifacts.length === 0) {
    errors.push("No artifacts provided for planning");
    return {
      plan: createEmptyPlan(errors),
      valid: false,
      errors,
    };
  }

  // Build artifact map for efficient lookup
  const artifactMap = new Map<string, ArtifactRecord>();
  allArtifacts.forEach((a) => artifactMap.set(a.id, a));

  // R18 is a contract-boundary rule, not only a UI convention: a batch must
  // resolve to one concrete chapter before dependency traversal starts. When
  // the renderer sends an empty chapterId for an artifact selection, derive
  // the chapter from the selected records so traversal cannot widen into a
  // sibling chapter. Unowned records remain individually reviewable (and are
  // still blocked by their ownership policy), but they cannot form a batch.
  const uniqueSelectedIds = [...new Set(selectedArtifactIds ?? [])];
  if (uniqueSelectedIds.length > 0) {
    const selectedChapterKeys = new Set(uniqueSelectedIds.map((id) => {
      const selected = artifactMap.get(id);
      return selected?.chapterId ?? "__unassigned__";
    }));
    const hasUnassigned = selectedChapterKeys.has("__unassigned__");
    if (selectedChapterKeys.size > 1 || (hasUnassigned && uniqueSelectedIds.length > 1)) {
      errors.push("scope-expanded-across-chapters: selected artifacts must belong to one chapter");
    } else if (!chapterId) {
      const [resolvedChapterId] = selectedChapterKeys;
      if (resolvedChapterId && resolvedChapterId !== "__unassigned__") {
        chapterId = resolvedChapterId;
      }
    }
  }

  if (chapterId && !allArtifacts.some((artifact) => artifact.chapterId === chapterId)) {
    errors.push(`Chapter not found in project inventory: ${chapterId}`);
  }

  // Validate all selected IDs exist and stay within the requested chapter.
  selectedArtifactIds?.forEach((id) => {
    if (!artifactMap.has(id)) {
      errors.push(`Selected artifact ID not found: ${id}`);
    } else if (chapterId && artifactMap.get(id)?.chapterId !== chapterId) {
      errors.push(`Selected artifact ${id} is outside chapter ${chapterId}`);
    }
  });

  // Compute deletion scope using existing logic
  const scope = buildDeletionScope(allArtifacts, selectedArtifactIds, chapterId);

  // Check for overlaps between categories
  const allCategories = [scope.deleteSet, scope.migrateSet, scope.retainSet, scope.blockerSet];
  const seenIds = new Set<string>();

  allCategories.forEach((category) => {
    category.forEach((id) => {
      if (seenIds.has(id)) {
        errors.push(`Artifact ID ${id} appears in multiple categories (overlap detected)`);
      }
      seenIds.add(id);
    });
  });

  // Sort by topological order (children first)
  const sortedDelete = computeDeletionOrder(scope.deleteSet, allArtifacts);
  const sortedMigrate = computeDeletionOrder(scope.migrateSet, allArtifacts);
  const sortedRetain = computeDeletionOrder(scope.retainSet, allArtifacts);
  const sortedBlockers = computeDeletionOrder(scope.blockerSet, allArtifacts);

  // Categorize items with reasons and metadata
  const deleteItems = groupArtifactsByCategory(sortedDelete, artifactMap);
  const migrateItems = groupArtifactsByCategory(sortedMigrate, artifactMap);
  const retainItems = groupArtifactsByCategory(sortedRetain, artifactMap);
  const blockerItems = groupArtifactsByCategory(sortedBlockers, artifactMap);

  // Compute byte totals
  const deleteBytes = deleteItems.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const migrateBytes = migrateItems.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const retainBytes = retainItems.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const totalBytes = deleteBytes + migrateBytes + retainBytes;

  // Analyze backup impact
  const projectId = allArtifacts[0]?.projectId;
  const backupImpact = analyzeBackupImpact(deleteItems, migrateItems, allArtifacts, projectId ?? "", chapterId);
  backupImpact.forEach((impact) => {
    if (impact.action !== "block") return;
    const blockerId = `backup:${impact.filePath}`;
    if (!scope.blockerSet.includes(blockerId)) scope.blockerSet.push(blockerId);
    blockerItems.push({
      artifactId: blockerId,
      kind: "media-file",
      stage: "backup",
      name: impact.filePath,
      physicalPath: impact.filePath,
      reason: impact.reason,
    });
  });

  // Compute confirmation requirements
  let confirmationRequired: DeletionPlan["confirmationRequired"];

  if (scope.deleteSet.length === 0 && scope.migrateSet.length === 0) {
    // No deletions planned - no confirmation needed
    confirmationRequired = { type: "artifact-count", count: 0 };
  } else if (selectedArtifactIds && selectedArtifactIds.length > 0) {
    // Artifact-level selection
    confirmationRequired = {
      type: "artifact-count",
      count: sortedDelete.length + sortedMigrate.length,
    };
  } else if (chapterId) {
    // Chapter-wide scope requires exact chapter-id confirmation.  A caller
    // with a human title can resolve it to the stable id before planning.
    confirmationRequired = {
      type: "chapter-id",
      value: chapterId,
    };
  } else {
    errors.push("Cannot determine confirmation scope - provide chapterId or artifact selection");
    confirmationRequired = { type: "artifact-count", count: 0 };
  }

  // Compute deterministic fingerprint
  const fingerprint = computePlanFingerprint(
    sortedDelete,
    sortedMigrate,
    sortedRetain,
    sortedBlockers
  );

  // Determine if execution is allowed. Validation errors (including a
  // cross-chapter batch) fail closed just like dependency/backup blockers;
  // callers must never be able to register the partially computed plan.
  const executionAllowed = errors.length === 0
    && sortedBlockers.length === 0
    && !backupImpact.some((impact) => impact.action === "block");

  // Assemble final plan object
  const plan: DeletionPlan = {
    planId: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    schemaVersion: "1.0.0",
    projectId: projectId ?? "",
    chapterId: chapterId ?? "",
    scope: selectedArtifactIds && selectedArtifactIds.length > 0 ? "artifacts" : "chapter",
    selectedArtifactIds: uniqueSelectedIds,
    createdAt: Date.now(),
    fingerprint,
    deleteItems,
    migrateItems,
    retainItems,
    blockerItems,
    backupImpact,
    byteTotals: {
      deleteBytes,
      migrateBytes,
      retainBytes,
      totalBytes,
    },
    confirmationRequired,
    executionAllowed,
  };

  // Return result
  return {
    plan,
    valid: errors.length === 0 && executionAllowed,
    errors,
  };
}

/**
 * Create empty plan for error cases
 */
function createEmptyPlan(errors: string[]): DeletionPlan {
  return {
    planId: `plan-empty-${Date.now()}`,
    schemaVersion: "1.0.0",
    projectId: "",
    chapterId: "",
    scope: "artifacts",
    selectedArtifactIds: [],
    createdAt: Date.now(),
    fingerprint: "empty-plan",
    deleteItems: [],
    migrateItems: [],
    retainItems: [],
    blockerItems: [],
    backupImpact: [],
    byteTotals: { deleteBytes: 0, migrateBytes: 0, retainBytes: 0, totalBytes: 0 },
    confirmationRequired: { type: "artifact-count", count: 0 },
    executionAllowed: false,
  };
}
