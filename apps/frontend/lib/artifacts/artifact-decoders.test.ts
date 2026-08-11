// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Contract tests for artifact IPC decoders - invalid inputs must fail closed.
 */

import { describe, it, expect } from "vitest";
import {
  InventoryRequestDecoder,
  ProjectArtifactsRequestDecoder,
  PlanRequestDecoder,
  ExecuteRequestDecoder,
  InventoryResultDecoder,
  PlanResultDecoder,
  RecoveryQueryRequestDecoder,
  MetadataUpdateRequestDecoder,
} from "./artifact-decoders";
import { rewriteRegisteredBackup } from "@/electron/artifacts/backup-decoder-registry";

describe("Artifact IPC Request Decoders - Contract Tests", () => {
  it("rewrites a registered mixed backup without changing retained chapters", () => {
    const raw = {
      projectId: "project-fixture",
      state: {
        novelChapters: [
          { id: "chapter-delete", title: "第一章" },
          { id: "chapter-keep", title: "第二章" },
        ],
        scriptData: {
          episodes: [
            { id: "chapter-delete", index: 1 },
            { id: "chapter-keep", index: 2 },
          ],
        },
      },
      timestamp: 1,
    };
    const result = rewriteRegisteredBackup(raw, "chapter-delete", new Set(["chapter-delete"]));
    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      ...raw,
      state: {
        novelChapters: [{ id: "chapter-keep", title: "第二章" }],
        scriptData: { episodes: [{ id: "chapter-keep", index: 2 }] },
      },
      timestamp: 1,
    });
  });

  describe("InventoryRequestDecoder - Invalid Inputs", () => {
    it("rejects empty projectId", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "inventory",
        payload: { projectId: "" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing projectId", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "inventory",
        payload: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown fields in payload", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "inventory",
        payload: {
          projectId: "test-id",
          chapterId: "chapter-001",
          unknownField: "should-be-rejected",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown top-level fields", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "inventory",
        payload: { projectId: "test-id" },
        physicalPath: "/tmp/outside-contract",
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid projectId only", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "inventory",
        payload: { projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid projectId with optional chapterId", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "inventory",
        payload: {
          projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0",
          chapterId: "chapter-001",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid type value", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "invalid-type",
        payload: { projectId: "test-id" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty optional chapterId", () => {
      const result = InventoryRequestDecoder.safeParse({
        type: "inventory",
        payload: { projectId: "test-id", chapterId: "" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ProjectArtifactsRequestDecoder - Contract", () => {
    it("accepts only a project identity", () => {
      expect(ProjectArtifactsRequestDecoder.safeParse({
        type: "project-artifacts",
        payload: { projectId: "test-id" },
      }).success).toBe(true);
      expect(ProjectArtifactsRequestDecoder.safeParse({
        type: "project-artifacts",
        payload: { projectId: "test-id", chapterId: "chapter-001" },
      }).success).toBe(false);
    });
  });

  describe("MetadataUpdateRequestDecoder - Contract", () => {
    it("accepts name or notes and rejects read-only fields", () => {
      expect(MetadataUpdateRequestDecoder.safeParse({
        type: "metadata-update",
        payload: { projectId: "test-id", artifactId: "artifact-1", updates: { notes: "reviewed" } },
      }).success).toBe(true);
      expect(MetadataUpdateRequestDecoder.safeParse({
        type: "metadata-update",
        payload: {
          projectId: "test-id",
          artifactId: "artifact-1",
          updates: { notes: "reviewed", physicalPath: "/tmp/forbidden" },
        },
      }).success).toBe(false);
    });

    it("rejects empty updates and unknown request fields", () => {
      expect(MetadataUpdateRequestDecoder.safeParse({
        type: "metadata-update",
        payload: { projectId: "test-id", artifactId: "artifact-1", updates: {} },
      }).success).toBe(false);
      expect(MetadataUpdateRequestDecoder.safeParse({
        type: "metadata-update",
        payload: {
          projectId: "test-id",
          artifactId: "artifact-1",
          updates: { name: "renamed" },
          chapterId: "chapter-001",
        },
      }).success).toBe(false);
    });
  });

  describe("PlanRequestDecoder - Invalid Inputs", () => {
    it("rejects empty projectId", () => {
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "",
          chapterId: "chapter-001",
          scope: "chapter",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty chapterId", () => {
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "",
          scope: "chapter",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects cross-chapter batch scope (multiple chapterIds implied by invalid structure)", () => {
      // Contract enforces single chapterId at schema level
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "chapter-001",
          scope: "artifacts",
          artifactIds: ["id1", "id2"],
          unknownChapter: "chapter-002", // should be rejected
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown fields in payload", () => {
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "chapter-001",
          scope: "chapter",
          unknownField: "rejected",
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid scope value", () => {
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "chapter-001",
          scope: "invalid-scope",
        },
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid chapter scope", () => {
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0",
          chapterId: "chapter-001",
          scope: "chapter",
        },
      });
      expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
    });

    it("accepts valid artifacts scope with artifactIds", () => {
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "chapter-001",
          scope: "artifacts",
          artifactIds: ["artifact-1", "artifact-2"],
        },
      });
      expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
    });

    it("rejects an empty artifact scope", () => {
      expect(PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "",
          scope: "artifacts",
          artifactIds: [],
        },
      }).success).toBe(false);
      expect(PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "",
          scope: "artifacts",
        },
      }).success).toBe(false);
    });

    it("accepts empty chapterId for artifact scope when the graph will derive it", () => {
      const result = PlanRequestDecoder.safeParse({
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "",
          scope: "artifacts",
          artifactIds: ["artifact-1"],
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("ExecuteRequestDecoder - Invalid Inputs", () => {
    it("rejects empty planId", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "",
          fingerprint: "abc123",
          confirmation: { type: "chapter" },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty fingerprint", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "",
          confirmation: { type: "chapter" },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects path-bearing execute fields in confirmation", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: {
            type: "chapter",
            chapterTitle: "第一章",
            physicalPath: "/absolute/path/to/chapter",
          },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty chapter confirmation values", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: { type: "chapter", chapterId: "" },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects malformed chapter confirmation without required fields", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: {
            type: "chapter",
            // Missing both chapterTitle and chapterId
          },
        },
      });
      // At least one confirmation value should be required
      expect(result.success).toBe(false);
    });

    it("rejects malformed artifact confirmation missing artifactCount", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: {
            type: "artifacts",
            // Missing required artifactCount
          },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown confirmation type", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: { type: "unknown" as any },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative artifactCount", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: {
            type: "artifacts",
            artifactCount: -1,
          },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects zero artifactCount", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: {
            type: "artifacts",
            artifactCount: 0,
          },
        },
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid chapter confirmation with chapterId", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "sha256-abc123",
          confirmation: {
            type: "chapter",
            chapterId: "chapter-001",
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid chapter confirmation with chapterTitle", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "sha256-abc123",
          confirmation: {
            type: "chapter",
            chapterTitle: "第一章",
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid artifacts confirmation with artifactCount", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "sha256-abc123",
          confirmation: {
            type: "artifacts",
            artifactCount: 5,
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-integer artifactCount", () => {
      const result = ExecuteRequestDecoder.safeParse({
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: {
            type: "artifacts",
            artifactCount: 3.14,
          },
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RecoveryQueryRequestDecoder - Invalid Inputs", () => {
    it("rejects empty projectId", () => {
      const result = RecoveryQueryRequestDecoder.safeParse({
        type: "recovery-query",
        payload: { projectId: "" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing projectId", () => {
      const result = RecoveryQueryRequestDecoder.safeParse({
        type: "recovery-query",
        payload: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown fields in payload", () => {
      const result = RecoveryQueryRequestDecoder.safeParse({
        type: "recovery-query",
        payload: {
          projectId: "test-id",
          unknownField: "rejected",
        },
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid projectId", () => {
      const result = RecoveryQueryRequestDecoder.safeParse({
        type: "recovery-query",
        payload: { projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Discriminated Union Rejection - Scope Validation", () => {
    it("enforces single-chapter boundary at PlanRequest level", () => {
      // Attempting to encode multi-chapter scope structurally fails
      const multiChapterPayload = {
        type: "plan",
        payload: {
          projectId: "test-id",
          chapterId: "chapter-001", // Only ONE chapter allowed by schema
          scope: "chapter",
          additionalChapters: ["chapter-002", "chapter-003"], // Will be rejected by .strict()
        },
      };
      const result = PlanRequestDecoder.safeParse(multiChapterPayload);
      expect(result.success).toBe(false);
    });

    it("prevents renderer-supplied physical path fields in execute confirmation", () => {
      const maliciousConfirmation = {
        type: "execute",
        payload: {
          planId: "plan-1",
          fingerprint: "abc123",
          confirmation: {
            type: "chapter",
            chapterTitle: "第一章",
            paths: ["/p/49dce4c1-64b1-42de-85c2-9f266698aec0/novel/chapters"],
          },
        },
      };
      const result = ExecuteRequestDecoder.safeParse(maliciousConfirmation);
      expect(result.success).toBe(false);
    });
  });

  describe("IPC result decoders", () => {
    it("accepts inventory metadata overlays declared by ArtifactRecord", () => {
      const result = InventoryResultDecoder.safeParse({
        success: true,
        data: {
          projectId: "project-1",
          artifacts: [{
            id: "novel:novel-chapter:chapter-001",
            projectId: "project-1",
            chapterId: "chapter-001",
            stage: "novel",
            kind: "novel-chapter",
            state: "active",
            name: "第一章",
            createdAt: 1,
            updatedAt: 2,
            physicalRefs: [],
            upstreamIds: [],
            downstreamIds: [],
            deletePolicy: "delete-exclusive-downstream",
            metadata: { name: "新名称", tags: ["只读标签"], notes: "备注", updatedAt: 3 },
          }],
          discrepancies: [],
          blockers: [],
          summary: {
            totalArtifacts: 1,
            byStage: { novel: 1 },
            byKind: { "novel-chapter": 1 },
            byState: { active: 1 },
            totalBytes: 0,
            deleteEligible: 1,
            retainDueToShared: 0,
            blockedByJobs: 0,
            blockedByUnknown: 0,
          },
        },
      });
      expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
    });

    it("accepts the complete physical reference list on deletion plan items", () => {
      const result = PlanResultDecoder.safeParse({
        success: true,
        data: {
          planId: "plan-1",
          schemaVersion: "1",
          projectId: "project-1",
          chapterId: "chapter-001",
          scope: "artifacts",
          selectedArtifactIds: ["novel:novel-chapter:chapter-001"],
          createdAt: 1,
          fingerprint: "hash",
          deleteItems: [{
            artifactId: "novel:novel-chapter:chapter-001",
            kind: "novel-chapter",
            stage: "novel",
            name: "第一章",
            physicalRefs: [{ type: "project-file", path: "novel/chapters/chapter-001.md" }],
          }],
          migrateItems: [],
          retainItems: [],
          blockerItems: [],
          backupImpact: [],
          byteTotals: { deleteBytes: 0, migrateBytes: 0, retainBytes: 0, totalBytes: 0 },
          confirmationRequired: { type: "artifact-count", count: 1 },
          executionAllowed: true,
        },
      });
      expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
    });
  });
});
