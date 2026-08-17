import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import {
  continuityAssetVersionKey,
  invalidateStoryboardsForAssetVersionChanges,
  markStale,
  mergeStoryboardReplacement,
  storyboardSourceFingerprint,
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
