// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import { buildRemotionShotPlans } from "./remotion-shot-plan-builder";
import { projectStoryboardShotCompositionProps } from "./shot-plan";
import { buildKeyframeId } from "@/lib/studio/keyframes";
import { validateStoryboardShotCompositionProps } from "@/electron/rendering/plugins/remotion/composition/composition-props-validation";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const P1 = `project-file://project-a/shots/kf1.png`;
const P2 = `project-file://project-a/shots/kf2.png`;

function shot(over: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "shot-1",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "t",
    trackId: "t",
    duration: 12,
    durationTarget: 12,
    prompt: "画面",
    videoDesc: "长镜",
    assetIds: [],
    mediaRef: { kind: "image", path: P1, contentSha256: HASH_A },
    state: "ready",
    lines: "",
    subtitleAuthority: {
      mode: "clean-remotion",
      evidence: { mode: "clean-remotion", decision: "imported-manifest", sourceFingerprint: HASH_A, evidencePaths: ["test"] },
    },
    ...over,
  } as unknown as StoryboardItem;
}

const RENDER_SETTINGS = {
  width: 1080, height: 1920, fps: 30, codec: "h264" as const,
  subtitleMode: "burn-in" as const, loudnessLufs: -14, truePeakDbtp: -1.5,
};

const resolveCapabilityUrl = (reference: { relativePath: string; contentSha256: string }) =>
  `http://127.0.0.1:9222/${reference.contentSha256}/${reference.relativePath.split("/").pop()}`;

async function compile(over: Partial<StoryboardItem>) {
  const result = await buildRemotionShotPlans({
    projectId: "project-a",
    chapterId: "chapter-001",
    chapterRevision: 1,
    renderSettings: RENDER_SETTINGS,
    storyboards: [shot(over)],
    continuityPolicy: "skip",
  });
  return result;
}

describe("M2 渲染多帧", () => {
  it("builder 展开关键帧引用集(仅有图帧),投影产 2 clip+1 镜内转场", async () => {
    const built = await compile({
      keyframes: [
        { frameId: buildKeyframeId("shot-1", 1), mediaRef: { kind: "image", path: P1, contentSha256: HASH_A }, inUs: 0 },
        { frameId: buildKeyframeId("shot-1", 2), mediaRef: { kind: "image", path: P2, contentSha256: HASH_B }, inUs: 6_000_000 },
        // 空规划槽应被跳过
        { frameId: buildKeyframeId("shot-1", 3), mediaRef: { kind: "image", path: "" }, inUs: 9_000_000 },
      ],
    });
    expect(built.success).toBe(true);
    if (!built.success) return;
    const plan = built.plans[0];
    expect(plan.shot.keyframes).toHaveLength(2);
    expect(plan.shot.keyframes?.[0].source.contentSha256).toBe(HASH_A);

    const projected = projectStoryboardShotCompositionProps(plan, resolveCapabilityUrl);
    expect(projected.success, JSON.stringify(projected.success ? [] : projected.issues.map((i) => i.message))).toBe(true);
    if (!projected.success) return;
    const props = projected.value;
    // 12s@30fps=360 帧;重叠窗 18 帧:帧2 提前到 162 进场,帧1 跑到 180 边界
    expect(props.visualClips).toHaveLength(2);
    expect(props.visualClips[0]).toMatchObject({ clipId: buildKeyframeId("shot-1", 1), from: 0, durationInFrames: 180 });
    expect(props.visualClips[1]).toMatchObject({ clipId: buildKeyframeId("shot-1", 2), from: 162, durationInFrames: 198 });
    // 镜内水墨叠化:600ms@30fps=18 帧 ≤ 间隔一半(90)
    expect(props.transitions).toHaveLength(1);
    expect(props.transitions[0]).toMatchObject({
      fromClipId: buildKeyframeId("shot-1", 1),
      toClipId: buildKeyframeId("shot-1", 2),
      effectId: "ink-bleed",
      overlapFrames: 18,
    });
    expect(validateStoryboardShotCompositionProps(props).success).toBe(true);
  });

  it("单帧(无 keyframes)投影与改造前逐字段一致(clipId=shotId,transitions=[])", async () => {
    const built = await compile({});
    expect(built.success).toBe(true);
    if (!built.success) return;
    const projected = projectStoryboardShotCompositionProps(built.plans[0], resolveCapabilityUrl);
    expect(projected.success).toBe(true);
    if (!projected.success) return;
    const props = projected.value;
    expect(props.visualClips).toHaveLength(1);
    expect(props.visualClips[0].clipId).toBe("shot-1");
    expect(props.visualClips[0].from).toBe(0);
    expect(props.transitions).toEqual([]);
    expect(validateStoryboardShotCompositionProps(props).success).toBe(true);
  });

  it("帧时序违规在 builder 层 fail-closed(乱序/末帧超时长)", async () => {
    const unordered = await compile({
      keyframes: [
        { frameId: buildKeyframeId("shot-1", 1), mediaRef: { kind: "image", path: P1, contentSha256: HASH_A }, inUs: 5_000_000 },
        { frameId: buildKeyframeId("shot-1", 2), mediaRef: { kind: "image", path: P2, contentSha256: HASH_B }, inUs: 2_000_000 },
      ],
    });
    expect(unordered.success).toBe(false);

    const beyond = await compile({
      keyframes: [
        { frameId: buildKeyframeId("shot-1", 1), mediaRef: { kind: "image", path: P1, contentSha256: HASH_A }, inUs: 0 },
        { frameId: buildKeyframeId("shot-1", 2), mediaRef: { kind: "image", path: P2, contentSha256: HASH_B }, inUs: 12_000_000 },
      ],
    });
    expect(beyond.success).toBe(false);
  });

  it("叠化钳制:短间隔帧对 overlap ≤ 间隔一半", async () => {
    const built = await compile({
      durationTarget: 4,
      keyframes: [
        { frameId: buildKeyframeId("shot-1", 1), mediaRef: { kind: "image", path: P1, contentSha256: HASH_A }, inUs: 0 },
        { frameId: buildKeyframeId("shot-1", 2), mediaRef: { kind: "image", path: P2, contentSha256: HASH_B }, inUs: 1_000_000 },
      ],
    });
    expect(built.success).toBe(true);
    if (!built.success) return;
    const projected = projectStoryboardShotCompositionProps(built.plans[0], resolveCapabilityUrl);
    if (!projected.success) throw new Error("projection failed: " + JSON.stringify(projected.issues.map((i) => i.message)));
    // 间隔 1s=30 帧 → overlap = min(18, 15) = 15
    expect(projected.value.transitions[0]?.overlapFrames).toBe(15);
  });
});
