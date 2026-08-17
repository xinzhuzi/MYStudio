// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it } from "vitest";
import {
  mergeStudioWorkflowShards,
  parseStudioWorkflowShardManifest,
  planStudioWorkflowShards,
  shardContentStamp,
  StudioWorkflowShardPlanError,
  STUDIO_WORKFLOW_SHARD_LAYOUT,
  STUDIO_WORKFLOW_SHARD_LIMIT_BYTES,
} from "./studio-workflow-shards";

function buildRichState() {
  const chapter = (index: number, size: number) => ({
    id: `chapter-${String(index).padStart(3, "0")}`,
    title: `第${index}章`,
    sourceText: "正".repeat(size),
  });
  const storyboard = (index: number) => ({
    id: `sb-${index}`,
    episodeId: "chapter-001",
    index,
    prompt: `分镜提示词 ${index}`,
  });
  return {
    materials: [{ id: "material-1", name: "素材", localPath: "/tmp/a.txt", size: 1 }],
    novelChapters: [chapter(1, 200), chapter(2, 200), chapter(3, 200)],
    sourceBible: "# 原著圣经\n主线",
    agentWorkData: [],
    entityExtractions: [],
    scriptPlans: [{ id: "plan-1", title: "计划", scenes: [] }],
    seriesBible: { title: "设定" },
    episodeOutlines: [],
    storyboards: Array.from({ length: 8 }, (_, index) => storyboard(index + 1)),
    continuityAssetVersions: [],
    productionTracks: [{ id: "track-1", trackKey: "chapter-001", storyboardIds: [], candidateVideoIds: [] }],
    videoCandidates: [],
    imageWorkflows: [],
    agentRuns: [],
    mediaTasks: [],
    eventGraph: [],
    projectMemoryRecords: [],
    workflowConfig: { autoAnalyzeEventsOnImport: false, episodeDurationMin: 3 },
  };
}

function envelopeOf(state: unknown, version = 10) {
  return JSON.stringify({ state, version });
}

function roundTrip(value: string) {
  const plan = planStudioWorkflowShards(value);
  const contents = plan.files.map((file) => file.content);
  const merged = mergeStudioWorkflowShards(contents);
  return { plan, merged };
}

