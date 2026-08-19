import { describe, expect, it } from "vitest";
import {
  LAYER_PAN_ZOOM_DAMP_DEFAULTS,
  buildParticleField,
  fogBandLeftsAt,
  layerPanZoomDamp,
  mulberry32,
  particleStateAt,
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

  it("粒子状态:右飘上飘+回卷+闪烁有界", () => {
    const particle = buildParticleField(7, 1)[0]!;
    const t0 = particleStateAt(particle, 0);
    // 短时距断言方向(未触发回卷);t0.2 上飘 ≤0.038 屏高,fixture y≥0.1 不会越界回卷
    const tShort = particleStateAt(particle, 0.2);
    expect(tShort.leftPct).toBeGreaterThan(t0.leftPct);
    expect(tShort.topPct).toBeLessThan(t0.topPct);
    expect(tShort.opacity).toBeGreaterThanOrEqual(0);
    expect(tShort.opacity).toBeLessThanOrEqual(1);
    // 长时间回卷不越界(1.05 屏宽回绕)
    for (const t of [10, 60, 300]) {
      const state = particleStateAt(particle, t);
      expect(state.leftPct).toBeLessThanOrEqual(108);
      expect(state.topPct).toBeGreaterThanOrEqual(-2);
      expect(state.topPct).toBeLessThanOrEqual(105);
    }
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
