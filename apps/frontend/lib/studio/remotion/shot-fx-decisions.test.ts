import { describe, expect, it } from "vitest";
import type { EditingEffect } from "@/types/editing";
import {
  SHOT_FX_MOTION_PRESETS,
  SHOT_FX_MOTION_ROTATION,
  buildShotFxEditingEffects,
  enforceVscMotionQuota,
  isAssemblyOnlyClip,
  isShotFxMotionId,
  keywordShotFxMotion,
  mergeShotFxEditingEffects,
  resolveRuleShotFxMotion,
  ruleTransitionOut,
  type LegacyMotionId,
  type ShotFxPlanClipLike,
  type ShotFxStoryboardInput,
} from "./shot-fx-decisions";
import { isVscMotionId } from "./vsc-recipes";

/** legacy 18 值清单(锐度纪律回归锁辖 legacy 单图运镜;vsc 卡片曲线有自己的域)。 */
const LEGACY_MOTION_IDS = Object.keys(SHOT_FX_MOTION_PRESETS).filter(
  (id) => !isVscMotionId(id),
) as LegacyMotionId[];

function clip(index: number, storyboardId: string): ShotFxPlanClipLike {
  return {
    id: `clip-${index + 1}`,
    trackKind: "image",
    startUs: index * 1_000_000,
    durationUs: 1_000_000,
    // 素材形态门(10-11):夹具对齐 TimelineRenderClip 真身(source.kind 必填恒在场,
    // 两调用方均传 plan.clips 全量);本 helper 辖下的既有用例全测静图产线决策行为,
    // 挂 storyboardImage 走创作链,行为与门前逐项一致。
    source: { kind: "storyboardImage", evidence: { storyboardId } },
  };
}

function buildInput(storyboards: ShotFxStoryboardInput[], clipCount = storyboards.length) {
  const planClips = storyboards.map((storyboard, index) => clip(index, storyboard.id));
  return { planClips: planClips.slice(0, clipCount), storyboards };
}

function effectOf(effects: EditingEffect[], effectId: string, clipId: string): EditingEffect | undefined {
  return effects.find((effect) => effect.effectId === effectId && effect.targetClipId === clipId);
}

