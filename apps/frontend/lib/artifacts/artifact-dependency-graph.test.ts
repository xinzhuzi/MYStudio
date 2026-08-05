// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, test, expect } from "vitest";
import { buildDeletionScope, computeDeletionOrder, validateDeletionPlan, detectOrphanedReferences } from "./artifact-dependency-graph";
import type { ArtifactRecord, DeletePolicy } from "@/types/artifacts";
import { buildSingleChapterFixture, buildMultiChapterFixture, buildLegacyAmbiguousFixture, buildCrossProjectFixture, generateDerivedAssetId } from "./__fixtures__/fixture-builders";

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
    test("blocks TTS lines with ambiguous numeric sceneId", () => {
      const ttsLine = createArtifacts("blocker-missing-ownership");
      ttsLine.blockerReason = "Missing chapter ownership (legacy numeric sceneId)";

      const allArtifacts = [ttsLine];
      const result = buildDeletionScope(allArtifacts, [ttsLine.id], "chapter-001");

      expect(result.blockerSet).toContain(ttsLine.id);
      expect(result.deleteSet).not.toContain(ttsLine.id);
    });

    test("flags unowned media files as ambiguous", () => {
      const unownedMedia = createArtifacts("blocker-missing-ownership");
      unownedMedia.blockerReason = "Missing chapter ownership";

      const allArtifacts = [unownedMedia];
      const result = buildDeletionScope(allArtifacts, [unownedMedia.id], "chapter-001");

      expect(result.blockerSet).toContain(unownedMedia.id);
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
});
