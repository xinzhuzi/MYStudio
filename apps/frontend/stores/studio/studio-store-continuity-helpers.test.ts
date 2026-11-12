import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import {
  continuityAssetVersionKey,
  healStaleFingerprintDrift,
  invalidateStoryboardsForAssetVersionChanges,
  markStale,
  mergeStoryboardReplacement,
  storyboardSourceFingerprint,
  storyboardSourceFingerprintDrifted,
  storyboardTextLayerFingerprint,
  trackSourceFingerprint,
  videoCandidateFingerprint,
} from "./studio-store-continuity-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

function storyboard(updates: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-1",
    episodeId: "episode-1",
    index: 1,
    trackKey: "track-1",
    trackId: "track-1",
    duration: 4,
    prompt: "prompt",
    videoDesc: "video",
    assetIds: ["asset-1"],
    state: "ready",
    ...updates,
  } as StoryboardItem;
}

describe("studio continuity helper contracts", () => {
  it("preserves the exact legacy fingerprint when source scene evidence is absent", () => {
    const legacy = '{"assetIds":["asset-1"],"duration":4,"episodeId":"episode-1","index":1,"orderedReferenceManifest":[],"prompt":"prompt","trackKey":"track-1","videoDesc":"video"}';

    expect(storyboardSourceFingerprint(storyboard())).toBe(legacy);
    expect(storyboardSourceFingerprint(storyboard({
      sourceEvidence: { source: "storyboard-table", sourcePath: "source.md" },
    }))).toBe(legacy);
    expect(storyboardSourceFingerprint(storyboard({
      sourceEvidence: { source: "storyboard-table", scene: undefined },
    }))).toBe(legacy);
  });

  it("builds stable asset, storyboard, track, and candidate fingerprints", () => {
    expect(continuityAssetVersionKey({ assetId: "asset-1", versionId: "v2" })).toBe("asset-1:v2");
    expect(storyboardSourceFingerprint(storyboard())).toBe(storyboardSourceFingerprint(storyboard()));
    expect(trackSourceFingerprint(
      {
        id: "track-1",
        episodeId: "episode-1",
        trackKey: "track-1",
        storyboardIds: ["sb-1"],
        prompt: "track prompt",
        duration: 4,
        state: "ready",
      } as never,
      [storyboard()],
    )).toBe(trackSourceFingerprint(
      {
        id: "track-1",
        episodeId: "episode-1",
        trackKey: "track-1",
        storyboardIds: ["sb-1"],
        prompt: "track prompt",
        duration: 4,
        state: "ready",
      } as never,
      [storyboard()],
    ));
    expect(videoCandidateFingerprint({ trackId: "track-1", provider: "model-placeholder", filePath: "/a.mp4" }))
      .not.toBe(videoCandidateFingerprint({ trackId: "track-1", provider: "model-placeholder", filePath: "/b.mp4" }));
  });

  it.each([
    { index: 5, name: "room entry" },
    { index: 4, name: "room inspection" },
    undefined,
  ])("invalidates existing media after a source scene change to %j", (scene) => {
    const previous = storyboard({
      sourceEvidence: { source: "storyboard-table", scene: { index: 4, name: "room entry" } },
      mediaRef: { kind: "image", path: "/same.png" },
      outputVersion: 4,
    });
    previous.sourceFingerprint = storyboardSourceFingerprint(previous);
    const next = { ...previous, sourceEvidence: { source: "storyboard-table", scene } };

    expect(storyboardSourceFingerprint(next)).not.toBe(previous.sourceFingerprint);
    expect(mergeStoryboardReplacement(previous, next, "scene changed")).toMatchObject({
      stale: true,
      staleReason: "scene changed",
      sourceEvidence: next.sourceEvidence,
      sourceFingerprint: storyboardSourceFingerprint(next),
      outputVersion: 4,
      mediaRef: previous.mediaRef,
    });
  });

  it("increments output and resets visual review on a fresh visual write", () => {
    const review = {
      status: "approved",
      reasons: [],
      characterChecks: [],
      sceneChecks: [],
      propChecks: [],
      transitionChecks: [],
      textWatermarkCheck: { passed: true },
      reviewer: "human",
      evidencePaths: [],
      inputFingerprint: "fingerprint",
    } satisfies NonNullable<StoryboardItem["visualReview"]>;
    const previous = storyboard({
      mediaRef: { kind: "image", path: "/old.png" },
      outputVersion: 2,
      visualReview: review,
    });
    const next = storyboard({
      mediaRef: { kind: "image", path: "/new.png" },
      visualReview: review,
    });

    const merged = mergeStoryboardReplacement(previous, next, "stale");

    expect(merged).toMatchObject({
      stale: false,
      outputVersion: 3,
      sourceFingerprint: storyboardSourceFingerprint(next),
      visualReview: { status: "pending", reasons: ["分镜画面或连续性输入已变化，必须重新审核"] },
    });
  });

  it("marks existing output stale when only source semantics change", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    const previous = storyboard({
      mediaRef: { kind: "image", path: "/same.png" },
      outputVersion: 4,
    });
    const next = storyboard({
      mediaRef: previous.mediaRef,
      prompt: "changed prompt",
    });

    const merged = mergeStoryboardReplacement(previous, next, "需要重新生成");

    expect(merged).toMatchObject({
      stale: true,
      staleReason: "需要重新生成",
      staleSince: 123,
      outputVersion: 4,
      visualReview: undefined,
    });
  });

  it("marks existing output stale when the cinematic preset changes", () => {
    vi.spyOn(Date, "now").mockReturnValue(321);
    const previous = storyboard({
      mediaRef: { kind: "image", path: "/same.png" },
      outputVersion: 2,
      cinematic: {
        preset: "cinematic-dolly-in",
        parallaxStrength: 0.35,
        dofAperture: 2.8,
      },
    } as unknown as Partial<StoryboardItem>);
    const next = storyboard({
      mediaRef: previous.mediaRef,
      cinematic: {
        preset: "cinematic-orbit",
        parallaxStrength: 0.35,
        dofAperture: 2.8,
      },
    } as unknown as Partial<StoryboardItem>);

    expect(mergeStoryboardReplacement(previous, next, "需要重新渲染 cinematic 分镜")).toMatchObject({
      stale: true,
      staleReason: "需要重新渲染 cinematic 分镜",
      staleSince: 321,
      outputVersion: 2,
    });
  });

  it("marks arbitrary records stale without mutating the input", () => {
    vi.spyOn(Date, "now").mockReturnValue(456);
    const source = { id: "record", stale: false };

    const result = markStale(source, "过期");

    expect(source).toEqual({ id: "record", stale: false });
    expect(result).toEqual({ id: "record", stale: true, staleReason: "过期", staleSince: 456 });
  });

  it("invalidates direct asset references and downstream continuity dependents", () => {
    vi.spyOn(Date, "now").mockReturnValue(789);
    const visualReview = {
      status: "approved",
      reasons: [],
      characterChecks: [],
      sceneChecks: [],
      propChecks: [],
      transitionChecks: [],
      textWatermarkCheck: { passed: true },
      reviewer: "human",
      evidencePaths: ["/review.png"],
      inputFingerprint: "fingerprint",
    } satisfies NonNullable<StoryboardItem["visualReview"]>;
    const continuityState = {
      groupId: "group-1",
      sceneVersionId: "scene-v1",
      sceneViewpointId: "scene-front",
      lighting: "day",
      palette: "warm",
      actionIn: "enter",
      actionOut: "exit",
      characters: [],
      inputFingerprint: "fingerprint",
    } satisfies NonNullable<StoryboardItem["continuityState"]>;
    const source = storyboard({
      orderedReferenceManifest: [{ order: 1, assetId: "asset-1", versionId: "v2", referenceRole: "canonical" }],
      continuityState,
      visualReview,
    });
    const dependent = storyboard({
      id: "sb-2",
      index: 2,
      continuityState: { ...continuityState, previousStoryboardId: source.id },
      visualReview,
    });
    const before = structuredClone([source, dependent]);

    const next = invalidateStoryboardsForAssetVersionChanges(
      [source, dependent],
      new Set(["asset-1:v2"]),
    );

    expect(next).toMatchObject([
      { id: "sb-1", stale: true, staleSince: 789, visualReview: { status: "pending" } },
      { id: "sb-2", stale: true, staleSince: 789, visualReview: { status: "pending" } },
    ]);
    expect(next[0]?.staleReason).toBe("引用的角色、场景或道具基准资产已变化");
    expect(next[1]?.staleReason).toBe("上游连续镜头 sb-1 已变化");
    expect([source, dependent]).toEqual(before);
  });
});