describe("SHOT_FX_MOTION_PRESETS 锐度纪律（legacy 18 回归锁;vsc 卡片曲线域另测）", () => {
  it("legacy 配方 fromScale ≥ 1.0（裁切不出边）", () => {
    expect(LEGACY_MOTION_IDS).toHaveLength(18);
    for (const id of LEGACY_MOTION_IDS) {
      expect(SHOT_FX_MOTION_PRESETS[id].panZoom.fromScale).toBeGreaterThanOrEqual(1.0);
    }
  });

  it("legacy 常规配方 toScale ≤ 1.08，punch 上限 1.12（vsc 域=卡片默认值,不辖）", () => {
    for (const id of LEGACY_MOTION_IDS) {
      const cap = id === "punch-in" ? 1.12 : 1.08;
      expect(SHOT_FX_MOTION_PRESETS[id].panZoom.toScale).toBeLessThanOrEqual(cap);
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

describe("ruleTransitionOut 转场规则兜底（08-19 转场决策层）", () => {
  it("情绪断裂词（任一侧命中）→ blackout，且优先于爆点词", () => {
    expect(ruleTransitionOut("血祭之地上空", "晨光初现")).toBe("blackout");
    expect(ruleTransitionOut("旧忆如烟", "诀别时刻")).toBe("blackout");
    // 同时带爆点词：断裂优先（窒息停顿比急闪更贴叙事）
    expect(ruleTransitionOut("血祭", "轰然炸开")).toBe("blackout");
  });

  it("下一镜动作爆点 → impact-frame；from 侧动作词不触发", () => {
    expect(ruleTransitionOut("庭院对坐", "一剑轰然劈下")).toBe("impact-frame");
    expect(ruleTransitionOut("一剑轰然劈下", "雨歇云散")).toBeUndefined();
  });

  it("无命中返回 undefined（=硬切，交回既有优先级链）", () => {
    expect(ruleTransitionOut("庭院里喝茶", "檐下听雨")).toBeUndefined();
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
      easing: "spring",
    });
    expect(panZoom?.startUs).toBe(0);
    expect(panZoom?.durationUs).toBe(1_000_000);
    expect(panZoom?.enabled).toBe(true);
    expect(effectOf(effects, "grain", "clip-1")?.params).toEqual({ amount: 0.035 });
    expect(counts.motion).toBe(1);
  });

  it("spring 接线（08-21）：push-in 入场带 easing:spring，其余运镜不带 easing 键", () => {
    // push-in：入场推进用 Remotion spring 弹性曲线
    const pushIn = buildShotFxEditingEffects(buildInput([{ id: "s1", prompt: "庭院喝茶" }]));
    expect(effectOf(pushIn.effects, "panZoom", "clip-1")?.params.easing).toBe("spring");
    // punch-in（急推）：未标注配方 → 不带 easing 键（cubic 历史行为）
    const punchIn = buildShotFxEditingEffects(buildInput([{ id: "s1", prompt: "爆炸轰鸣" }]));
    expect(effectOf(punchIn.effects, "panZoom", "clip-1")?.params.easing).toBeUndefined();
    // chase-in（追逐快推）：同样不带
    const chase = buildShotFxEditingEffects(buildInput([{ id: "s1", prompt: "拼命奔逃" }]));
    expect(effectOf(chase.effects, "panZoom", "clip-1")?.params.easing).toBeUndefined();
  });

  it("动作词产出 punch-in 配方：急推 + shake 0.25 成套 + 残影/帧步进(08-19 第二批规则注入;08-21 去默认色差)", () => {
    const { effects, counts } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "爆炸轰鸣" }]),
    );
    expect(effectOf(effects, "panZoom", "clip-1")?.params.scaleTo).toBe(1.12);
    expect(effectOf(effects, "shake", "clip-1")?.params).toEqual({ intensity: 0.25 });
    expect(effectOf(effects, "chromaticAberration", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "afterimage", "clip-1")?.params).toEqual({ copies: 3, offset: 26, opacity: 0.5 });
    expect(effectOf(effects, "onTwos", "clip-1")?.params).toEqual({ step: 2 });
    expect(counts.shake).toBe(1);
    expect(counts.chroma).toBe(0);
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

  it("AI 选成套配方则特效随之（非动作文本选 punch-in 亦带抖动;08-21 去默认色差）", () => {
    const { effects } = buildShotFxEditingEffects(
      buildInput([{ id: "s1", prompt: "庭院里喝茶", shotFx: { motion: "punch-in", source: "ai" } }]),
    );
    expect(effectOf(effects, "shake", "clip-1")?.params).toEqual({ intensity: 0.25 });
    expect(effectOf(effects, "chromaticAberration", "clip-1")).toBeUndefined();
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

describe("chapterGrade 章节统一色调（08-19 导演定调;08-21 裁定 blend 透传配置不设代码上限）", () => {
  it("钉死时全章统一 grade 覆盖逐镜 AI 选卡；blend 钳 0..1 透传", () => {
    const storyboards: ShotFxStoryboardInput[] = [
      { id: "sb-1", shotFx: { motion: "push-in", grade: { lutId: "cn-yuebai", blend: 0.8 }, source: "ai" } },
      { id: "sb-2", shotFx: { motion: "drift", source: "ai" } },
    ];
    const { effects } = buildShotFxEditingEffects({
      ...buildInput(storyboards),
      chapterGrade: { lutId: "cn-daiqing", blend: 1.7 },
    });
    const grades = effects.filter((effect) => effect.effectId === "grade");
    expect(grades).toHaveLength(2);
    for (const grade of grades) {
      expect(grade.params).toEqual({ lutId: "cn-daiqing", blend: 1 });
    }
  });

  it("未钉死时逐镜 AI grade 透传（有 grade 的镜才有效果）", () => {
    const storyboards: ShotFxStoryboardInput[] = [
      { id: "sb-1", shotFx: { motion: "push-in", grade: { lutId: "cn-yuebai", blend: 0.8 }, source: "ai" } },
      { id: "sb-2", shotFx: { motion: "drift", source: "ai" } },
    ];
    const { effects } = buildShotFxEditingEffects(buildInput(storyboards));
    const grades = effects.filter((effect) => effect.effectId === "grade");
    expect(grades).toHaveLength(1);
    expect(grades[0]!.params).toEqual({ lutId: "cn-yuebai", blend: 0.8 });
  });

  it("闭集外 lutId 的钉死值按缺省处理（不覆盖逐镜）", () => {
    const storyboards: ShotFxStoryboardInput[] = [
      { id: "sb-1", shotFx: { motion: "push-in", grade: { lutId: "cn-yuebai", blend: 0.8 }, source: "ai" } },
    ];
    const { effects } = buildShotFxEditingEffects({
      ...buildInput(storyboards),
      chapterGrade: { lutId: "not-in-set", blend: 0.5 },
    });
    const grades = effects.filter((effect) => effect.effectId === "grade");
    expect(grades).toHaveLength(1);
    expect(grades[0]!.params).toEqual({ lutId: "cn-yuebai", blend: 0.8 });
  });

  it("mergeShotFxEditingEffects 透传 chapterGrade 且幂等替换旧 shotFx grade", () => {
    const storyboards: ShotFxStoryboardInput[] = [
      { id: "sb-1", shotFx: { motion: "push-in", grade: { lutId: "cn-yuebai", blend: 0.8 }, source: "ai" } },
    ];
    const input = { ...buildInput(storyboards), chapterGrade: { lutId: "cn-zhuqing", blend: 0.6 } as const };
    const first = mergeShotFxEditingEffects([], input);
    const second = mergeShotFxEditingEffects(first.effects, input);
    expect(second.effects.filter((e) => e.effectId === "grade")).toHaveLength(1);
    expect(second.effects).toEqual(first.effects);
  });
});

describe("氛围层效果(08-19 multilayer Child2)", () => {
  const ATMO_STORYBOARD: ShotFxStoryboardInput = {
    id: "shot-001",
    shotFx: {
      motion: "hold",
      atmosphere: ["atmo:fog-band", "atmo:light-dust", "atmo:fog-band", "atmo:bogus", "atmo:embers"],
      source: "ai",
    },
  };

  it("shotFx.atmosphere 闭集校验+去重+上限 2 → atmosphere 效果条目", () => {
    const { effects } = buildShotFxEditingEffects({ planClips: [clip(0, "shot-001")], storyboards: [ATMO_STORYBOARD] });
    const atmo = effects.filter((effect) => effect.effectId === "atmosphere");
    expect(atmo.map((effect) => effect.params.template)).toEqual(["atmo:fog-band", "atmo:light-dust"]);
    for (const effect of atmo) {
      expect(effect.targetClipId).toBe("clip-1");
      expect(effect.params.intensity).toBe(1);
    }
  });

  it("atmosphereMode=off 全章关闭(人工覆盖)", () => {
    const { effects } = buildShotFxEditingEffects({
      planClips: [clip(0, "shot-001")],
      storyboards: [{ id: "shot-001", shotFx: { motion: "hold", atmosphere: ["atmo:petals"], source: "ai" } }],
      atmosphereMode: "off",
    });
    expect(effects.some((effect) => effect.effectId === "atmosphere")).toBe(false);
  });

  it("merge 幂等:同模板条目替换不重复", () => {
    const input = {
      planClips: [clip(0, "shot-001")],
      storyboards: [{ id: "shot-001", shotFx: { motion: "hold", atmosphere: ["atmo:snow"], source: "ai" } }] as const,
    };
    const first = mergeShotFxEditingEffects([], input);
    const second = mergeShotFxEditingEffects(first.effects, input);
    const atmo = second.effects.filter((effect) => effect.effectId === "atmosphere");
    expect(atmo).toHaveLength(1);
    expect(atmo[0]!.params.template).toBe("atmo:snow");
  });
});

describe("vsc:* 运镜扩容（10-10 批B,D1/D2/D4）", () => {
  it("闭集=legacy 18 + vsc 7;vsc camera 五卡 render=component,depth 两卡=layeredDepth 且带层系数", () => {
    expect(Object.keys(SHOT_FX_MOTION_PRESETS)).toHaveLength(25);
    const vscIds = Object.keys(SHOT_FX_MOTION_PRESETS).filter(isVscMotionId);
    expect(vscIds).toHaveLength(7);
    for (const id of vscIds) {
      const recipe = SHOT_FX_MOTION_PRESETS[id];
      expect(recipe.fx).toEqual({});
      expect(recipe.ambient).toBeNull();
      if (id === "vsc:parallax-glide" || id === "vsc:dolly-zoom") {
        expect(recipe.vsc?.render).toBe("layeredDepth");
        expect(recipe.vsc?.layers).toBeDefined();
      } else {
        expect(recipe.vsc?.render).toBe("component");
        expect(recipe.vsc?.layers).toBeUndefined();
      }
    }
  });

  it("视差滑轨层系数=0.35/0.7/1.4 梯度+背景 blur2/降饱和0.92/opacity0.85+前景 blur3", () => {
    const layers = SHOT_FX_MOTION_PRESETS["vsc:parallax-glide"].vsc!.layers!;
    expect(layers.background.panZoomDamp).toBe(0.35);
    expect(layers.background.blurFromPx).toBe(2);
    expect(layers.background.saturate).toBe(0.92);
    expect(layers.background.opacity).toBe(0.85);
    expect(layers.subject.panZoomDamp).toBe(0.7);
    // 主阅读层必须高清无锚:subject 类型上无 blur/降饱和键(类型级保证)
    expect(Object.keys(layers.subject)).toEqual(["panZoomDamp"]);
    expect(layers.foreground?.panZoomDamp).toBe(1.4);
    expect(layers.foreground?.blurFromPx).toBe(3);
  });

  it("伪dolly-zoom=主体钉死(damp0)+背景膨胀驱动 1→2.25+blur 0→3.5 渐深", () => {
    const preset = SHOT_FX_MOTION_PRESETS["vsc:dolly-zoom"];
    expect(preset.panZoom.fromScale).toBe(1.0);
    expect(preset.panZoom.toScale).toBe(2.25);
    const layers = preset.vsc!.layers!;
    expect(layers.subject.panZoomDamp).toBe(0);
    expect(layers.background.panZoomDamp).toBe(1);
    expect(layers.background.blurFromPx).toBe(0);
    expect(layers.background.blurToPx).toBe(3.5);
  });

  it("camera 五卡=组件接管:效果只产 vscMotion(recipe id),panZoom/grain 不产(D4 参数烧死)", () => {
    const { effects, counts } = buildShotFxEditingEffects({
      planClips: [clip(0, "shot-001")],
      storyboards: [{ id: "shot-001", shotFx: { motion: "vsc:dutch-roll-to-level", source: "ai" } }],
    });
    const vsc = effectOf(effects, "vscMotion", "clip-1");
    expect(vsc?.params).toEqual({ recipe: "vsc:dutch-roll-to-level" });
    expect(effectOf(effects, "panZoom", "clip-1")).toBeUndefined();
    expect(effectOf(effects, "grain", "clip-1")).toBeUndefined(); // 组件整体接管,伴生特效不叠加
    expect(effectOf(effects, "grade", "clip-1")).toBeUndefined();
    expect(counts.vsc).toBe(1);
    expect(counts.motion).toBe(0);
  });

  it("depth 两卡=panZoom 驱动照发+vscMotion id,伴生特效(颗粒)照常(panZoom 家族)", () => {
    const { effects, counts } = buildShotFxEditingEffects({
      planClips: [clip(0, "shot-001")],
      storyboards: [{ id: "shot-001", shotFx: { motion: "vsc:parallax-glide", source: "ai" } }],
    });
    const panZoom = effectOf(effects, "panZoom", "clip-1");
    expect(panZoom?.params.scaleFrom).toBe(1.04);
    expect(panZoom?.params.scaleTo).toBe(1.1);
    expect(effectOf(effects, "vscMotion", "clip-1")?.params).toEqual({ recipe: "vsc:parallax-glide" });
    expect(effectOf(effects, "grain", "clip-1")).toBeDefined();
    expect(counts.vsc).toBe(1);
    expect(counts.motion).toBe(1);
  });

  it("章级配额守卫:dolly-zoom 第二镜回落镜序轮换(emit 侧),crash-zoom 第三镜回落", () => {
    const storyboards: ShotFxStoryboardInput[] = [
      { id: "shot-001", shotFx: { motion: "vsc:dolly-zoom", source: "ai" } },
      { id: "shot-002", shotFx: { motion: "vsc:dolly-zoom", source: "ai" } },
      { id: "shot-003", shotFx: { motion: "vsc:crash-zoom-punch", source: "ai" } },
      { id: "shot-004", shotFx: { motion: "vsc:crash-zoom-punch", source: "ai" } },
      { id: "shot-005", shotFx: { motion: "vsc:crash-zoom-punch", source: "ai" } },
    ];
    const { effects } = buildShotFxEditingEffects(buildInput(storyboards));
    const recipes = effects
      .filter((effect) => effect.effectId === "vscMotion")
      .map((effect) => effect.params.recipe);
    expect(recipes).toEqual([
      "vsc:dolly-zoom", // 第 1 个 dolly 保留
      // 第 2 镜 dolly 超配额→轮换(index=1→pull-out,无 vscMotion 条目)
      "vsc:crash-zoom-punch", // crash 第 1 个
      "vsc:crash-zoom-punch", // crash 第 2 个
      // 第 5 镜 crash 超配额→轮换(index=4→tilt-down)
    ]);
    // 超配额镜回落 legacy 轮换运镜(照常 panZoom+grain)
    expect(effectOf(effects, "panZoom", "clip-2")?.params.scaleFrom).toBe(SHOT_FX_MOTION_PRESETS["pull-out"].panZoom.fromScale);
    expect(effectOf(effects, "panZoom", "clip-5")?.params.scaleFrom).toBe(SHOT_FX_MOTION_PRESETS["tilt-down"].panZoom.fromScale);
  });

  it("enforceVscMotionQuota(select 级共用):按镜头顺序保留前 N,超额回落轮换且确定性", () => {
    const motions = {
      s1: "vsc:dolly-zoom",
      s2: "vsc:dolly-zoom",
      s3: "push-in",
    } as Record<string, ReturnType<typeof resolveRuleShotFxMotion>>;
    const ordered = enforceVscMotionQuota(motions, ["s1", "s2", "s3"]);
    expect(ordered.s1).toBe("vsc:dolly-zoom");
    expect(ordered.s2).toBe("pull-out"); // index=1 轮换位
    expect(ordered.s3).toBe("push-in"); // legacy 永不受配额影响(D2)
    // 同输入同输出(确定性)
    expect(enforceVscMotionQuota(motions, ["s1", "s2", "s3"])).toEqual(ordered);
  });

  it("关键词兜底表扩:俯冲/天旋地转/斜/纵深/蓄力/孤身/点名 命中对应 vsc 配方;legacy 词优先级不变", () => {
    expect(keywordShotFxMotion("无人机俯冲而下", 0)).toBe("vsc:drone-dive-landing");
    expect(keywordShotFxMotion("他只觉天旋地转", 0)).toBe("vsc:dolly-zoom");
    expect(keywordShotFxMotion("画面倾斜的世界", 0)).toBe("vsc:dutch-roll-to-level");
    expect(keywordShotFxMotion("镜头纵深滑轨横移", 0)).toBe("vsc:parallax-glide");
    expect(keywordShotFxMotion("他蓄力待发", 0)).toBe("vsc:slow-push-in");
    expect(keywordShotFxMotion("孤身立于荒原", 0)).toBe("vsc:pull-back-isolation");
    expect(keywordShotFxMotion("长老点名直取要害", 0)).toBe("vsc:crash-zoom-punch");
    // legacy 命中永不改判(D2):动作词仍走 punch-in 而非 vsc crash-zoom
    expect(keywordShotFxMotion("一剑劈下点名", 0)).toBe("punch-in");
    expect(keywordShotFxMotion("庭院里喝茶", 0)).toBeUndefined();
  });

  it("vsc 关键词不进镜序轮换(同 hold:仅 AI/关键词可选)", () => {
    expect(SHOT_FX_MOTION_ROTATION.every((id) => !isVscMotionId(id))).toBe(true);
  });
});

/** 素材形态门用 clip 构造(带 source.kind,贴近 TimelineRenderClip 真身)。 */
function clipWith(
  index: number,
  source: ShotFxPlanClipLike["source"],
  trackKind: string = "video",
): ShotFxPlanClipLike {
  return {
    id: `clip-${index + 1}`,
    trackKind,
    startUs: index * 1_000_000,
    durationUs: 1_000_000,
    source,
  };
}

describe("isAssemblyOnlyClip 素材形态判定表(10-11 H3 主线分工;design 判定表逐行)", () => {
  it("videoCandidate → assembly-only(production track = H3 线)", () => {
    expect(
      isAssemblyOnlyClip(clipWith(0, { kind: "videoCandidate", evidence: { storyboardId: "s1" } })),
    ).toBe(true);
  });

  it("storyboardImage → 创作链(静图产线)", () => {
    expect(
      isAssemblyOnlyClip(clipWith(0, { kind: "storyboardImage", evidence: { storyboardId: "s1" } }, "image")),
    ).toBe(false);
  });

  it("storyboardVideo + remotionJobId → 创作链(Remotion 逐镜队列产物,静图+运镜已烘)", () => {
    expect(
      isAssemblyOnlyClip(
        clipWith(0, { kind: "storyboardVideo", evidence: { storyboardId: "s1", remotionJobId: "job-1" } }),
      ),
    ).toBe(false);
  });

  it("storyboardVideo 无 remotionJobId → assembly-only(mediaRef 视频=已有真实运动)", () => {
    expect(
      isAssemblyOnlyClip(clipWith(0, { kind: "storyboardVideo", evidence: { storyboardId: "s1" } })),
    ).toBe(true);
  });

  it("未知/未识别 kind → assembly-only(未知视频素材按真实视频保守处理)", () => {
    expect(isAssemblyOnlyClip(clipWith(0, { kind: "asset", evidence: { storyboardId: "s1" } }))).toBe(true);
    expect(isAssemblyOnlyClip(clipWith(0, { kind: "mystery-kind", evidence: { storyboardId: "s1" } }))).toBe(true);
  });

  it("无 source → assembly-only(无法溯源=保守跳过自动创作层)", () => {
    expect(isAssemblyOnlyClip(clipWith(0, undefined))).toBe(true);
  });
});

describe("buildShotFxEditingEffects 素材形态门(10-11 H3 主线分工:Remotion 收敛纯装配)", () => {
  it("用例A 混合章:H3(videoCandidate)镜零 effect-shot-fx- 前缀条目,静图镜 panzoom+grain 照发", () => {
    const { effects } = buildShotFxEditingEffects({
      planClips: [
        // H3 镜带 AI 显式 vsc 运镜 hint——即使 AI 选了运镜也不发(门辖自动层)
        clipWith(0, { kind: "videoCandidate", evidence: { storyboardId: "sb-h3" } }),
        clipWith(1, { kind: "storyboardImage", evidence: { storyboardId: "sb-still" } }, "image"),
      ],
      storyboards: [
        { id: "sb-h3", prompt: "对峙", shotFx: { motion: "vsc:slow-push-in", source: "ai" } },
        { id: "sb-still", prompt: "庭院里喝茶", shotFx: { motion: "push-in", source: "ai" } },
      ],
    });
    // H3 镜:零自动创作层(panZoom/vscMotion/grade/atmosphere/grain 全零)
    expect(effects.filter((effect) => effect.targetClipId === "clip-1")).toHaveLength(0);
    expect(
      effects.filter((effect) => effect.targetClipId === "clip-1" && effect.id.startsWith("effect-shot-fx-")),
    ).toHaveLength(0);
    // 静图镜:创作链不变(panzoom + grain 照发)
    expect(effectOf(effects, "panZoom", "clip-2")).toBeDefined();
    expect(effectOf(effects, "grain", "clip-2")).toBeDefined();
  });

  it("用例B 静图产线回归锁:remotionSlot 产物(storyboardVideo+remotionJobId)创作链逐项保留", () => {
    const { effects } = buildShotFxEditingEffects({
      planClips: [
        clipWith(0, { kind: "storyboardImage", evidence: { storyboardId: "sb-1" } }, "image"),
        clipWith(1, { kind: "storyboardVideo", evidence: { storyboardId: "sb-2", remotionJobId: "job-1" } }),
      ],
      storyboards: [
        { id: "sb-1", prompt: "庭院里喝茶", shotFx: { motion: "push-in", source: "ai" } },
        { id: "sb-2", prompt: "庭院里喝茶", shotFx: { motion: "vsc:slow-push-in", source: "ai" } },
      ],
    });
    // 静图镜:legacy 运镜 panZoom+grain(现行为)
    expect(effectOf(effects, "panZoom", "clip-1")).toBeDefined();
    expect(effectOf(effects, "grain", "clip-1")).toBeDefined();
    // remotionSlot 产物镜:vsc camera 卡照走 vscMotion(现行为,panZoom/grain 不叠加)
    expect(effectOf(effects, "vscMotion", "clip-2")?.params).toEqual({ recipe: "vsc:slow-push-in" });
    expect(effectOf(effects, "panZoom", "clip-2")).toBeUndefined();
    expect(effectOf(effects, "grain", "clip-2")).toBeUndefined();
  });

  it("用例C chapterGrade 过门:全 H3 镜章节零 grade;对照全静图镜章节 grade 照发(现行回归锁)", () => {
    const chapterGrade = { lutId: "cn-daiqing", blend: 0.4 };
    const h3 = buildShotFxEditingEffects({
      planClips: [clipWith(0, { kind: "videoCandidate", evidence: { storyboardId: "sb-1" } })],
      storyboards: [{ id: "sb-1", prompt: "对峙" }],
      chapterGrade,
    });
    expect(h3.effects.filter((effect) => effect.effectId === "grade")).toHaveLength(0);
    expect(h3.effects.filter((effect) => effect.targetClipId === "clip-1")).toHaveLength(0);

    const still = buildShotFxEditingEffects({
      planClips: [clipWith(0, { kind: "storyboardImage", evidence: { storyboardId: "sb-1" } }, "image")],
      storyboards: [{ id: "sb-1", prompt: "对峙" }],
      chapterGrade,
    });
    const grades = still.effects.filter((effect) => effect.effectId === "grade");
    expect(grades).toHaveLength(1);
    expect(grades[0]?.params).toEqual({ lutId: "cn-daiqing", blend: 0.4 });
  });

  it("用例D 轮换指数隔离:H3 镜不占轮换坑,两侧静图镜轮换连续", () => {
    const { effects } = buildShotFxEditingEffects({
      planClips: [
        clipWith(0, { kind: "storyboardImage", evidence: { storyboardId: "sb-1" } }, "image"),
        clipWith(1, { kind: "videoCandidate", evidence: { storyboardId: "sb-2" } }),
        clipWith(2, { kind: "storyboardImage", evidence: { storyboardId: "sb-3" } }, "image"),
      ],
      storyboards: [
        { id: "sb-1", prompt: "庭院里喝茶" },
        { id: "sb-2", prompt: "庭院里喝茶" },
        { id: "sb-3", prompt: "庭院里喝茶" },
      ],
    });
    // 第 1 静图镜 = 轮换 index 0 = push-in
    expect(effectOf(effects, "panZoom", "clip-1")?.params.scaleFrom).toBe(
      SHOT_FX_MOTION_PRESETS["push-in"].panZoom.fromScale,
    );
    // H3 镜夹中间不占坑 → 第 2 静图镜 = 轮换 index 1 = pull-out(非 index 2 的 pan-right)
    expect(effectOf(effects, "panZoom", "clip-3")?.params.scaleFrom).toBe(
      SHOT_FX_MOTION_PRESETS["pull-out"].panZoom.fromScale,
    );
    // H3 镜自身零产出
    expect(effects.filter((effect) => effect.targetClipId === "clip-2")).toHaveLength(0);
  });

  it("用例E 人工效果不受门辖:无 effect-shot-fx- 前缀的手工 panZoom 挂 H3 镜,merge 后保留", () => {
    const manualPanZoom: EditingEffect = {
      id: "effect-manual-pan-clip-1",
      effectId: "panZoom",
      targetClipId: "clip-1",
      startUs: 0,
      durationUs: 1_000_000,
      params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
      enabled: true,
    };
    const merged = mergeShotFxEditingEffects([manualPanZoom], {
      planClips: [clipWith(0, { kind: "videoCandidate", evidence: { storyboardId: "sb-1" } })],
      storyboards: [{ id: "sb-1", prompt: "对峙" }],
    });
    // 门只停 AI/规则自动注入层;人工效果(无前缀)照旧保留
    expect(merged.effects.find((effect) => effect.id === "effect-manual-pan-clip-1")).toBeDefined();
    // 同镜零自动产出(唯一 panZoom = 人工那条)
    expect(merged.effects.filter((effect) => effect.effectId === "panZoom")).toHaveLength(1);
  });
});
