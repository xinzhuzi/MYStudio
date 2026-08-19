import { describe, expect, it } from "vitest";
import type { EditingEffect } from "@/types/editing";
import {
  SHOT_FX_MOTION_PRESETS,
  SHOT_FX_MOTION_ROTATION,
  buildShotFxEditingEffects,
  isShotFxMotionId,
  mergeShotFxEditingEffects,
  resolveRuleShotFxMotion,
  type ShotFxPlanClipLike,
  type ShotFxStoryboardInput,
} from "./shot-fx-decisions";

function clip(index: number, storyboardId: string): ShotFxPlanClipLike {
  return {
    id: `clip-${index + 1}`,
    trackKind: "image",
    startUs: index * 1_000_000,
    durationUs: 1_000_000,
    source: { evidence: { storyboardId } },
  };
}

function buildInput(storyboards: ShotFxStoryboardInput[], clipCount = storyboards.length) {
  const planClips = storyboards.map((storyboard, index) => clip(index, storyboard.id));
  return { planClips: planClips.slice(0, clipCount), storyboards };
}

function effectOf(effects: EditingEffect[], effectId: string, clipId: string): EditingEffect | undefined {
  return effects.find((effect) => effect.effectId === effectId && effect.targetClipId === clipId);
}

describe("SHOT_FX_MOTION_PRESETS 锐度纪律", () => {
  it("所有配方 fromScale ≥ 1.0（裁切不出边）", () => {
    for (const recipe of Object.values(SHOT_FX_MOTION_PRESETS)) {
      expect(recipe.panZoom.fromScale).toBeGreaterThanOrEqual(1.0);
    }
  });

  it("常规配方 toScale ≤ 1.08，punch 上限 1.12", () => {
    for (const [id, recipe] of Object.entries(SHOT_FX_MOTION_PRESETS)) {
      const cap = id === "punch-in" ? 1.12 : 1.08;
      expect(recipe.panZoom.toScale).toBeLessThanOrEqual(cap);
    }
  });

  it("轮换表 7 模式全部在预设表内且为纯运镜（不带特效）", () => {
    expect(SHOT_FX_MOTION_ROTATION).toHaveLength(7);
    for (const id of SHOT_FX_MOTION_ROTATION) {
      expect(isShotFxMotionId(id)).toBe(true);
      expect(SHOT_FX_MOTION_PRESETS[id].fx).toEqual({});
    }
  });
});

