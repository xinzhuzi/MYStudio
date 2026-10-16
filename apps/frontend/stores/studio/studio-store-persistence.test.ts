import { describe, expect, it } from "vitest";
import {
  assertImageWorkflowGraphMediaPersistable,
  migrateStudioWorkflowState,
  normalizeWorkflowConfig,
  reapInterruptedTaskLedgers,
  STUDIO_LEDGER_REAP_REASON,
  STUDIO_WORKFLOW_PERSIST_VERSION,
  STUDIO_WORKFLOW_STORAGE_KEY,
} from "./studio-store-persistence";
import type { ImageWorkflowGraph } from "@/types/studio";

describe("studio workflow persistence contract", () => {
  it("keeps the stable storage key and version", () => {
    expect(STUDIO_WORKFLOW_STORAGE_KEY).toBe("studio-workflow-store");
    expect(STUDIO_WORKFLOW_PERSIST_VERSION).toBe(11);
  });

  it("v11 滤除 B+ 收口前旧段键的存量 agentWorkData(1011 终清),其余键原样保留", () => {
    const migrated = migrateStudioWorkflowState({
      agentWorkData: [
        { id: "w1", key: "storySkeleton", data: "旧骨架", episodeId: "ch-1" },
        { id: "w2", key: "adaptationStrategyReview", data: "旧策略审核", episodeId: "ch-1" },
        { id: "w3", key: "scriptDraft", data: "剧本正文", episodeId: "ch-1" },
        { id: "w4", key: "eventAnalysis", data: "事件", episodeId: "ch-1" },
        { id: "w5", key: "storyboardTable", data: "分镜表", episodeId: "ch-1" },
      ],
    }) as { agentWorkData: Array<{ key: string }> };
    expect(migrated.agentWorkData.map((item) => item.key)).toEqual([
      "scriptDraft",
      "eventAnalysis",
      "storyboardTable",
    ]);
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

describe("legacy storyboard workflow purge (2026-08-30 merge ruling)", () => {
  const graph = (overrides: Record<string, unknown>): ImageWorkflowGraph => ({
    id: "flow",
    name: "道劫 · 分镜 1 图片工作流",
    target: { kind: "free" },
    // 非空(空流清理另有裁定,此处聚焦指纹语义)
    nodes: [{ id: "n", type: "generated", title: "t", position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1 }],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as unknown as ImageWorkflowGraph);

  it("drops fingerprint-less storyboard workflows during hydration", () => {
    const migrated = migrateStudioWorkflowState({
      imageWorkflows: [
        graph({ id: "legacy", target: { kind: "storyboard", id: "sb-1" } }),
        graph({ id: "fresh", target: { kind: "storyboard", id: "sb-1" }, targetSourceFingerprint: "fp-1" }),
        graph({ id: "free", target: { kind: "free" } }),
        graph({ id: "asset", target: { kind: "asset", assetType: "scene", id: "scene-1" } }),
      ],
    }) as { imageWorkflows: ImageWorkflowGraph[] };
    expect(migrated.imageWorkflows.map((item) => item.id)).toEqual(["fresh", "free", "asset"]);
  });

  it("keeps non-storyboard targets even without fingerprints and tolerates malformed entries", () => {
    const migrated = migrateStudioWorkflowState({
      imageWorkflows: [
        null,
        graph({ id: "material", target: { kind: "material", id: "mat-1" } }),
        graph({ id: "no-target-shape", target: undefined }),
      ],
    }) as { imageWorkflows: ImageWorkflowGraph[] };
    expect(migrated.imageWorkflows.map((item) => (item as { id: string }).id)).toEqual(["material", "no-target-shape"]);
  });
});

describe("stale workflow purge (2026-08-30 旧数据清理裁定)", () => {
  const graph = (overrides: Record<string, unknown>): ImageWorkflowGraph => ({
    id: "flow",
    name: "流",
    target: { kind: "free" },
    nodes: [],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as ImageWorkflowGraph);
  const sb = (id: string) => graph({
    id: `flow-${id}`,
    target: { kind: "storyboard", id },
    targetSourceFingerprint: `fp-${id}`,
    nodes: [{ id: "n1", type: "generated", title: "成图", position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1 }],
  });

  it("drops empty non-storyboard flows and orphaned storyboard flows, keeps healthy ones", () => {
    const migrated = migrateStudioWorkflowState({
      storyboards: [{ id: "sb-1" }, { id: "sb-2" }],
      imageWorkflows: [
        graph({ id: "empty-free", name: "道劫 图像工作流 78" }),
        graph({ id: "empty-asset", target: { kind: "asset", assetType: "scene", id: "s" } }),
        graph({ id: "kept-free", nodes: [{ id: "n", type: "generated", title: "t", position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1 }] }),
        sb("sb-1"),
        sb("sb-gone"),
      ],
    }) as { imageWorkflows: ImageWorkflowGraph[] };
    expect(migrated.imageWorkflows.map((item) => item.id)).toEqual(["kept-free", "flow-sb-1"]);
  });

  it("skips orphan purge when the storyboard window is empty (防误伤守卫)", () => {
    const migrated = migrateStudioWorkflowState({
      storyboards: [],
      imageWorkflows: [sb("sb-anywhere")],
    }) as { imageWorkflows: ImageWorkflowGraph[] };
    expect(migrated.imageWorkflows.map((item) => item.id)).toEqual(["flow-sb-anywhere"]);
  });
});

describe("reapInterruptedTaskLedgers(水合收割上一会话中断任务,1016 控制球僵尸徽章修复)", () => {
  const BOOT = 1_000_000;
  const NOW = 2_000_000;

  it("把上一会话卡死的 running/queued 台账改判 failed(中断原因+finishedAt),其余字段与终态条目保留", () => {
    const agentRuns = [
      { id: "run-zombie", key: "directorPlan", phase: "plan", status: "running", inputSummary: "directorPlan:chapter-001:4600", startedAt: BOOT - 5, checkpointRef: "cp-1" },
      { id: "run-queued", key: "scriptDraft", phase: "draft", status: "queued", inputSummary: "s", startedAt: BOOT - 1 },
      { id: "run-done", key: "eventAnalysis", phase: "p", status: "success", inputSummary: "s", startedAt: BOOT - 9 },
    ];
    const mediaTasks = [
      { id: "task-zombie", kind: "storyboardImage", targetId: "t", status: "running", createdAt: BOOT - 5, updatedAt: BOOT - 5 },
      { id: "task-queued", kind: "ttsAudio", targetId: "t", status: "queued", createdAt: BOOT - 3, updatedAt: BOOT - 3 },
      { id: "task-failed", kind: "modelVideo", targetId: "t", status: "failed", createdAt: BOOT - 7, updatedAt: BOOT - 7, errorReason: "原文错误" },
    ];
    const result = reapInterruptedTaskLedgers({ agentRuns, mediaTasks, bootTime: BOOT, now: NOW });
    expect(result.reapedCount).toBe(4);
    expect(result.agentRuns?.[0]).toMatchObject({
      id: "run-zombie",
      status: "failed",
      errorReason: STUDIO_LEDGER_REAP_REASON,
      finishedAt: NOW,
      checkpointRef: "cp-1",
    });
    expect(result.agentRuns?.[1]).toMatchObject({ status: "failed", errorReason: STUDIO_LEDGER_REAP_REASON });
    expect(result.agentRuns?.[2].status).toBe("success");
    expect(result.mediaTasks?.[0]).toMatchObject({ status: "failed", updatedAt: NOW, finishedAt: NOW });
    expect(result.mediaTasks?.[1]).toMatchObject({ status: "failed" });
    expect(result.mediaTasks?.[2]).toMatchObject({ status: "failed", errorReason: "原文错误" });
  });

  it("本会话在途任务(startedAt≥bootTime)不收割,零收割时原数组引用透传——切项目重水合零误伤", () => {
    const agentRuns = [{ id: "run-live", key: "scriptDraft", phase: "p", status: "running", inputSummary: "s", startedAt: BOOT }];
    const mediaTasks = [{ id: "task-live", kind: "ttsAudio", targetId: "t", status: "running", createdAt: BOOT, updatedAt: BOOT }];
    const result = reapInterruptedTaskLedgers({ agentRuns, mediaTasks, bootTime: BOOT, now: NOW });
    expect(result.reapedCount).toBe(0);
    expect(result.agentRuns).toBe(agentRuns);
    expect(result.mediaTasks).toBe(mediaTasks);
  });

  it("缺 startedAt/createdAt 的活跃条目按上一会话处理(老数据),非对象与终态条目原样透传", () => {
    const legacy = [
      { id: "run-legacy", key: "x", phase: "p", status: "running", inputSummary: "s" },
      null,
      { id: "run-ok", status: "success" },
      { status: "running" },
    ];
    const result = reapInterruptedTaskLedgers({ agentRuns: legacy, bootTime: BOOT, now: NOW });
    expect(result.reapedCount).toBe(1);
    expect(result.agentRuns?.[0]).toMatchObject({ status: "failed", errorReason: STUDIO_LEDGER_REAP_REASON, finishedAt: NOW });
    expect(result.agentRuns?.[1]).toBeNull();
    expect(result.agentRuns?.[2]).toEqual({ id: "run-ok", status: "success" });
    expect(result.agentRuns?.[3]).toEqual({ status: "running" });
  });

  it("未持久化的台账(undefined)原样返回 undefined", () => {
    const result = reapInterruptedTaskLedgers({ bootTime: BOOT, now: NOW });
    expect(result.agentRuns).toBeUndefined();
    expect(result.mediaTasks).toBeUndefined();
    expect(result.reapedCount).toBe(0);
  });
});
