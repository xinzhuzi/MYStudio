import { describe, expect, it } from "vitest";
import { transitionStyleAtFrame } from "./transition-style";

describe("transitionStyleAtFrame", () => {
  it("keeps a cut fully visible without an overlay", () => {
    expect(transitionStyleAtFrame("cut", 0, 0)).toEqual({
      incomingOpacity: 1,
      overlayOpacity: 0,
    });
  });

  it("crossfades the incoming clip across the overlap", () => {
    expect(transitionStyleAtFrame("crossfade", 0, 11).incomingOpacity).toBe(0);
    expect(transitionStyleAtFrame("crossfade", 5, 11).incomingOpacity).toBe(0.5);
    expect(transitionStyleAtFrame("crossfade", 10, 11).incomingOpacity).toBe(1);
  });

  it.each([
    ["fade", "#000000"],
    ["blackout", "#000000"],
    ["flash", "#ffffff"],
  ] as const)("%s hides the clip switch at the color midpoint", (effectId, color) => {
    expect(transitionStyleAtFrame(effectId, 0, 11)).toEqual({
      incomingOpacity: 0,
      overlayColor: color,
      overlayOpacity: 0,
    });
    expect(transitionStyleAtFrame(effectId, 5, 11)).toEqual({
      incomingOpacity: 0,
      overlayColor: color,
      overlayOpacity: 1,
    });
    expect(transitionStyleAtFrame(effectId, 10, 11)).toEqual({
      incomingOpacity: 1,
      overlayColor: color,
      overlayOpacity: 0,
    });
  });

  it("clamps frames to the transition range", () => {
    expect(transitionStyleAtFrame("crossfade", -10, 11).incomingOpacity).toBe(0);
    expect(transitionStyleAtFrame("crossfade", 100, 11).incomingOpacity).toBe(1);
  });
});
