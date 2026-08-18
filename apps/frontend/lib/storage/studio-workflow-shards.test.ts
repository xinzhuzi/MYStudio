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
  const storyboard = (index: number, episodeId = "chapter-001") => ({
    id: `sb-${index}`,
    episodeId,
    index,
    prompt: `分镜提示词 ${index}`,
  });
  return {
    materials: [{ id: "material-1", name: "素材", localPath: "/tmp/a.txt", size: 1 }],
    novelChapters: [chapter(1, 200), chapter(2, 200), chapter(3, 200)],
    sourceBible: "# 原著圣经\n主线",
    agentWorkData: [],
    entityExtractions: [],
    scriptPlans: [{ id: "plan-1", episodeId: "chapter-001", title: "计划", scenes: [] }],
    seriesBible: { title: "设定" },
    episodeOutlines: [],
    storyboards: Array.from({ length: 8 }, (_, index) => storyboard(index + 1)),
    continuityAssetVersions: [],
    productionTracks: [{ id: "track-1", episodeId: "chapter-001", trackKey: "chapter-001", storyboardIds: [], candidateVideoIds: [] }],
    videoCandidates: [],
    imageWorkflows: [],
    agentRuns: [],
    mediaTasks: [{ id: "task-1", kind: "storyboardImage", targetId: "sb-1", episodeId: "chapter-002", status: "success" }],
    eventGraph: [],
    projectMemoryRecords: [],
    workflowConfig: { autoAnalyzeEventsOnImport: false, episodeDurationMin: 3 },
  };
}

function envelopeOf(state: unknown, version = 10) {
  return JSON.stringify({ state, version });
}

