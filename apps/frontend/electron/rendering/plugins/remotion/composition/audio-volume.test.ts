import { describe, expect, it } from "vitest";
import { audioVolumeAtFrame, type AudioVolumeInput } from "./audio-volume";

describe("audioVolumeAtFrame", () => {
  it("returns the static volume when there is no fade or envelope", () => {
    const input: AudioVolumeInput = { volume: 0.8, durationInFrames: 60 };
    expect(audioVolumeAtFrame(0, input)).toBeCloseTo(0.8);
    expect(audioVolumeAtFrame(30, input)).toBeCloseTo(0.8);
    expect(audioVolumeAtFrame(59, input)).toBeCloseTo(0.8);
  });

  it("ramps linearly over a fade in", () => {
    const input: AudioVolumeInput = {
      volume: 1,
      durationInFrames: 60,
      fade: { fadeInFrames: 10, fadeOutFrames: 0 },
    };
    expect(audioVolumeAtFrame(0, input)).toBeCloseTo(0);
    expect(audioVolumeAtFrame(5, input)).toBeCloseTo(0.5);
    expect(audioVolumeAtFrame(10, input)).toBeCloseTo(1);
    expect(audioVolumeAtFrame(30, input)).toBeCloseTo(1);
  });

  it("ramps linearly down over a fade out", () => {
    const input: AudioVolumeInput = {
      volume: 1,
      durationInFrames: 60,
      fade: { fadeInFrames: 0, fadeOutFrames: 10 },
    };
    // fade-out starts at frame 50; frame 55 is halfway.
    expect(audioVolumeAtFrame(50, input)).toBeCloseTo(1);
    expect(audioVolumeAtFrame(55, input)).toBeCloseTo(0.5);
    expect(audioVolumeAtFrame(60, input)).toBeCloseTo(0);
  });

  it("multiplies clip volume, fade, user envelope and ducking envelope together", () => {
    const input: AudioVolumeInput = {
      volume: 0.5,
      durationInFrames: 60,
      fade: { fadeInFrames: 10, fadeOutFrames: 0 },
      envelope: [
        { frame: 0, gain: 1 },
        { frame: 60, gain: 0.2 },
      ],
      duckingEnvelope: [
        { frame: 0, gain: 1 },
        { frame: 10, gain: 0.25 },
      ],
    };
    // frame 5: volume * fade * user envelope * ducking envelope.
    const envAt5 = 1 + (0.2 - 1) * (5 / 60);
    const duckAt5 = 1 + (0.25 - 1) * (5 / 10);
    expect(audioVolumeAtFrame(5, input)).toBeCloseTo(0.5 * 0.5 * envAt5 * duckAt5);
  });

  it("holds envelope endpoints outside the point range", () => {
    const input: AudioVolumeInput = {
      volume: 1,
      durationInFrames: 60,
      envelope: [
        { frame: 10, gain: 0.4 },
        { frame: 20, gain: 0.9 },
      ],
    };
    expect(audioVolumeAtFrame(0, input)).toBeCloseTo(0.4);
    expect(audioVolumeAtFrame(15, input)).toBeCloseTo(0.65);
    expect(audioVolumeAtFrame(59, input)).toBeCloseTo(0.9);
  });

  it("rejects a negative or non-finite volume", () => {
    expect(() => audioVolumeAtFrame(0, { volume: -1, durationInFrames: 60 }))
      .toThrow("音频音量必须是非负有限数值");
    expect(() => audioVolumeAtFrame(0, { volume: Number.NaN, durationInFrames: 60 }))
      .toThrow("音频音量必须是非负有限数值");
  });
});
