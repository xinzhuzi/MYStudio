import { describe, expect, it } from "vitest";
import {
  assertImageWorkflowGraphMediaPersistable,
  migrateStudioWorkflowState,
  normalizeWorkflowConfig,
  STUDIO_WORKFLOW_PERSIST_VERSION,
  STUDIO_WORKFLOW_STORAGE_KEY,
} from "./studio-store-persistence";
import type { ImageWorkflowGraph } from "@/types/studio";

describe("studio workflow persistence contract", () => {
  it("keeps the stable storage key and version", () => {
    expect(STUDIO_WORKFLOW_STORAGE_KEY).toBe("studio-workflow-store");
    expect(STUDIO_WORKFLOW_PERSIST_VERSION).toBe(10);
  });

  it("normalizes legacy manual ids without changing other config", () => {
    expect(normalizeWorkflowConfig({
      visualManualId: "2D_chinese_guofeng",
      directorManualId: "Xianxia_fantasy",
      episodeDurationMin: 5,
    })).toEqual({ episodeDurationMin: 5, visualManualId: undefined, directorManualId: undefined });
  });

  it("fills missing persisted collections and preserves non-objects", () => {
    expect(migrateStudioWorkflowState(null)).toBeNull();
    const migrated = migrateStudioWorkflowState({ workflowConfig: undefined }) as Record<string, unknown>;
    expect(migrated.entityExtractions).toEqual([]);
    expect(migrated.continuityAssetVersions).toEqual([]);
    expect(migrated.workflowConfig).toEqual({ visualManualId: undefined, directorManualId: undefined });
  });

  it("normalizes sourceBible to a string with empty default", () => {
    const migrated = migrateStudioWorkflowState({
      sourceBible: "# 原著圣经\n## 一句话主线\n主线内容",
    }) as Record<string, unknown>;
    expect(migrated.sourceBible).toBe("# 原著圣经\n## 一句话主线\n主线内容");

    const defaulted = migrateStudioWorkflowState({ sourceBible: 123 }) as Record<string, unknown>;
    expect(defaulted.sourceBible).toBe("");

    const missing = migrateStudioWorkflowState({}) as Record<string, unknown>;
    expect(missing.sourceBible).toBe("");
  });

  it("rejects embedded reference/result payloads with a precise field path", () => {
    const graph: ImageWorkflowGraph = {
      id: "flow-embedded",
      name: "embedded",
      target: { kind: "free" },
      nodes: [
        {
          id: "ref-data",
          type: "reference",
          title: "reference",
          imageUrl: "data:image/png;base64,DO_NOT_LOG_THIS_PAYLOAD",
          position: { x: 0, y: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    };

    expect(() => assertImageWorkflowGraphMediaPersistable(graph))
      .toThrow("imageWorkflows[flow-embedded].nodes[ref-data].imageUrl 禁止持久化 data: URL");
    try {
      assertImageWorkflowGraphMediaPersistable(graph);
    } catch (error) {
      expect(String(error)).not.toContain("DO_NOT_LOG_THIS_PAYLOAD");
    }

    graph.nodes = [{
      id: "gen-blob",
      type: "generated",
      title: "generated",
      prompt: "prompt",
      aspectRatio: "16:9",
      quality: "standard",
      status: "ready",
      resultUrl: "blob:https://example.test/transient",
      position: { x: 0, y: 0 },
      createdAt: 1,
      updatedAt: 1,
    }];
    expect(() => assertImageWorkflowGraphMediaPersistable(graph))
      .toThrow("imageWorkflows[flow-embedded].nodes[gen-blob].resultUrl 禁止持久化 blob: URL");
  });

  it("preserves durable workflow media URL and path forms", () => {
    for (const imageUrl of [
      "file:///managed/asset.png",
      "/managed/asset.png",
      "project-file://project/workflow/ref.png",
      "local-image://asset/ref.png",
      "https://cdn.example.test/ref.png",
    ]) {
      expect(() => assertImageWorkflowGraphMediaPersistable({
        id: `flow-${imageUrl.slice(0, 4)}`,
        name: "durable",
        target: { kind: "free" },
        nodes: [{
          id: "ref",
          type: "reference",
          title: "reference",
          imageUrl,
          position: { x: 0, y: 0 },
          createdAt: 1,
          updatedAt: 1,
        }],
        edges: [],
        createdAt: 1,
        updatedAt: 1,
      })).not.toThrow();
    }
  });
});
