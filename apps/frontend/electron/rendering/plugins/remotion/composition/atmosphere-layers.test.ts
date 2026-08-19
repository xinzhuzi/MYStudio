import { describe, expect, it } from "vitest";
import {
  LAYER_PAN_ZOOM_DAMP_DEFAULTS,
  buildParticleField,
  fogBandLeftsAt,
  layerPanZoomDamp,
  mulberry32,
  particleStateAt,
  scaledTemplateParams,
} from "./atmosphere-layers";
import type { CompositionLayerSpec } from "./composition-props";

describe("atmosphere-layers(08-19 multilayer Child1)", () => {
  it("mulberry32 同 seed 同序列(渲染确定性前提)", () => {
    const a = mulberry32(20260819);
    const b = mulberry32(20260819);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
    const c = mulberry32(1);
    expect(seqA.every((value, index) => value !== c() || value === seqA[index])).toBe(true);
  });

  it("粒子场同 seed 复现,异 seed 相异", () => {
    const fieldA = buildParticleField(42, 48);
    const fieldB = buildParticleField(42, 48);
    const fieldC = buildParticleField(43, 48);
    expect(fieldA).toEqual(fieldB);
    expect(fieldA).not.toEqual(fieldC);
    expect(fieldA).toHaveLength(48);
  });

  const RISE = { dir: 1, riseSpeed: 14, driftSpeed: 16, sway: 0, swayFreq: 0, blink: 0.65 };
  const FALL = { dir: -1, riseSpeed: 6, driftSpeed: 8, sway: 3, swayFreq: 0.4, blink: 0 };

  it("粒子状态:上升右飘+回卷+闪烁有界", () => {
    const particle = buildParticleField(7, 1)[0]!;
    const t0 = particleStateAt(particle, 0, RISE);
    // 短时距断言方向(未触发回卷);t0.2 上飘 ≤0.038 屏高,fixture y≥0.08 不越界
    const tShort = particleStateAt(particle, 0.2, RISE);
    expect(tShort.leftPct).toBeGreaterThan(t0.leftPct);
    expect(tShort.topPct).toBeLessThan(t0.topPct);
    expect(tShort.opacity).toBeGreaterThanOrEqual(0);
    expect(tShort.opacity).toBeLessThanOrEqual(1);
    // 长时间回卷不越界(1.05 屏宽回绕)
    for (const t of [10, 60, 300]) {
      const state = particleStateAt(particle, t, RISE);
      expect(state.leftPct).toBeLessThanOrEqual(108);
      expect(state.topPct).toBeGreaterThanOrEqual(-2);
      expect(state.topPct).toBeLessThanOrEqual(105);
    }
  });

  it("粒子状态:下降模板(落叶/雪)顶百分比随时间增大,摆动有界", () => {
    const particle = buildParticleField(11, 1)[0]!;
    const t0 = particleStateAt(particle, 0, FALL);
    const tShort = particleStateAt(particle, 0.2, FALL);
    expect(tShort.topPct).toBeGreaterThan(t0.topPct);
    expect(Math.abs(tShort.swayPct)).toBeLessThanOrEqual(FALL.sway + 1e-9);
    expect(tShort.rotateDeg).toBeGreaterThan(0);
  });

  it("scaledTemplateParams:缺省合并+intensity 缩放不透明度与数量+闭集外 id 仅用 overrides", () => {
    const base = scaledTemplateParams("atmo:light-dust", undefined, 1);
    expect(base.count).toBe(48);
    expect(base.opacity).toBeCloseTo(0.7, 5);
    const boosted = scaledTemplateParams("atmo:light-dust", { opacity: 0.5 }, 2);
    expect(boosted.opacity).toBeCloseTo(1, 5); // 0.5*2 钳 1
    expect(boosted.count).toBe(96);
    const clamped = scaledTemplateParams("atmo:fireflies", undefined, 0.1);
    expect(clamped.count).toBeLessThanOrEqual(16);
    expect(clamped.opacity).toBeLessThanOrEqual(1);
    const unknown = scaledTemplateParams("atmo:not-exist", undefined, 1);
    expect(unknown.opacity).toBeCloseTo(0.2, 5); // 未知 id 回退内置缺省,不炸
    const override = scaledTemplateParams("atmo:fog-band", { y: 0.2, speed: 5 }, 1);
    expect(override.y).toBeCloseTo(0.2, 5);
    expect(override.speed).toBeCloseTo(5, 5);
  });

  it("雾带偏移:随时间左移,wrap=双份相距 100,非 wrap=单份", () => {
    const [x0, x1] = fogBandLeftsAt(0, 2, true);
    const [y0, y1] = fogBandLeftsAt(10, 2, true);
    expect(y0).toBeLessThan(x0); // 速度正=层左移(视差向右漂观感)
    expect(x1 - x0).toBeCloseTo(100, 5);
    expect(y1 - y0).toBeCloseTo(100, 5);
    expect(fogBandLeftsAt(5, 1.5, false)).toHaveLength(1);
  });

  it("damp 缺省表与显式覆盖", () => {
    const layer = (role: CompositionLayerSpec["role"], panZoomDamp?: number) => ({ role, panZoomDamp });
    expect(layerPanZoomDamp(layer("background"))).toBe(LAYER_PAN_ZOOM_DAMP_DEFAULTS.background);
    expect(layerPanZoomDamp(layer("subject"))).toBe(LAYER_PAN_ZOOM_DAMP_DEFAULTS.subject);
    expect(layerPanZoomDamp(layer("atmosphere"))).toBe(0);
    expect(layerPanZoomDamp(layer("foreground", 0.9))).toBe(0.9);
  });
});
