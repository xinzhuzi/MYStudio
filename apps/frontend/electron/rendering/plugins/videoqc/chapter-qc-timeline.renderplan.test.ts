import { describe, expect, it } from "vitest";
import { buildShotSpansFromRenderPlan } from "./chapter-qc-timeline";

function plan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    renderSettings: { fps: 30 },
    clips: [
      { id: "c1", trackKind: "video", startUs: 0, durationUs: 4_000_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-1" } } },
      { id: "c2", trackKind: "video", startUs: 4_000_000, durationUs: 3_000_000, source: { kind: "storyboardVideo", evidence: { storyboardId: "sb-2" } } },
      { id: "t1", trackKind: "text", startUs: 0, durationUs: 1_000_000, source: { kind: "text", text: "x" } },
    ],
    transitions: [
      { id: "tr-1", fromClipId: "c1", toClipId: "c2", effectId: "gl:swap", durationUs: 1_000_000 },
    ],
    effects: [
      { id: "fx-1", targetClipId: "c1", effectId: "atmosphere", enabled: true, params: { template: "atmo:fog-band" } },
      { id: "fx-2", targetClipId: "c2", effectId: "grain", enabled: true, params: {} },
      { id: "fx-disabled", targetClipId: "c1", effectId: "shake", enabled: false, params: {} },
    ],
    ...overrides,
  };
}

describe("buildShotSpansFromRenderPlan", () => {
  it("按 layoutVisualTimeline 复算压缩时间轴:1s 转场把次镜前拉 1s", () => {
    const result = buildShotSpansFromRenderPlan(plan());
    expect(result).not.toBeNull();
    expect(result!.spans.map((span) => span.shotId)).toEqual(["sb-1", "sb-2"]);
    // clip1 120f,crossfade 1s=30f → clip2 from=90f=3s
    expect(result!.spans[0]).toMatchObject({ ordinal: 1, startS: 0, endS: 4 });
    expect(result!.spans[1]).toMatchObject({ ordinal: 2, startS: 3, endS: 6 });
    expect(result!.visualClipIds).toEqual(["c1", "c2"]);
    expect(result!.transitions).toHaveLength(1);
    expect(result!.effects).toEqual([
      { targetClipId: "c1", effectId: "atmosphere", template: "atmo:fog-band" },
      { targetClipId: "c2", effectId: "grain" },
    ]);
  });

  it("cut 转场与无转场不压缩", () => {
    const cutPlan = plan({ transitions: [{ fromClipId: "c1", toClipId: "c2", effectId: "cut", durationUs: 500_000 }] });
    expect(buildShotSpansFromRenderPlan(cutPlan)!.spans[1].startS).toBe(4);
    const noTransition = plan({ transitions: [] });
    expect(buildShotSpansFromRenderPlan(noTransition)!.spans[1].startS).toBe(4);
  });

  it("形状不完整 fail-closed 返回 null(缺 storyboardId/缺 clips/非对象)", () => {
    expect(buildShotSpansFromRenderPlan(null)).toBeNull();
    expect(buildShotSpansFromRenderPlan({})).toBeNull();
    const missingId = plan();
    (missingId.clips as Array<Record<string, unknown>>)[0] = { id: "c1", trackKind: "video", durationUs: 1, source: { kind: "storyboardVideo" } };
    expect(buildShotSpansFromRenderPlan(missingId)).toBeNull();
  });

  it("真实量级守护:43 镜 29.93s 重叠 → 压缩总长 ≈145s 而非 174.9s", () => {
    const clips = Array.from({ length: 43 }, (_, i) => ({
      id: `c${i + 1}`,
      trackKind: "video",
      startUs: i * 4_000_000,
      durationUs: 4_000_000,
      source: { kind: "storyboardVideo", evidence: { storyboardId: `sb-${i + 1}` } },
    }));
    const transitions = Array.from({ length: 42 }, (_, i) => ({
      fromClipId: `c${i + 1}`, toClipId: `c${i + 2}`, effectId: "crossfade", durationUs: 712_857, // 42×0.713s≈29.93s
    }));
    const result = buildShotSpansFromRenderPlan({ renderSettings: { fps: 30 }, clips, transitions });
    const total = result!.spans[42].endS;
    expect(total).toBeGreaterThan(140);
    expect(total).toBeLessThan(150);
  });
});
