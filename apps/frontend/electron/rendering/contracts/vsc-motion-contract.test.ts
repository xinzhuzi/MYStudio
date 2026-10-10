// vscMotion 契约校验器测试(10-10 批B):recipe 闭集/params 键域/章级配额
// 三闸 fail-closed。渲染计划正门(validateTimelineRenderPlan)的接线断言在
// lib/studio/editing/validation.test.ts(复用其 validProject/validRenderPlan 夹具)。

import { describe, expect, it } from "vitest";
import { validateVscMotionEffects } from "./vsc-motion-contract";

function vscEffect(recipe: string, extra?: Record<string, unknown>) {
  return {
    id: `effect-shot-fx-vsc-${recipe}`,
    effectId: "vscMotion",
    targetClipId: "clip-1",
    startUs: 0,
    durationUs: 1_000_000,
    params: { recipe, ...(extra ?? {}) },
    enabled: true,
  };
}

describe("validateVscMotionEffects 契约三闸", () => {
  it("合法 vscMotion 效果通过(camera 五卡与 depth 两卡都可)", () => {
    const result = validateVscMotionEffects([
      vscEffect("vsc:dutch-roll-to-level"),
      vscEffect("vsc:parallax-glide"),
    ]);
    expect(result).toEqual({ success: true });
  });

  it("未知 recipe id fail-closed(recipe_unknown,不静默丢)", () => {
    const result = validateVscMotionEffects([vscEffect("vsc:bogus")]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.code).toBe("vsc.effect.recipe_unknown");
    expect(result.issues[0]?.path).toContain("recipe");
  });

  it("缺 recipe id → recipe_missing", () => {
    const result = validateVscMotionEffects([vscEffect("")]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.code).toBe("vsc.effect.recipe_missing");
  });

  it("params 白名单外键 fail-closed(param_unknown,D4 参数烧死不可调)", () => {
    const result = validateVscMotionEffects([
      vscEffect("vsc:dolly-zoom", { driveToScale: 3, motionParams: { zoomFrames: 8 } }),
    ]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "vsc.effect.param_unknown",
      "vsc.effect.param_unknown",
    ]);
  });

  it("章级配额超限 fail-closed:dolly 第 2 次 / crash 第 3 次拒", () => {
    const dollyTwice = validateVscMotionEffects([
      vscEffect("vsc:dolly-zoom"),
      { ...vscEffect("vsc:dolly-zoom"), targetClipId: "clip-2" },
    ]);
    expect(dollyTwice.success).toBe(false);
    if (dollyTwice.success) return;
    expect(dollyTwice.issues[0]?.code).toBe("vsc.effect.quota_exceeded");
    expect(dollyTwice.issues[0]?.message).toContain("至多 1 次");

    const crashTriple = validateVscMotionEffects([
      vscEffect("vsc:crash-zoom-punch"),
      { ...vscEffect("vsc:crash-zoom-punch"), targetClipId: "clip-2" },
      { ...vscEffect("vsc:crash-zoom-punch"), targetClipId: "clip-3" },
    ]);
    expect(crashTriple.success).toBe(false);
    if (crashTriple.success) return;
    expect(crashTriple.issues).toHaveLength(1); // 前 2 次合法,仅第 3 次报
    expect(crashTriple.issues[0]?.code).toBe("vsc.effect.quota_exceeded");
  });

  it("禁用条目不计数(配额只辖 enabled 效果);非 vscMotion 条目跳过", () => {
    const result = validateVscMotionEffects([
      vscEffect("vsc:dolly-zoom"),
      { ...vscEffect("vsc:dolly-zoom"), targetClipId: "clip-2", enabled: false },
      { effectId: "panZoom", enabled: true, params: { scaleFrom: 1 } },
    ]);
    expect(result).toEqual({ success: true });
  });

  it("undefined effects 直接过(旧计划零影响)", () => {
    expect(validateVscMotionEffects(undefined)).toEqual({ success: true });
  });
});
