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

  it("10-10 批D:chapterOpening 注入(非空 wordmark;可选 kicker,空白 kicker 剥离)", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, {
      chapterOpening: { wordmark: "道劫", kicker: "第一卷 · 风起云涌" },
    }).chapterOpening).toEqual({ wordmark: "道劫", kicker: "第一卷 · 风起云涌" });
    expect(applyWorkflowConfigToRenderSettings(BASE, {
      chapterOpening: { wordmark: "道劫", kicker: "   " },
    }).chapterOpening).toEqual({ wordmark: "道劫" });
  });

  it("10-10 批D:chapterOpening 空文案/非字符串=不注入(默认关,fail-open 到 plan 原值)", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, { chapterOpening: { wordmark: "" } }).chapterOpening).toBeUndefined();
    expect(applyWorkflowConfigToRenderSettings(BASE, { chapterOpening: { wordmark: "   " } }).chapterOpening).toBeUndefined();
    expect(applyWorkflowConfigToRenderSettings(BASE, { chapterOpening: { wordmark: 42 } }).chapterOpening).toBeUndefined();
  });

  it("10-10 批D:chapterOutro 注入(tagline+shortMark 双非空才注入;任一空=不注入)", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, {
      chapterOutro: { tagline: "{ 道劫 · 本章完 }", shortMark: "道劫" },
    }).chapterOutro).toEqual({ tagline: "{ 道劫 · 本章完 }", shortMark: "道劫" });
    expect(applyWorkflowConfigToRenderSettings(BASE, {
      chapterOutro: { tagline: "", shortMark: "道劫" },
    }).chapterOutro).toBeUndefined();
    expect(applyWorkflowConfigToRenderSettings(BASE, {
      chapterOutro: { tagline: "x", shortMark: " " },
    }).chapterOutro).toBeUndefined();
    expect(applyWorkflowConfigToRenderSettings(BASE, {
      chapterOutro: { shortMark: "道劫" } as never,
    }).chapterOutro).toBeUndefined();
  });

  it("10-10 批D:beatSnapEnabled 仅布尔注入(默认关=缺省不注入)", () => {
    expect(applyWorkflowConfigToRenderSettings(BASE, { beatSnapEnabled: true }).beatSnapEnabled).toBe(true);
    expect(applyWorkflowConfigToRenderSettings(BASE, { beatSnapEnabled: false }).beatSnapEnabled).toBe(false);
    expect(applyWorkflowConfigToRenderSettings(BASE, { beatSnapEnabled: "true" }).beatSnapEnabled).toBeUndefined();
    expect(applyWorkflowConfigToRenderSettings(BASE, {}).beatSnapEnabled).toBeUndefined();
  });
});