describe("planStudioWorkflowShards", () => {
  it("round-trips a rich studio-workflow state losslessly", () => {
    const state = buildRichState();
    const { plan, merged } = roundTrip(envelopeOf(state));
    expect(merged.state).toEqual(state);
    expect(merged.version).toBe(10);
    expect(plan.manifest.version).toBe(10);
    expect(plan.oversizedFiles).toEqual([]);
  });

  it("routes domains to PRD shard names and merges the rest into core", () => {
    const state = buildRichState();
    const { plan } = roundTrip(envelopeOf(state));
    const names = plan.manifest.shards;
    expect(names.some((name) => /^novel-chapters-001-[0-9a-f]{8}\.json$/.test(name))).toBe(true);
    expect(names.some((name) => /^storyboards-[0-9a-f]{8}\.json$/.test(name))).toBe(true);
    expect(names.some((name) => /^script-plans-[0-9a-f]{8}\.json$/.test(name))).toBe(true);
    expect(names.some((name) => /^production-tracks-[0-9a-f]{8}\.json$/.test(name))).toBe(true);
    expect(names.some((name) => /^core-[0-9a-f]{8}\.json$/.test(name))).toBe(true);
    // 空数组域（eventGraph 等）进 core，不产生独立分片
    expect(names.some((name) => name.startsWith("agent-runs"))).toBe(false);
    expect(names.some((name) => name.startsWith("media-tasks"))).toBe(false);
  });

  it("keeps every shard within the byte limit and splits overflowing arrays", () => {
    const state = buildRichState();
    // 每章约 200*3 字节正文（UTF-8 每汉字 3 字节），预算压到 1KB 强制多片
    const plan = planStudioWorkflowShards(envelopeOf(state), { limitBytes: 1024 });
    expect(plan.manifest.shards.filter((name) => name.startsWith("novel-chapters-")).length).toBeGreaterThan(1);
    expect(plan.manifest.shards.some((name) => name.startsWith("storyboards-"))).toBe(true);
    for (const file of plan.files) {
      expect(Buffer.byteLength(file.content, "utf8")).toBeLessThanOrEqual(1024);
    }
    // 切分保序：合并后章节顺序不变
    const contents = plan.files.map((file) => file.content);
    const merged = mergeStudioWorkflowShards(contents);
    expect((merged.state.novelChapters as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "chapter-001",
      "chapter-002",
      "chapter-003",
    ]);
  });

  it("gives an oversized single item its own shard and reports it (单章超限独占)", () => {
    const state = buildRichState();
    (state.novelChapters as unknown[])[0] = {
      id: "chapter-huge",
      title: "巨章",
      sourceText: "文".repeat(2000),
    };
    const plan = planStudioWorkflowShards(envelopeOf(state), { limitBytes: 1024 });
    const hugeShard = plan.files.find((file) => file.name.startsWith("novel-chapters-"));
    expect(hugeShard).toBeDefined();
    expect(Buffer.byteLength(hugeShard!.content, "utf8")).toBeGreaterThan(1024);
    expect(plan.oversizedFiles.some((name) => hugeShard!.name.startsWith(name))).toBe(true);
    // 独占片内只有这一章
    const parsed = JSON.parse(hugeShard!.content) as { state: { novelChapters: unknown[] } };
    expect(parsed.state.novelChapters).toHaveLength(1);
  });

  it("splits oversized core keys into their own core files without truncation", () => {
    const value = envelopeOf({
      workflowConfig: { episodeDurationMin: 3 },
      sourceBible: "圣".repeat(1200),
    });
    const { plan, merged } = roundTripWithLimit(value, 2048);
    expect(merged.state.sourceBible).toBe("圣".repeat(1200));
    expect(plan.files.length).toBeGreaterThan(1);
    for (const file of plan.files) {
      if (!plan.oversizedFiles.some((base) => file.name.startsWith(base))) {
        expect(Buffer.byteLength(file.content, "utf8")).toBeLessThanOrEqual(2048);
      }
    }

    function roundTripWithLimit(input: string, limitBytes: number) {
      const plan = planStudioWorkflowShards(input, { limitBytes });
      const merged = mergeStudioWorkflowShards(plan.files.map((file) => file.content));
      return { plan, merged };
    }
  });

  it("rejects unparseable or non-envelope input instead of truncating", () => {
    expect(() => planStudioWorkflowShards("not-json")).toThrow(StudioWorkflowShardPlanError);
    expect(() => planStudioWorkflowShards(JSON.stringify([1, 2]))).toThrow(StudioWorkflowShardPlanError);
    expect(() => planStudioWorkflowShards(JSON.stringify({ version: 10 }))).toThrow(StudioWorkflowShardPlanError);
  });

  it("treats an empty state as a manifest with zero shards", () => {
    const plan = planStudioWorkflowShards(envelopeOf({}));
    expect(plan.files).toEqual([]);
    expect(plan.manifest.shards).toEqual([]);
    expect(plan.manifest.layout).toBe(STUDIO_WORKFLOW_SHARD_LAYOUT);
  });

  it("produces deterministic stamps for identical content", () => {
    const value = envelopeOf(buildRichState());
    const first = planStudioWorkflowShards(value);
    const second = planStudioWorkflowShards(value);
    expect(first.manifest.shards).toEqual(second.manifest.shards);
    expect(shardContentStamp("mystudio")).toBe(shardContentStamp("mystudio"));
  });

  it("defaults the limit to 512KB", () => {
    expect(STUDIO_WORKFLOW_SHARD_LIMIT_BYTES).toBe(512 * 1024);
  });
});

describe("mergeStudioWorkflowShards", () => {
  it("concatenates repeated array keys in order and lets later scalars win", () => {
    const shards = [
      JSON.stringify({ state: { storyboards: [1, 2], sourceBible: "旧" }, version: 10 }),
      JSON.stringify({ state: { storyboards: [3], sourceBible: "新" }, version: 10 }),
    ];
    const merged = mergeStudioWorkflowShards(shards);
    expect(merged.state.storyboards).toEqual([1, 2, 3]);
    expect(merged.state.sourceBible).toBe("新");
    expect(merged.version).toBe(10);
  });

  it("throws on malformed shard content rather than half-merging", () => {
    expect(() => mergeStudioWorkflowShards(["{bad json"])).toThrow(StudioWorkflowShardPlanError);
    expect(() => mergeStudioWorkflowShards([JSON.stringify({ state: [] })])).toThrow(StudioWorkflowShardPlanError);
  });
});

describe("parseStudioWorkflowShardManifest", () => {
  it("accepts the canonical manifest shape", () => {
    const raw = JSON.stringify({
      layout: STUDIO_WORKFLOW_SHARD_LAYOUT,
      version: 10,
      shards: ["core-01234567.json"],
    });
    expect(parseStudioWorkflowShardManifest(raw)).toEqual({
      layout: STUDIO_WORKFLOW_SHARD_LAYOUT,
      version: 10,
      shards: ["core-01234567.json"],
    });
  });

  it("rejects foreign layouts, non-numeric versions, and traversal names", () => {
    expect(parseStudioWorkflowShardManifest(JSON.stringify({ layout: "other", version: 1, shards: [] }))).toBeNull();
    expect(parseStudioWorkflowShardManifest(JSON.stringify({ layout: STUDIO_WORKFLOW_SHARD_LAYOUT, version: "10", shards: [] }))).toBeNull();
    expect(parseStudioWorkflowShardManifest(JSON.stringify({ layout: STUDIO_WORKFLOW_SHARD_LAYOUT, version: 10, shards: ["../escape.json"] }))).toBeNull();
    expect(parseStudioWorkflowShardManifest("nope")).toBeNull();
  });
});
