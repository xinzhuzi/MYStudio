import { describe, expect, it } from "vitest";
import {
  LEGACY_PEAK,
  SOUND_PROFILES,
  SUCCESS_TAIL_PROFILE,
  ACTIVATE_TAIL_PROFILE,
  voicePeak,
  type SoundEffect,
  type VoiceProfile,
} from "./sound";

const EFFECTS: SoundEffect[] = ["activate", "click", "success", "cancel", "slide"];
const ALL_PROFILES: VoiceProfile[] = [
  ...EFFECTS.map((e) => SOUND_PROFILES[e]),
  SUCCESS_TAIL_PROFILE,
  ACTIVATE_TAIL_PROFILE,
];

describe("sound profiles", () => {
  it("defines a voice for every effect", () => {
    for (const effect of EFFECTS) {
      expect(SOUND_PROFILES[effect]).toBeDefined();
    }
  });

  it("keeps every voice at or under a quarter of the legacy metallic peak", () => {
    for (const profile of ALL_PROFILES) {
      expect(voicePeak(profile)).toBeLessThanOrEqual(LEGACY_PEAK * 0.25);
    }
  });

  it("puts the weight in the low end instead of a high resonant ring", () => {
    for (const profile of ALL_PROFILES) {
      // body 落在低频，不是旧版的 900–1200Hz 谐振
      expect(profile.bodyFreq).toBeLessThan(300);
      // 高频微光必须远小于 body，否则又会刺耳
      expect(profile.sparkleLevel).toBeLessThan(profile.bodyLevel / 2);
      // 总低通压住金属泛音
      expect(profile.lowpass).toBeLessThanOrEqual(1600);
    }
  });

  it("gives the primary press an audible air tail and a fast attack", () => {
    const activate = SOUND_PROFILES.activate;
    expect(activate.airLevel).toBeGreaterThan(0);
    expect(activate.airDecay).toBeGreaterThanOrEqual(0.15);
    expect(activate.attack).toBeLessThanOrEqual(0.01);
  });

  it("makes cancel sink and slide rise", () => {
    expect(SOUND_PROFILES.cancel.bodyDrop).toBeLessThan(1);
    expect(SOUND_PROFILES.cancel.airDecay).toBeGreaterThan(SOUND_PROFILES.activate.airDecay);
    expect(SOUND_PROFILES.slide.bodyDrop).toBeGreaterThan(1);
  });
});
