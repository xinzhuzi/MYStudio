import { describe, expect, it } from "vitest";
import {
  SHOT_FX_MOTION_PRESETS,
  SHOT_FX_MOTION_ROTATION,
  buildShotFxByClipId,
  isShotFxMotionId,
  resolveRuleShotFxMotion,
  type ShotFxPlanClipLike,
  type ShotFxStoryboardInput,
  type ShotFxVisualClipLike,
} from "./shot-fx-decisions";

function buildInput(storyboards: ShotFxStoryboardInput[], clipCount = storyboards.length) {
  const planClips: ShotFxPlanClipLike[] = storyboards.map((storyboard, index) => ({
    id: `clip-${index + 1}`,
    trackKind: "visual",
    source: { evidence: { storyboardId: storyboard.id } },
  }));
  const visualClips: ShotFxVisualClipLike[] = planClips.map((clip) => ({ clipId: clip.id }));
  return { planClips: planClips.slice(0, clipCount), visualClips: visualClips.slice(0, clipCount), storyboards };
}

describe("SHOT_FX_MOTION_PRESETS 锐度纪律", () => {
  it("所有模式 fromScale ≥ 1.0（裁切不出边）", () => {
    for (const panZoom of Object.values(SHOT_FX_MOTION_PRESETS)) {
      expect(panZoom.fromScale).toBeGreaterThanOrEqual(1.0);
    }
  });

  it("常规模式 toScale ≤ 1.08，punch 上限 1.12", () => {
    for (const [id, panZoom] of Object.entries(SHOT_FX_MOTION_PRESETS)) {
      const cap = id === "punch-in" ? 1.12 : 1.08;
      expect(panZoom.toScale).toBeLessThanOrEqual(cap);
    }
  });

  it("轮换表 7 模式全部在预设表内", () => {
    expect(SHOT_FX_MOTION_ROTATION).toHaveLength(7);
    for (const id of SHOT_FX_MOTION_ROTATION) {
      expect(isShotFxMotionId(id)).toBe(true);
    }
  });
});

describe("resolveRuleShotFxMotion 规则运镜", () => {
  it("动作词命中 punch-in", () => {
    expect(resolveRuleShotFxMotion("一剑劈下", 0)).toBe("punch-in");
  });

  it("退场词仅在偶数镜启用 leave-pull，奇数镜走轮换", () => {
    expect(resolveRuleShotFxMotion("他转身离去", 0)).toBe("leave-pull");
    expect(resolveRuleShotFxMotion("他转身离去", 1)).toBe("pull-out");
  });

  it("未命中按镜序轮换", () => {
    expect(resolveRuleShotFxMotion("庭院里喝茶", 0)).toBe("push-in");
    expect(resolveRuleShotFxMotion("庭院里喝茶", 2)).toBe("pan-right");
    expect(resolveRuleShotFxMotion("庭院里喝茶", 7)).toBe("push-in");
  });
});

describe("buildShotFxByClipId", () => {
  it("无提示时按镜序轮换，grain 常驻", () => {
    const { byClipId, counts } = buildShotFxByClipId(
      buildInput([{ id: "s1", prompt: "庭院喝茶" }, { id: "s2", prompt: "廊下行走" }]),
    );
    expect(counts.motion).toBe(2);
    expect(byClipId.get("clip-1")?.panZoom).toEqual(SHOT_FX_MOTION_PRESETS["push-in"]);
    expect(byClipId.get("clip-2")?.panZoom).toEqual(SHOT_FX_MOTION_PRESETS["pull-out"]);
    for (const decision of byClipId.values()) {
      expect(decision.fx.grain).toEqual({ opacity: 0.035 });
    }
  });

  it("动作词命中 punch 参数并叠加 shake+chroma", () => {
    const { byClipId, counts } = buildShotFxByClipId(
      buildInput([{ id: "s1", prompt: "爆炸轰鸣" }]),
    );
    const decision = byClipId.get("clip-1");
    expect(decision?.panZoom).toEqual(SHOT_FX_MOTION_PRESETS["punch-in"]);
    expect(decision?.fx.shake).toEqual({ amplitudePx: 6 });
    expect(decision?.fx.chroma).toEqual({ offsetPx: 3 });
    expect(counts.shake).toBe(1);
    expect(counts.chroma).toBe(1);
  });

  it("AI 提示合法时优先于关键词与轮换", () => {
    const { byClipId } = buildShotFxByClipId(
      buildInput([{ id: "s1", prompt: "庭院喝茶", shotFx: { motion: "tilt-up", source: "ai" } }]),
    );
    expect(byClipId.get("clip-1")?.panZoom).toEqual(SHOT_FX_MOTION_PRESETS["tilt-up"]);
  });

  it("AI 提示优先于动作关键词，但 fx 层仍按关键词叠加", () => {
    const { byClipId } = buildShotFxByClipId(
      buildInput([{ id: "s1", prompt: "爆炸轰鸣", shotFx: { motion: "drift", source: "ai" } }]),
    );
    const decision = byClipId.get("clip-1");
    expect(decision?.panZoom).toEqual(SHOT_FX_MOTION_PRESETS.drift);
    expect(decision?.fx.shake).toEqual({ amplitudePx: 6 });
  });

  it("AI 提示非法值按无提示处理（回落规则运镜）", () => {
    const { byClipId } = buildShotFxByClipId(
      buildInput([{ id: "s1", prompt: "庭院喝茶", shotFx: { motion: "spin-around", source: "ai" } }]),
    );
    expect(byClipId.get("clip-1")?.panZoom).toEqual(SHOT_FX_MOTION_PRESETS["push-in"]);
  });
});
