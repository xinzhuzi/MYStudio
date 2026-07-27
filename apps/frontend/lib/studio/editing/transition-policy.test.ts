import { describe, expect, it } from "vitest";
import {
  explicitTransitionDuration,
  explicitTransitionEffect,
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
    expect(transitionParams("crossfade")).toEqual({ curve: "linear" });
    expect(transitionParams("flash")).toEqual({ intensity: 0.8 });
    expect(transitionParams("blackout")).toEqual({ hold: 0.15 });
    expect(transitionParams("cut")).toEqual({});
    expect(transitionParams("fade")).not.toBe(transitionParams("fade"));
  });
});
