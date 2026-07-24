import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITING_AUDIO_DUCKING,
  resolveEditingAudioDucking,
} from "./audio-policy";

describe("editing audio policy", () => {
  it("returns a mutable copy of the default ducking settings when no value is provided", () => {
    const resolved = resolveEditingAudioDucking();

    expect(resolved).toEqual(DEFAULT_EDITING_AUDIO_DUCKING);
    expect(resolved).not.toBe(DEFAULT_EDITING_AUDIO_DUCKING);
  });

  it("returns a shallow copy of caller-provided ducking settings", () => {
    const custom = { reductionDb: -8, attackUs: 10_000, releaseUs: 80_000 };

    const resolved = resolveEditingAudioDucking(custom);

    expect(resolved).toEqual(custom);
    expect(resolved).not.toBe(custom);
  });
});