function roundTrip(value: string, limitBytes?: number) {
  const plan = planStudioWorkflowShards(value, limitBytes ? { limitBytes } : {});
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

  it("layers chapter-owned domains one chapter per file (章优先分层)", () => {
    const state = buildRichState();
    const { plan } = roundTrip(envelopeOf(state));
    const names = plan.manifest.shards;
    // 每章正文独立成片
    expect(names.filter((name) => name.startsWith("chapter-001-novel-chapters-001-"))).toHaveLength(1);
    expect(names.filter((name) => name.startsWith("chapter-002-novel-chapters-001-"))).toHaveLength(1);
    expect(names.filter((name) => name.startsWith("chapter-003-novel-chapters-001-"))).toHaveLength(1);
    // 分镜/剧本计划/制片轨道按所属章归片
    expect(names.some((name) => name.startsWith("chapter-001-storyboards-001-"))).toBe(true);
    expect(names.some((name) => name.startsWith("chapter-001-script-plans-001-"))).toBe(true);
    expect(names.some((name) => name.startsWith("chapter-001-production-tracks-001-"))).toBe(true);
    expect(names.some((name) => name.startsWith("chapter-002-media-tasks-001-"))).toBe(true);
    // 非章节数组域保持裸名批切；小域进 core
    expect(names.some((name) => /^materials-[0-9a-f]{8}\.json$/.test(name))).toBe(true);
    expect(names.some((name) => /^core-[0-9a-f]{8}\.json$/.test(name))).toBe(true);
    // 空数组域不产生独立分片
    expect(names.some((name) => name.includes("agent-runs"))).toBe(false);
    expect(names.some((name) => name.includes("entity-extractions"))).toBe(false);
  });

  it("keeps every shard within the byte limit and splits overflowing chapter runs", () => {
    const state = buildRichState();
    // 加大提示词让 8 个分镜在 1KB 预算下强制章内多片
    (state.storyboards as Array<{ prompt: string }>).forEach((storyboard, index) => {
      storyboard.prompt = `分镜 ${index} ${"述".repeat(120)}`;
    });
    const { plan, merged } = roundTrip(envelopeOf(state), 1024);
    expect(plan.manifest.shards.filter((name) => name.startsWith("chapter-001-storyboards-")).length).toBeGreaterThan(1);
    for (const file of plan.files) {
      expect(Buffer.byteLength(file.content, "utf8")).toBeLessThanOrEqual(1024);
    }
    // 切分保序：合并后分镜顺序不变
    expect((merged.state.storyboards as Array<{ id: string }>).map((item) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `sb-${index + 1}`),
    );
  });

  it("preserves exact item order even when chapters interleave (run 保序)", () => {
    const storyboards = [
      { id: "sb-1", episodeId: "chapter-001", index: 1 },
      { id: "sb-2", episodeId: "chapter-002", index: 1 },
      { id: "sb-3", episodeId: "chapter-001", index: 2 },
      { id: "sb-4", episodeId: "chapter-002", index: 2 },
    ];
    const { plan, merged } = roundTrip(envelopeOf({ storyboards }));
    // 交错 → 每章两个 run，各成文件
    expect(plan.manifest.shards.filter((name) => name.startsWith("chapter-001-storyboards-"))).toHaveLength(2);
    expect(plan.manifest.shards.filter((name) => name.startsWith("chapter-002-storyboards-"))).toHaveLength(2);
    expect((merged.state.storyboards as Array<{ id: string }>).map((item) => item.id)).toEqual([
      "sb-1",
      "sb-2",
      "sb-3",
      "sb-4",
    ]);
  });

  it("puts items without a chapter key into the shared bucket", () => {
    const { plan, merged } = roundTrip(envelopeOf({
      storyboards: [
        { id: "sb-1", episodeId: "chapter-001", index: 1 },
        { id: "sb-orphan", index: 2 },
      ],
    }));
    expect(plan.manifest.shards.some((name) => name.startsWith("storyboards-shared-001-"))).toBe(true);
    expect((merged.state.storyboards as unknown[])).toHaveLength(2);
  });

  it("attributes indirect domains via storyboard/track maps (imageWorkflows/videoCandidates)", () => {
    const state = {
      storyboards: [
        { id: "sb-1", episodeId: "chapter-007", index: 1 },
      ],
      productionTracks: [
        { id: "track-1", episodeId: "chapter-007", trackKey: "chapter-007", storyboardIds: [], candidateVideoIds: [] },
      ],
      imageWorkflows: [
        { id: "iw-1", name: "分镜工作流", target: { kind: "storyboard", id: "sb-1" } },
        { id: "iw-2", name: "自由画布", target: { kind: "free" } },
      ],
      videoCandidates: [
        { id: "vc-1", trackId: "track-1", provider: "ffmpeg-local", state: "ready" },
        { id: "vc-2", trackId: "track-void", provider: "ffmpeg-local", state: "ready" },
      ],
    };
    const { plan } = roundTrip(envelopeOf(state));
    expect(plan.manifest.shards.some((name) => name.startsWith("chapter-007-image-workflows-001-"))).toBe(true);
    expect(plan.manifest.shards.some((name) => name.startsWith("image-workflows-shared-001-"))).toBe(true);
    expect(plan.manifest.shards.some((name) => name.startsWith("chapter-007-video-candidates-001-"))).toBe(true);
    expect(plan.manifest.shards.some((name) => name.startsWith("video-candidates-shared-001-"))).toBe(true);
  });

  it("gives an oversized single item its own shard and reports it (单章超限独占)", () => {
    const state = buildRichState();
    (state.novelChapters as unknown[])[0] = {
      id: "chapter-huge",
      title: "巨章",
      sourceText: "文".repeat(2000),
    };
    const plan = planStudioWorkflowShards(envelopeOf(state), { limitBytes: 1024 });
    const hugeShard = plan.files.find((file) => file.name.startsWith("chapter-huge-novel-chapters-"));
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
    const plan = planStudioWorkflowShards(value, { limitBytes: 2048 });
    const merged = mergeStudioWorkflowShards(plan.files.map((file) => file.content));
    expect(merged.state.sourceBible).toBe("圣".repeat(1200));
    expect(plan.files.length).toBeGreaterThan(1);
    for (const file of plan.files) {
      if (!plan.oversizedFiles.some((base) => file.name.startsWith(base))) {
        expect(Buffer.byteLength(file.content, "utf8")).toBeLessThanOrEqual(2048);
      }
    }
  });

  it("sends unregistered array keys to core instead of inventing shard names", () => {
    const { plan, merged } = roundTrip(envelopeOf({ futureDomain: [{ a: 1 }, { b: 2 }] }));
    expect(plan.manifest.shards.every((name) => name.startsWith("core-"))).toBe(true);
    expect(merged.state.futureDomain).toEqual([{ a: 1 }, { b: 2 }]);
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