// W1/W2(1112 验尸 .trellis/tasks/11-12-storyboard-asset-refchain-repair):
// 文本层重生成必须失效 continuity/manifest 继承并置脏;裸写(离线 CLI 直写
// 分片)造成的指纹漂移必须可判定、水合可自愈。桩抄 store 分片真源结构
// (snap-20261111 storyboards-002:sb-chapter-001-009 形态)。
describe("storyboard stale chain repair (1112 验尸 W1/W2)", () => {
  /** 桩=store 分片真源形态:sb-chapter-001-009(chapter-001/001-9/中文 prompt+lines+manifest)。 */
  function shardShot(updates: Partial<StoryboardItem> = {}): StoryboardItem {
    return {
      id: "sb-chapter-001-009",
      episodeId: "chapter-001",
      index: 9,
      trackKey: "001-9",
      trackId: "",
      duration: 4,
      prompt: "夜。金水塾馆三间青瓦房围一方小院，门楣上朽烂的木匾墨迹漫漶。",
      videoDesc: "管事踱步扫视来客、发问、塞白土笔指屋。",
      assetIds: ["独孤剑尘", "管事"],
      lines: "管事：识字么？认得几个，行。",
      state: "ready",
      ...updates,
    } as StoryboardItem;
  }

  const manifest = [{
    order: 1,
    assetId: "scene_1780296482373_avuxou2",
    assetName: "金水河码头",
    assetKind: "scene",
    imagePath: "project-file://49dce4c1-64b1-42de-85c2-9f266698aec4/continuity-bibles/chapter-001/v5/assets/scene/reference-1.png",
    versionId: "scene_1780296482373_avuxou2:dock-main-axis:v1",
    referenceRole: "scene-viewpoint",
  }] as NonNullable<StoryboardItem["orderedReferenceManifest"]>;

  const continuityState = {
    groupId: "group-chapter-001",
    sceneVersionId: "scene_1780296482373_avuxou2:dock-main-axis:v1",
    sceneViewpointId: "dock-main-axis",
    palette: "墨青、灰蓝、湿石赭褐与克制旧木色",
    lighting: "清晨冷色漫射雾光",
    actionIn: "独孤剑尘立于门外低声应对",
    actionOut: "接笔进屋",
    characters: [],
    inputFingerprint: "fp-continuity",
  } as NonNullable<StoryboardItem["continuityState"]>;

  it("文本层指纹:continuity/manifest 层变化不影响,prompt/lines 变化影响", () => {
    const base = shardShot();
    expect(storyboardTextLayerFingerprint(base))
      .toBe(storyboardTextLayerFingerprint(shardShot({
        continuityState,
        orderedReferenceManifest: manifest,
      })));
    expect(storyboardTextLayerFingerprint(base))
      .not.toBe(storyboardTextLayerFingerprint(shardShot({ prompt: "改写后的画面描述" })));
    expect(storyboardTextLayerFingerprint(base))
      .not.toBe(storyboardTextLayerFingerprint(shardShot({ lines: "管事：改写后的台词。" })));
  });

  it("W1:文本重生成剥离 continuity/manifest 层且已有产出 ⇒ 置脏并失效两层", () => {
    vi.spyOn(Date, "now").mockReturnValue(1112);
    const previous = shardShot({
      continuityState,
      orderedReferenceManifest: manifest,
      mediaRef: { kind: "image", path: "project-file://49dce4c1/workflow-images/chapter-001/storyboard-1027/sb-chapter-001-009.png" },
      outputVersion: 6,
    });
    previous.sourceFingerprint = storyboardSourceFingerprint(previous);
    // 文本层重生成条目(toStoryboardItems 产出,不含 continuity/manifest 键,
    // prompt 已重写)——replace 链构造的 next 剥离两层后进入 merge:
    const next = { ...previous, prompt: "重生成:清晨雾光下的金水河码头远景。" };
    delete (next as Partial<StoryboardItem>).continuityState;
    delete (next as Partial<StoryboardItem>).orderedReferenceManifest;

    const merged = mergeStoryboardReplacement(previous, next, "storyboard source changed");

    expect(merged).toMatchObject({
      stale: true,
      staleReason: "storyboard source changed",
      staleSince: 1112,
      outputVersion: 6,
      prompt: next.prompt,
    });
    // 旧 continuity/manifest 层被剥离(键不存在),等生图回写重建。
    expect(merged.continuityState).toBeUndefined();
    expect(merged.orderedReferenceManifest).toBeUndefined();
    // 产出保留(等批量重跑),指纹收敛到现算。
    expect(merged.mediaRef).toBe(previous.mediaRef);
    expect(merged.sourceFingerprint).toBe(storyboardSourceFingerprint(merged));
  });

  it("W1:文本未变的重新保存保留 continuity 层且不置脏(零扰动)", () => {
    const previous = shardShot({
      continuityState,
      orderedReferenceManifest: manifest,
      mediaRef: { kind: "image", path: "project-file://49dce4c1/workflow-images/sb-chapter-001-009.png" },
      outputVersion: 6,
    });
    previous.sourceFingerprint = storyboardSourceFingerprint(previous);
    const next: StoryboardItem = { ...previous };

    const merged = mergeStoryboardReplacement(previous, next, "storyboard source changed");

    expect(merged.stale).toBeUndefined();
    expect(merged).toMatchObject({
      continuityState,
      orderedReferenceManifest: manifest,
      outputVersion: 6,
      mediaRef: previous.mediaRef,
    });
  });

  it("W2:storyboardSourceFingerprintDrifted——裸改 lines 不重算指纹 ⇒ 漂移可判定", () => {
    // 11-04 实弹验尸形态:分片里 lines 被 CLI 直写改掉,sourceFingerprint 逐字节未变。
    const shot = shardShot({ sourceFingerprint: undefined });
    shot.sourceFingerprint = storyboardSourceFingerprint(shot);
    expect(storyboardSourceFingerprintDrifted(shot)).toBe(false);
    shot.lines = "管事：离线 CLI 改写后的新台词。";
    expect(storyboardSourceFingerprintDrifted(shot)).toBe(true);
    // 无存档指纹的镜(存量老数据)不判漂移。
    expect(storyboardSourceFingerprintDrifted(shardShot())).toBe(false);
  });

  it("W1:healStaleFingerprintDrift——漂移+有产出 ⇒ 标脏+审核回 pending;无产出/无漂移不动", () => {
    vi.spyOn(Date, "now").mockReturnValue(2211);
    const visualReview = {
      status: "approved" as const,
      reasons: [],
      characterChecks: [],
      sceneChecks: [],
      propChecks: [],
      transitionChecks: [],
      textWatermarkCheck: { passed: true },
      reviewer: "human",
      evidencePaths: [],
      inputFingerprint: "fingerprint",
    } satisfies NonNullable<StoryboardItem["visualReview"]>;
    const driftedWithOutput = shardShot({
      mediaRef: { kind: "image", path: "project-file://49dce4c1/workflow-images/sb-chapter-001-009.png" },
      visualReview,
    });
    driftedWithOutput.sourceFingerprint = storyboardSourceFingerprint(driftedWithOutput);
    driftedWithOutput.lines = "管事：离线 CLI 改写后的新台词。"; // 裸写,指纹未跟
    const driftedNoOutput = shardShot();
    driftedNoOutput.sourceFingerprint = storyboardSourceFingerprint(driftedNoOutput);
    driftedNoOutput.prompt = "离线改写后的画面。";
    const fresh = shardShot({ mediaRef: { kind: "image", path: "project-file://49dce4c1/fresh.png" } });
    fresh.sourceFingerprint = storyboardSourceFingerprint(fresh);

    const healed = healStaleFingerprintDrift([driftedWithOutput, driftedNoOutput, fresh]);

    expect(healed[0]).toMatchObject({
      stale: true,
      staleSince: 2211,
      visualReview: { status: "pending", reasons: ["分镜画面或连续性输入已变化，必须重新审核"] },
    });
    expect(healed[0]?.staleReason).toContain("需重新生成");
    // 指纹不重算——漂移证据保留给消费面(W2 双保险)。
    expect(healed[0]?.sourceFingerprint).toBe(driftedWithOutput.sourceFingerprint);
    expect(healed[1]?.stale).toBeUndefined();
    expect(healed[1]?.prompt).toBe("离线改写后的画面。");
    expect(healed[2]?.stale).toBeUndefined();
    expect(healed[2]?.visualReview).toBe(undefined);
  });
});
