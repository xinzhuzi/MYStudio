import { describe, expect, it } from "vitest";
import {
  clampTransitionDurationUs,
  explicitTransitionDuration,
  explicitTransitionEffect,
  styleWordTransition,
  transitionParams,
} from "./transition-policy";

describe("transition policy", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["自然切换", null],
    ["场尾黑场", "blackout"],
    ["闪白后叠化", "flash"],
    ["交叉淡化", "crossfade"],
    ["cross FADE", "crossfade"],
    ["淡出", "fade"],
    ["slow fade", "fade"],
  ] as const)("maps %s to %s", (hint, expected) => {
    expect(explicitTransitionEffect(hint)).toBe(expected);
  });

  it("keeps explicit effect priority stable when hints conflict", () => {
    expect(explicitTransitionEffect("淡出后闪白，再黑场")).toBe("blackout");
  });

  it("floors ratio duration, enforces the minimum boundary, and caps the preset", () => {
    const preset = { maxTransitionUs: 350_000, maxTransitionRatio: 0.15 };
    expect(explicitTransitionDuration({ durationUs: 10_000_000 }, { durationUs: 5_000_000 }, preset)).toBe(350_000);
    expect(explicitTransitionDuration({ durationUs: 10 }, { durationUs: 10 }, preset)).toBe(1);
    expect(explicitTransitionDuration({ durationUs: 6 }, { durationUs: 6 }, preset)).toBe(0);
  });

  it("returns the canonical params for every transition effect", () => {
    expect(transitionParams("fade")).toEqual({ opacity: 1 });
    expect(transitionParams("crossfade")).toEqual({ curve: "ease-in-out" });
    expect(transitionParams("flash")).toEqual({ intensity: 0.55 });
    expect(transitionParams("blackout")).toEqual({ hold: 0.15 });
    expect(transitionParams("cut")).toEqual({});
    expect(transitionParams("fade")).not.toBe(transitionParams("fade"));
  });
});

describe("style word transitions (director ⑥ structured vocabulary)", () => {
  it.each([
    ["水墨晕染", "crossfade", 1_000_000],
    ["灵气色彩", "crossfade", 800_000],
    ["境界跃迁", "flash", 500_000],
    ["四季流转", "fade", 800_000],
    ["剑痕", "flash", 300_000],
    ["血祭", "blackout", 800_000],
    ["梦境", "fade", 1_000_000],
    ["前世", "fade", 1_000_000],
    ["空镜呼吸", "fade", 1_000_000],
  ] as const)("maps %s to %s @ %dµs", (word, effectId, durationUs) => {
    expect(styleWordTransition(word)).toEqual({ styleWord: word === "前世" ? "梦境" : word, effectId, durationUs });
  });

  it("same-scene hard cut and unknown words produce no transition", () => {
    expect(styleWordTransition("同场景硬切")).toBeNull();
    expect(styleWordTransition("随便什么词")).toBeNull();
    expect(styleWordTransition(undefined)).toBeNull();
    expect(styleWordTransition("  ")).toBeNull();
  });

  it("clamps duration between 200ms and min(neighbor/2, 1.2s)", () => {
    // 常规:请求值在界内,原样返回
    expect(clampTransitionDurationUs(800_000, [4_000_000, 3_000_000])).toBe(800_000);
    // 上限:请求超过 1.2s 上限
    expect(clampTransitionDurationUs(2_000_000, [4_000_000, 3_000_000])).toBe(1_200_000);
    // 邻居约束:较短邻居 900ms 的一半 = 450ms 封顶
    expect(clampTransitionDurationUs(600_000, [4_000_000, 900_000])).toBe(450_000);
    // 下限:请求过短抬到 200ms
    expect(clampTransitionDurationUs(50_000, [4_000_000, 3_000_000])).toBe(200_000);
    // 极短邻居(300ms,半长 150ms<下限):保底下限,不产生超过邻居的转场异常
    expect(clampTransitionDurationUs(700_000, [300_000, 4_000_000])).toBe(200_000);
  });
});
