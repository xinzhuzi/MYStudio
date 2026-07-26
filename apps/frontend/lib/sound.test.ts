import { describe, expect, it } from "vitest";
import {
  initSound as facadeInit,
  playSound as facadePlay,
  setSoundMuted as facadeMute,
  type SoundEffect as FacadeEffect,
} from "./sound";
import {
  initSound as canonicalInit,
  playSound as canonicalPlay,
  setSoundMuted as canonicalMute,
  type SoundEffect as CanonicalEffect,
} from "./sound/sound";

describe("sound root facade", () => {
  it("re-exports the same sound helpers as the sound domain module", () => {
    expect(facadeInit).toBe(canonicalInit);
    expect(facadePlay).toBe(canonicalPlay);
    expect(facadeMute).toBe(canonicalMute);
  });

  it("keeps SoundEffect available through the facade type export", () => {
    type _Check = FacadeEffect extends CanonicalEffect ? (CanonicalEffect extends FacadeEffect ? true : false) : false;
    const ok: _Check = true;
    expect(ok).toBe(true);
  });
});
