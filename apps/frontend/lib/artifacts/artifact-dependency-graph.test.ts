// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, test, expect } from "vitest";
import { buildDeletionScope, buildDeletionPlan, computeDeletionOrder, validateDeletionPlan, detectOrphanedReferences } from "./artifact-dependency-graph";
import type { ArtifactRecord, DeletePolicy } from "@/types/artifacts";
import { buildSingleChapterFixture, buildMultiChapterFixture } from "./__fixtures__/fixture-builders";

/**
 * Helper to create artifact records from fixture data
 */
function createArtifacts(
  deletePolicy: DeletePolicy = "delete-exclusive-downstream",
  parentId?: string,
  nameOverride?: string
): ArtifactRecord {
  const id = Math.random().toString(36).slice(2);
  return {
    id,
    projectId: "test-project",
    chapterId: "chapter-001",
    stage: "novel",
    kind: "novel-chapter",
    state: "active",
    name: nameOverride || `Artifact ${id.slice(0, 6)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    physicalRefs: [],
    upstreamIds: parentId ? [parentId] : [],
    downstreamIds: [],
    deletePolicy,
    editRoute: "/studio/novel",
  };
}

/**
 * Helper to assert asset IDs follow the expected STRUCTURE pattern
 * Tests must assert STRUCTURE (regex pattern matching) rather than exact filenames
 * This prevents tests from depending on Python-fixture/runtime data that are not product contracts
 */
function assertAssetIdStructure(assetId: string, expectedPattern: RegExp, testName?: string): void {
  expect(assetId).toMatch(expectedPattern), testName || `Asset ID "${assetId}" should match pattern`;
}

describe("artifact-dependency-graph", () => {
  describe("buildDeletionScope - chapter deletion cascade", () => {
    test("deletes entire chapter tree when all exclusive", () => {
      const { studio } = buildSingleChapterFixture("chapter-001");

      // Verify derived asset IDs use generated pattern (not hardcoded Python fixture IDs)
      const storyboards = studio.storyboards;
      expect(storyboards).toHaveLength(5);
      storyboards.forEach(sb => {
        if (sb.assetIds && sb.assetIds.length > 0) {
          const assetId = sb.assetIds[0];
          // Pattern: character-derived-XXX-name (where XXX is 3-digit chapter index)
          assertAssetIdStructure(assetId, /^character-derived-\d{3}-.*$/, `Storyboard ${sb.id} should have generated asset ID`);
        }
      });

      // Build simplified artifact graph
      const novelChapter = createArtifacts("delete-exclusive-downstream");
      const agentWorkflow1 = createArtifacts("delete-exclusive-downstream", novelChapter.id);
      const agentWorkflow2 = createArtifacts("delete-exclusive-downstream", novelChapter.id);
      const storyboard1 = createArtifacts("delete-exclusive-downstream", novelChapter.id);
      const track = createArtifacts("delete-exclusive-downstream", novelChapter.id);
      const video = createArtifacts("delete-exclusive-downstream", track.id);

      const allArtifacts = [novelChapter, agentWorkflow1, agentWorkflow2, storyboard1, track, video];
      const result = buildDeletionScope(allArtifacts, [novelChapter.id], "chapter-001");

      expect(result.deleteSet).toContain(novelChapter.id);
      expect(result.deleteSet).toContain(agentWorkflow1.id);
      expect(result.deleteSet).toContain(storyboard1.id);
      expect(result.deleteSet).toContain(track.id);
      expect(result.deleteSet).toContain(video.id);
      expect(result.retainSet).toHaveLength(0);
      expect(result.blockerSet).toHaveLength(0);
    });

    test("does not migrate unrelated base assets during chapter deletion", () => {
      const novelChapter = createArtifacts("delete-exclusive-downstream");
      const baseCharacter = createArtifacts("protected-base-asset");
      const derivedAsset = createArtifacts("retain-shared-reference", novelChapter.id);

      baseCharacter.chapterId = "chapter-002";
      const allArtifacts = [novelChapter, baseCharacter, derivedAsset];
      const result = buildDeletionScope(allArtifacts, [novelChapter.id], "chapter-001");

      expect(result.deleteSet).toContain(novelChapter.id);
      expect(result.migrateSet).not.toContain(baseCharacter.id);
      expect(result.retainSet).toContain(derivedAsset.id);
      expect(result.migrateSet).not.toContain(derivedAsset.id);
      expect(result.retainSet).not.toContain(baseCharacter.id);
    });

    test("retains a downstream artifact with another same-chapter upstream", () => {
      const selectedParent = createArtifacts("delete-exclusive-downstream");
      const sharedParent = createArtifacts("delete-exclusive-downstream");
      const downstream = createArtifacts(
        "delete-exclusive-downstream",
        selectedParent.id,
        "shared downstream",
      );
      downstream.upstreamIds = [selectedParent.id, sharedParent.id];

      const result = buildDeletionScope(
        [selectedParent, sharedParent, downstream],
        [selectedParent.id],
        "chapter-001",
      );

      expect(result.deleteSet).toContain(selectedParent.id);
      expect(result.deleteSet).not.toContain(downstream.id);
      expect(result.retainSet).toContain(downstream.id);
    });
  });

  describe("buildDeletionScope - legacy ambiguity blockers", () => {
    test("selected TTS lines with ambiguous sceneId are deletable (user explicitly chose)", () => {
      const ttsLine = createArtifacts("blocker-missing-ownership");
      ttsLine.blockerReason = "Missing chapter ownership (legacy numeric sceneId)";

      const allArtifacts = [ttsLine];
      const result = buildDeletionScope(allArtifacts, [ttsLine.id], "chapter-001");

      // Explicitly selected items with blocker-missing-ownership are
      // deleted, not blocked — the user is intentionally deleting them.
      expect(result.deleteSet).toContain(ttsLine.id);
      expect(result.blockerSet).not.toContain(ttsLine.id);
    });

    test("selected unowned media files are deletable (user explicitly chose)", () => {
      const unownedMedia = createArtifacts("blocker-missing-ownership");
      unownedMedia.blockerReason = "Missing chapter ownership";

      const allArtifacts = [unownedMedia];
      const result = buildDeletionScope(allArtifacts, [unownedMedia.id], "chapter-001");

      // Explicitly selected items with blocker-missing-ownership are
      // deleted, not blocked.
      expect(result.deleteSet).toContain(unownedMedia.id);
      expect(result.blockerSet).not.toContain(unownedMedia.id);
    });

    test("does not block a chapter with an unrelated unowned project artifact", () => {
      const chapterArtifact = createArtifacts("delete-exclusive-downstream");
      const unrelated = createArtifacts("blocker-missing-ownership");
      unrelated.chapterId = undefined;
      unrelated.physicalRefs = [{ type: "project-file", path: "shared/base.png" }];

      const result = buildDeletionScope([chapterArtifact, unrelated], [], "chapter-001");

      expect(result.deleteSet).toContain(chapterArtifact.id);
      expect(result.blockerSet).not.toContain(unrelated.id);
    });
  });

  describe("buildDeletionScope - cross-project rejection", () => {
    test("blocks artifacts from different projects", () => {
      const projectAnchor = createArtifacts("delete-exclusive-downstream");
      const crossProjectArtifact = createArtifacts("blocker-missing-ownership");
      crossProjectArtifact.projectId = "other-project";

      const allArtifacts = [projectAnchor, crossProjectArtifact];
      const result = buildDeletionScope(allArtifacts, [crossProjectArtifact.id], "chapter-001");

      expect(result.blockerSet).toContain(crossProjectArtifact.id);
    });
  });

  describe("computeDeletionOrder - topological sort", () => {
    test("children are deleted before parents", () => {
      const parent = createArtifacts("delete-exclusive-downstream");
      const child1 = createArtifacts("delete-exclusive-downstream", parent.id);
      const child2 = createArtifacts("delete-exclusive-downstream", parent.id);
      const grandchild = createArtifacts("delete-exclusive-downstream", child1.id);

      const allArtifacts = [parent, child1, child2, grandchild];
      const order = computeDeletionOrder([parent.id, child1.id, child2.id, grandchild.id], allArtifacts);

      // Grandchild must come before child1, child1 before parent
      const grandchildIdx = order.indexOf(grandchild.id);
      const child1Idx = order.indexOf(child1.id);
      const parentIdx = order.indexOf(parent.id);

      expect(grandchildIdx).toBeLessThan(child1Idx);
      expect(child1Idx).toBeLessThan(parentIdx);
    });
  });

  describe("validateDeletionPlan - consistency checks", () => {
    test("detects duplicate categorization", () => {
      const art1 = createArtifacts();

      const validation = validateDeletionPlan(
        [art1.id, art1.id], // Duplicate
        [], [], []
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes("appears in multiple"))).toBe(true);
    });

    test("validates policy-consistent categorization", () => {
      const deleteArtifact = createArtifacts("delete-exclusive-downstream");
      const retainArtifact = createArtifacts("retain-shared-reference");

      const validation = validateDeletionPlan(
        [retainArtifact.id], // Wrongly categorized as delete
        [deleteArtifact.id], // Wrongly categorized as retain
        [], []
      );

      // Should warn about policy mismatch
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe("detectOrphanedReferences", () => {
    test("identifies retained artifacts depending on deleted ones", () => {
      const parent = createArtifacts("delete-exclusive-downstream");
      const child = createArtifacts("retain-shared-reference", parent.id);

      const allArtifacts = [parent, child];
      const orphans = detectOrphanedReferences(allArtifacts, [parent.id]);

      expect(orphans.some(o => o.orphans.includes(child.id))).toBe(true);
    });
  });

  describe("multi-chapter scenario - isolation", () => {
    test("only deletes artifacts belonging to target chapter", () => {
      const { chapter1, chapter2 } = buildMultiChapterFixture();

      // Verify derived asset IDs are chapter-specific and follow the generated pattern
      const ch1Storyboards = chapter1.studio.storyboards;
      expect(ch1Storyboards).toHaveLength(5);
      ch1Storyboards.forEach(sb => {
        if (sb.assetIds && sb.assetIds.length > 0) {
          const assetId = sb.assetIds[0];
          // Should match: character-derived-001-mainhero or similar (chapter-001 -> index 1, padded to "001")
          assertAssetIdStructure(assetId, /^character-derived-\d{3}-.*$/, `Chapter 1 storyboard ${sb.id} should have generated asset ID`);
          expect(assetId).toContain("character-derived-001-"); // Chapter 001 maps to index 001
        }
      });

      const ch2Storyboards = chapter2.studio.storyboards;
      expect(ch2Storyboards).toHaveLength(5);
      ch2Storyboards.forEach(sb => {
        if (sb.assetIds && sb.assetIds.length > 0) {
          const assetId = sb.assetIds[0];
          // Should match: character-derived-002-mainhero (chapter-002 -> index 2, padded to "002")
          assertAssetIdStructure(assetId, /^character-derived-\d{3}-.*$/, `Chapter 2 storyboard ${sb.id} should have generated asset ID`);
          expect(assetId).toContain("character-derived-002-"); // Chapter 002 maps to index 002
        }
      });

      // Simulate deleting only chapter 1's novel chapter
      const ch1Novel = createArtifacts("delete-exclusive-downstream");
      const ch2Novel = createArtifacts("delete-exclusive-downstream");
      ch2Novel.chapterId = "chapter-002";
      ch2Novel.projectId = "test-project";

      const allArtifacts = [ch1Novel, ch2Novel];
      const result = buildDeletionScope(allArtifacts, [ch1Novel.id], "chapter-001");

      expect(result.deleteSet).toContain(ch1Novel.id);
      expect(result.deleteSet).not.toContain(ch2Novel.id);
      expect(result.blockerSet).not.toContain(ch2Novel.id);
    });
  });

  describe("buildDeletionPlan - artifact-scope blocker isolation", () => {
    test("rejects a batch that resolves to multiple chapters even when chapterId is omitted", () => {
      const chapterOne = createArtifacts("delete-exclusive-downstream");
      const chapterTwo = createArtifacts("delete-exclusive-downstream");
      chapterTwo.chapterId = "chapter-002";

      const result = buildDeletionPlan([chapterOne, chapterTwo], [chapterOne.id, chapterTwo.id], "");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("scope-expanded-across-chapters: selected artifacts must belong to one chapter");
      expect(result.plan.executionAllowed).toBe(false);
    });

    test("derives the selected chapter before traversing an artifact batch", () => {
      const chapterOne = createArtifacts("delete-exclusive-downstream");
      const chapterTwo = createArtifacts("delete-exclusive-downstream");
      chapterTwo.chapterId = "chapter-002";

      const result = buildDeletionPlan([chapterOne, chapterTwo], [chapterOne.id], "");

      expect(result.valid).toBe(true);
      expect(result.plan.chapterId).toBe("chapter-001");
      expect(result.plan.deleteItems.map((item) => item.artifactId)).toEqual([chapterOne.id]);
      expect(result.plan.deleteItems.map((item) => item.artifactId)).not.toContain(chapterTwo.id);
    });

    test("selecting one orphan backup is not polluted by unrelated project blockers", () => {
      // Regression: a single backup orphan must produce a plan whose blocker
      // list is empty. Before the fix, buildDeletionScope scanned the whole
      // project for blocker-missing-ownership items and dumped every one of
      // them into the dialog, disabling the confirm button.
      const orphanBackup: ArtifactRecord = {
        id: "backup:media-file:studio.json.bak-codex-1",
        projectId: "test-project",
        chapterId: undefined,
        stage: "backup",
        kind: "media-file",
        state: "orphaned",
        name: "studio.json.bak-codex-1",
        createdAt: 0,
        updatedAt: 0,
        physicalRefs: [{ type: "backup", path: "studio.json.bak-codex-1" }],
        upstreamIds: [],
        downstreamIds: [],
        deletePolicy: "delete-exclusive-downstream",
      };

      const unrelatedBlocker1: ArtifactRecord = {
        ...createArtifacts("blocker-missing-ownership"),
        id: "blocker:exports/chapter-001/automation_report.json",
        name: "automation_report.json",
        chapterId: undefined,
      };
      const unrelatedBlocker2: ArtifactRecord = {
        ...createArtifacts("blocker-missing-ownership"),
        id: "blocker:remotion/project.json",
        name: "project.json",
        chapterId: undefined,
      };

      const allArtifacts = [orphanBackup, unrelatedBlocker1, unrelatedBlocker2];
      const { plan, valid } = buildDeletionPlan(allArtifacts, [orphanBackup.id], "");

      expect(valid).toBe(true);
      expect(plan.deleteItems.map((i) => i.artifactId)).toEqual([orphanBackup.id]);
      expect(plan.blockerItems).toHaveLength(0);
      expect(plan.executionAllowed).toBe(true);
      expect(plan.confirmationRequired).toEqual({ type: "artifact-count", count: 1 });
    });

    test("selecting an unowned item allows deletion despite blocker-missing-ownership", () => {
      // When the user explicitly selects an artifact with
      // blocker-missing-ownership, it should go into the delete set (not the
      // blocker set) because the user is intentionally choosing to delete it.
      // This is the fix for the "删除按钮不能点击" bug: artifacts in the 杂项
      // (none) bucket all have blocker-missing-ownership, so the confirm
      // button was permanently disabled.
      const unowned = createArtifacts("blocker-missing-ownership");
      const other = createArtifacts("delete-exclusive-downstream");
      const { plan, valid, errors } = buildDeletionPlan([unowned, other], [unowned.id], "");

      expect(errors).toHaveLength(0);
      expect(valid).toBe(true);
      expect(plan.deleteItems.some((i) => i.artifactId === unowned.id)).toBe(true);
      expect(plan.blockerItems.some((i) => i.artifactId === unowned.id)).toBe(false);
      expect(plan.executionAllowed).toBe(true);
    });

    test("batch-deleting multiple unassigned artifacts in the none bucket succeeds", () => {
      // Regression: artifacts with no chapterId (杂项 bucket) were blocked
      // from batch deletion by the R18 rule's hasUnassigned guard. Multiple
      // unassigned artifacts belong to the same project root, not different
      // chapters, so they must be deletable as a group.
      const orphan1 = createArtifacts("delete-exclusive-downstream");
      orphan1.id = "orphan-1";
      orphan1.chapterId = undefined;
      const orphan2 = createArtifacts("delete-exclusive-downstream");
      orphan2.id = "orphan-2";
      orphan2.chapterId = undefined;

      const result = buildDeletionPlan([orphan1, orphan2], [orphan1.id, orphan2.id], "");

      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);
      expect(result.plan.deleteItems.map((i) => i.artifactId)).toEqual(expect.arrayContaining([orphan1.id, orphan2.id]));
      expect(result.plan.deleteItems).toHaveLength(2);
      expect(result.plan.executionAllowed).toBe(true);
    });

    test("mixing unassigned and chapter-assigned artifacts is still rejected", () => {
      const orphan = createArtifacts("delete-exclusive-downstream");
      orphan.chapterId = undefined;
      const chapterArtifact = createArtifacts("delete-exclusive-downstream");
      chapterArtifact.chapterId = "chapter-001";

      const result = buildDeletionPlan([orphan, chapterArtifact], [orphan.id, chapterArtifact.id], "");

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("scope-expanded-across-chapters: selected artifacts must belong to one chapter");
    });
  });
});
