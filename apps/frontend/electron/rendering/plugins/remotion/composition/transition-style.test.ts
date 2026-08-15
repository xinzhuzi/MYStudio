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

  it("flash peaks at a softened 0.75 instead of full white", () => {
    expect(transitionStyleAtFrame("flash", 5, 11)).toEqual({
      incomingOpacity: 0,
      overlayColor: "#ffffff",
      overlayOpacity: 0.75,
    });
  });

  it("crossfade eases with smoothstep (quarter point stays below linear)", () => {
    expect(transitionStyleAtFrame("crossfade", 2, 11).incomingOpacity).toBeCloseTo(0.104, 3);
    expect(transitionStyleAtFrame("crossfade", 5, 11).incomingOpacity).toBe(0.5);
    expect(transitionStyleAtFrame("crossfade", 8, 11).incomingOpacity).toBeCloseTo(0.896, 3);
  });

  it("clamps frames to the transition range", () => {
    expect(transitionStyleAtFrame("crossfade", -10, 11).incomingOpacity).toBe(0);
    expect(transitionStyleAtFrame("crossfade", 100, 11).incomingOpacity).toBe(1);
  });

  it("blackout holds a near-black plateau while fade peaks a single frame (S3 R3 差异化)", () => {
    const framesOf = (effectId: "fade" | "blackout", duration: number) =>
      Array.from({ length: duration }, (_, frame) => transitionStyleAtFrame(effectId, frame, duration).overlayOpacity);
    const fade = framesOf("fade", 24);
    const blackout = framesOf("blackout", 24);
    // fade 对称三角：只有正中一帧到达 1
    expect(fade.filter((opacity) => opacity >= 0.99)).toHaveLength(1);
    // blackout 梯形：保持段（round(0.15*24)=4 帧）加下降沿首帧 ≥0.99，且在保持段之后才切换入镜
    const nearBlack = blackout.map((opacity, frame) => ({ opacity, frame })).filter((entry) => entry.opacity >= 0.99);
    expect(nearBlack.length).toBeGreaterThanOrEqual(4);
    const consecutive = nearBlack.every((entry, index) => index === 0 || entry.frame === nearBlack[index - 1]!.frame + 1);
    expect(consecutive).toBe(true);
    const holdEnd = Math.floor((24 - Math.min(Math.round(0.15 * 24), 22)) / 2) + Math.min(Math.round(0.15 * 24), 22);
    expect(transitionStyleAtFrame("blackout", holdEnd - 1, 24).incomingOpacity).toBe(0);
    expect(transitionStyleAtFrame("blackout", holdEnd, 24).incomingOpacity).toBe(1);
    // 退化时长（<3 帧）blackout 退回 fade 行为
    expect(transitionStyleAtFrame("blackout", 0, 2)).toEqual(transitionStyleAtFrame("fade", 0, 2));
  });
});