describe("resolveRuleShotFxMotion 规则配方", () => {
  it("动作词命中 punch-in（急推+抖动+色差成套）", () => {
    expect(resolveRuleShotFxMotion("一剑劈下", 0)).toBe("punch-in");
  });

  it("追逐/灵光/暗夜词分别命中 chase-in/aura-push/gloom-pull 成套配方", () => {
    expect(resolveRuleShotFxMotion("他拼命奔逃", 0)).toBe("chase-in");
    expect(resolveRuleShotFxMotion("灵光大阵", 0)).toBe("aura-push");
    expect(resolveRuleShotFxMotion("夜雾深渊", 0)).toBe("gloom-pull");
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

describe("buildShotFxEditingEffects 契约产出", () => {
  it("每镜产出 panZoom + grain 效果，参数为契约形状（scaleFrom/scaleTo/x/y）", () => {
    const { effects, counts } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "庭院喝茶" }]),
    );
    const panZoom = effectOf(effects, "panZoom", "clip-1");
    const preset = SHOT_FX_MOTION_PRESETS["push-in"].panZoom;
    expect(panZoom?.params).toEqual({
      scaleFrom: preset.fromScale,
      scaleTo: preset.toScale,
      x: preset.originX,
      y: preset.originY,
    });
    expect(panZoom?.startUs).toBe(0);
    expect(panZoom?.durationUs).toBe(1_000_000);
    expect(panZoom?.enabled).toBe(true);
    expect(effectOf(effects, "grain", "clip-1")?.params).toEqual({ amount: 0.035 });
    expect(counts.motion).toBe(1);
  });

  it("动作词产出 punch-in 配方：急推 + shake 0.25 + chromaticAberration offset 3 成套 + 残影/帧步进(08-19 第二批规则注入)", () => {
    const { effects, counts } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "爆炸轰鸣" }]),
    );
    expect(effectOf(effects, "panZoom", "clip-1")?.params.scaleTo).toBe(1.12);
    expect(effectOf(effects, "shake", "clip-1")?.params).toEqual({ intensity: 0.25 });
    expect(effectOf(effects, "chromaticAberration", "clip-1")?.params).toEqual({ offset: 3 });
    expect(effectOf(effects, "afterimage", "clip-1")?.params).toEqual({ copies: 3, offset: 26, opacity: 0.5 });
    expect(effectOf(effects, "onTwos", "clip-1")?.params).toEqual({ step: 2 });
    expect(counts.shake).toBe(1);
    expect(counts.chroma).toBe(1);
  });

  it("追逐词产出 chase-in 配方：快推 + 轻抖，无色差无辉光", () => {
    const { effects, counts } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "拼命奔逃" }]),
    );
    expect(effectOf(effects, "panZoom", "clip-1")?.params.scaleTo).toBe(1.08);
    expect(effectOf(effects, "shake", "clip-1")?.params).toEqual({ intensity: 0.125 });
    expect(effectOf(effects, "chromaticAberration", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "glow", "clip-1")).toBeUndefined();
    expect(counts.shake).toBe(1);
  });

  it("灵光/暗夜词分别产出 aura-push/gloom-pull 配方（推/拉 + 辉光分档 0.5/0.25）", () => {
    const aura = buildShotFxEditingEffects(buildInput([{ id: "s1", prompt: "灵光阵法" }]));
    const dark = buildShotFxEditingEffects(buildInput([{ id: "s1", prompt: "深夜阴影" }]));
    expect(effectOf(aura.effects, "panZoom", "clip-1")?.params.scaleTo).toBe(1.05);
    expect(effectOf(aura.effects, "glow", "clip-1")?.params).toEqual({ intensity: 0.5 });
    expect(effectOf(dark.effects, "panZoom", "clip-1")?.params.scaleFrom).toBe(1.07);
    expect(effectOf(dark.effects, "glow", "clip-1")?.params).toEqual({ intensity: 0.25 });
  });

  it("AI 提示合法时整套生效——选纯运镜配方则不叠关键词特效（运镜+特效一致性）", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "爆炸轰鸣", shotFx: { motion: "drift", source: "ai" } }]),
    );
    const panZoom = effectOf(effects, "panZoom", "clip-1");
    expect(panZoom?.params.scaleFrom).toBe(SHOT_FX_MOTION_PRESETS.drift.panZoom.fromScale);
    expect(panZoom?.params.scaleTo).toBe(SHOT_FX_MOTION_PRESETS.drift.panZoom.toScale);
    expect(effectOf(effects, "shake", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "chromaticAberration", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "glow", "clip-1")).toBeUndefined();
  });

  it("AI 选成套配方则特效随之（非动作文本选 punch-in 亦带抖动+色差）", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "庭院里喝茶", shotFx: { motion: "punch-in", source: "ai" } }]),
    );
    expect(effectOf(effects, "shake", "clip-1")?.params).toEqual({ intensity: 0.25 });
    expect(effectOf(effects, "chromaticAberration", "clip-1")?.params).toEqual({ offset: 3 });
  });

  it("hold 锁帧：AI 可选，fromScale=toScale=1.0 无默认特效", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "关键台词定格", shotFx: { motion: "hold", source: "ai" } }]),
    );
    const panZoom = effectOf(effects, "panZoom", "clip-1")?.params;
    expect(panZoom?.scaleFrom).toBe(1.0);
    expect(panZoom?.scaleTo).toBe(1.0);
    expect(effectOf(effects, "shake", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "glow", "clip-1")).toBeUndefined();
  });

  it("AI 显式配置插件则覆盖配方默认（drift+glow-warm=梦境辉光组合）", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "庭院喝茶", shotFx: { motion: "drift", addons: ["glow-warm"], source: "ai" } }]),
    );
    expect(effectOf(effects, "glow", "clip-1")?.params).toEqual({ intensity: 0.5 });
    expect(effectOf(effects, "shake", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "chromaticAberration", "clip-1")).toBeUndefined();
  });

  it("AI 显式空插件=纯运镜（覆盖 punch-in 默认抖动+色差）", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "庭院喝茶", shotFx: { motion: "punch-in", addons: [], source: "ai" } }]),
    );
    expect(effectOf(effects, "panZoom", "clip-1")?.params.scaleTo).toBe(1.12);
    expect(effectOf(effects, "shake", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "chromaticAberration", "clip-1")).toBeUndefined();
  });

  it("同种特效插件互斥取首个档位，非法插件丢弃", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([
        { id: "s1", prompt: "庭院喝茶", shotFx: { motion: "push-in", addons: ["shake-hard", "shake-soft", "explode-fx"], source: "ai" } },
      ]),
    );
    expect(effectOf(effects, "shake", "clip-1")?.params).toEqual({ intensity: 0.25 });
  });

  it("AI 提示非法值按无提示处理（回落规则运镜）", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "庭院喝茶", shotFx: { motion: "spin-around", source: "ai" } }]),
    );
    expect(effectOf(effects, "panZoom", "clip-1")?.params.scaleTo).toBe(SHOT_FX_MOTION_PRESETS["push-in"].panZoom.toScale);
  });

  it("非视觉 track 与无 storyboard evidence 的片段不产出效果", () => {
    const { effects } = buildShotFxEditingEffects({
      planClips: [
        { ...clip(0, "s1"), trackKind: "voice" },
        { ...clip(1, "s2"), source: undefined },
      ],
      storyboards: [{ id: "s1" }, { id: "s2" }],
    });
    expect(effects).toHaveLength(0);
  });
});

describe("mergeShotFxEditingEffects 合并语义", () => {
  it("替换既有 auto-editing 的 panZoom 与旧 shotFx 条目（幂等），保留人工效果", () => {
    const input = buildInput([{ id: "s1", prompt: "庭院喝茶" }]);
    const existing: EditingEffect[] = [
      {
        id: "effect-pan-zoom-clip-1",
        effectId: "panZoom",
        targetClipId: "clip-1",
        startUs: 0,
        durationUs: 1_000_000,
        params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
        enabled: true,
      },
      {
        id: "effect-manual-fade-clip-1",
        effectId: "fade",
        targetClipId: "clip-1",
        startUs: 0,
        durationUs: 1_000_000,
        params: {},
        enabled: true,
      },
    ];
    const first = mergeShotFxEditingEffects(existing, input);
    expect(first.effects.filter((effect) => effect.effectId === "panZoom")).toHaveLength(1);
    expect(first.effects.find((effect) => effect.effectId === "panZoom")?.id).toBe("effect-shot-fx-panzoom-clip-1");
    expect(first.effects.find((effect) => effect.id === "effect-manual-fade-clip-1")).toBeDefined();

    const second = mergeShotFxEditingEffects(first.effects, input);
    expect(second.effects.filter((effect) => effect.effectId === "panZoom")).toHaveLength(1);
    expect(second.effects.filter((effect) => effect.id.startsWith("effect-shot-fx-"))).toHaveLength(
      first.effects.filter((effect) => effect.id.startsWith("effect-shot-fx-")).length,
    );
  });
});
