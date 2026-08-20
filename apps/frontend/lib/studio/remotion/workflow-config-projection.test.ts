import { describe, expect, it } from "vitest";
import type { EditingRenderSettings } from "@/types/editing";
import { applyWorkflowConfigToRenderSettings } from "./workflow-config-projection";

const BASE: EditingRenderSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "h264",
  subtitleMode: "burn-in",
  loudnessLufs: -16,
  truePeakDbtp: -1.5,
};

describe("applyWorkflowConfigToRenderSettings", () => {
  it("config 缺省时原样返回（引用不变，幂等）", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, undefined)).toBe(BASE);
    expect(applyWorkflowConfigToRenderSettings(BASE, {})).toBe(BASE);
  });

  it("chapterGrade 注入且 blend 越界钳制到 [0,1]、非数值回落 0.5", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, { chapterGrade: { lutId: "cn-zhusha", blend: 2 } }).chapterGrade)
      .toEqual({ lutId: "cn-zhusha", blend: 1 });
    expect(applyWorkflowConfigToRenderSettings(BASE, { chapterGrade: { lutId: "cn-zhusha", blend: -1 } }).chapterGrade)
      .toEqual({ lutId: "cn-zhusha", blend: 0 });
    expect(applyWorkflowConfigToRenderSettings(BASE, { chapterGrade: { lutId: "cn-zhusha", blend: Number.NaN } }).chapterGrade)
      .toEqual({ lutId: "cn-zhusha", blend: 0.5 });
  });

  it("chapterGrade.lutId 非字符串时整段跳过", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, { chapterGrade: { lutId: 42 } }).chapterGrade).toBeUndefined();
  });

  it("subtitleSfxEnabled 仅接受布尔", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, { subtitleSfxEnabled: true }).subtitleSfxEnabled).toBe(true);
    expect(applyWorkflowConfigToRenderSettings(BASE, { subtitleSfxEnabled: "true" }).subtitleSfxEnabled).toBeUndefined();
  });

  it("atmosphereMode 仅接受 off/ai", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, { atmosphereMode: "off" }).atmosphereMode).toBe("off");
    expect(applyWorkflowConfigToRenderSettings(BASE, { atmosphereMode: "bogus" }).atmosphereMode).toBeUndefined();
  });

  it("08-20 回归：subtitleFont 覆盖 editing 工程冻结旧值（设置页选择进 plan）", () => {
    const frozen = { ...BASE, subtitleFont: "ma-shan-zheng" };
    expect(applyWorkflowConfigToRenderSettings(frozen, { subtitleFont: "liu-jian-mao-cao" }).subtitleFont)
      .toBe("liu-jian-mao-cao");
  });

  it("subtitleFont 自定义字体（custom:*）放行，白名单外/非字符串跳过", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, { subtitleFont: "custom:abc123" }).subtitleFont).toBe("custom:abc123");
    expect(applyWorkflowConfigToRenderSettings(BASE, { subtitleFont: "no-such-font" }).subtitleFont).toBeUndefined();
    expect(applyWorkflowConfigToRenderSettings(BASE, { subtitleFont: 123 }).subtitleFont).toBeUndefined();
  });
});
