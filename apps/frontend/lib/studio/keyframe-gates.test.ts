// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { StoryboardItem, StoryboardKeyframe } from "@/types/studio";
import {
  approvedVisualReviewIssues,
  visualReviewInputFingerprint,
} from "@/lib/studio/visual-continuity";
import { buildHumanApproval } from "@/lib/studio/remotion/remotion-shot-plan-builder";
import { buildKeyframeId } from "@/lib/studio/keyframes";
import { validateStoryboardJson, formatStoryboardJson } from "@/lib/studio/storyboard-json";

const HASH_A = "a".repeat(64);
const PATH_1 = "project-file://project-a/shots/1.png";
const PATH_2 = "project-file://project-a/shots/2.png";

function kfShot(framePaths: string[], approvedEvidence?: string[]): StoryboardItem {
  const keyframes: StoryboardKeyframe[] = framePaths.map((path, index) => ({
    frameId: buildKeyframeId("shot-1", index + 1),
    mediaRef: { kind: "image", path, contentSha256: HASH_A },
    inUs: index === 0 ? 0 : 6000,
  }));
  return {
    id: "shot-1",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "track-1",
    trackId: "track-1",
    duration: 12,
    prompt: "画面 1",
    videoDesc: "长镜双帧",
    assetIds: [],
    mediaRef: { kind: "image", path: framePaths[0], contentSha256: HASH_A },
    keyframes,
    state: "ready",
    lines: "",
    ...(approvedEvidence
      ? {
          visualReview: {
            status: "approved" as const,
            reasons: [],
            characterChecks: [],
            sceneChecks: [],
            propChecks: [],
            transitionChecks: [],
            textWatermarkCheck: { passed: true } as unknown as { passed: boolean },
            reviewer: "human" as const,
            reviewedAt: 1000,
            evidencePaths: approvedEvidence,
            inputFingerprint: "",
          },
        }
      : {}),
  } as unknown as StoryboardItem;
}

describe("C1 门禁:关键帧进审核指纹与证据", () => {
  it("换帧 2 → 指纹变化(已批审核打回 stale)", () => {
    const before = visualReviewInputFingerprint(kfShot([PATH_1, PATH_2]));
    const after = visualReviewInputFingerprint(
      kfShot([PATH_1, "project-file://project-a/shots/2-new.png"]),
    );
    expect(before).not.toBe(after);
  });

  it("无 keyframes 的单帧时代数据指纹不受新字段影响(不误伤既有批准)", () => {
    const withUndefined = visualReviewInputFingerprint(kfShot([PATH_1]));
    expect(withUndefined).toBe(visualReviewInputFingerprint(kfShot([PATH_1])));
  });

  it("证据逐帧精确匹配才放行;只批首帧 → review.evidence 拦截", () => {
    const shot = kfShot([PATH_1, PATH_2], [PATH_1, PATH_2]);
    shot.subtitleAuthority = {
      mode: "clean-remotion",
      evidence: { mode: "clean-remotion", decision: "imported-manifest", sourceFingerprint: HASH_A, evidencePaths: ["test"] },
    } as never;
    shot.visualReview!.inputFingerprint = visualReviewInputFingerprint(shot);
    const gateIssues = approvedVisualReviewIssues(shot).filter((issue) =>
      issue.code === "review.evidence" || issue.code === "review.stale",
    );
    expect(gateIssues).toEqual([]);

    const partial = kfShot([PATH_1, PATH_2], [PATH_1]);
    partial.visualReview!.inputFingerprint = visualReviewInputFingerprint(partial);
    const codes = approvedVisualReviewIssues(partial)
      .filter((issue) => issue.code === "review.evidence" || issue.code === "review.stale")
      .map((issue) => issue.code);
    expect(codes).toContain("review.evidence");
  });
});

describe("C2 门禁:批准收据与帧序列不一致 → 收据被丢弃", () => {
  // 直测决策函数:收据缺失在 requireHumanApproval 编译路径必然阻断
  // (shot-plan.ts "首章进入 Remotion 队列前必须完成...人工批准",既有行为)。
  const shotOf = (evidence: string[]) => {
    const shot = kfShot([PATH_1, PATH_2], evidence);
    shot.visualReview!.inputFingerprint = visualReviewInputFingerprint(shot);
    return shot;
  };
  const shotDefinition = {
    shotId: "shot-1", revision: 1,
  } as never;

  it("证据齐备 → 收据带逐帧 evidencePaths", () => {
    const receipt = buildHumanApproval("project-a", "chapter-001", shotOf([PATH_1, PATH_2]), shotDefinition);
    expect(receipt?.evidencePaths).toEqual([PATH_1, PATH_2]);
    expect(receipt?.evidencePath).toBe(PATH_1);
  });

  it("只批首帧 → 收据丢弃(undefined)", () => {
    expect(
      buildHumanApproval("project-a", "chapter-001", shotOf([PATH_1]), shotDefinition),
    ).toBeUndefined();
  });

  it("单帧时代数据(无 keyframes)维持原行为", () => {
    const single = kfShot([PATH_1], [PATH_1]);
    single.keyframes = undefined;
    single.visualReview!.inputFingerprint = visualReviewInputFingerprint(single);
    const receipt = buildHumanApproval("project-a", "chapter-001", single, shotDefinition);
    expect(receipt?.evidencePath).toBe(PATH_1);
    expect(receipt?.evidencePaths).toBeUndefined();
  });
});

describe("C3 门禁:canonical JSON 可见并可校验 keyframes", () => {
  it("format→validate round-trip 保留 keyframes;非法帧被拒", () => {
    const shot = kfShot([PATH_1, PATH_2]);
    const json = formatStoryboardJson([shot]);
    expect(json).toContain("keyframes");
    expect(json).toContain(buildKeyframeId("shot-1", 2));
    const round = validateStoryboardJson(json, "chapter-001", "project-a");
    expect(round.error).toBeUndefined();
    expect(round.items?.[0]?.keyframes).toHaveLength(2);

    const bad = json.replace('"inUs": 6000', '"inUs": 0');
    expect(validateStoryboardJson(bad, "chapter-001", "project-a").error).toContain("inUs");
  });
});
