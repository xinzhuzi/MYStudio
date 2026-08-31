import { describe, expect, it } from "vitest";
import {
  audioModelCacheDir,
  music3ModelCacheDir,
  sfxModelCacheDir,
  ttsModelCacheDir,
} from "./model-dirs";

describe("model cache family layout", () => {
  const base = "/storage-base";

  it("keeps each runtime on its declared family root", () => {
    expect(ttsModelCacheDir(base)).toBe("/storage-base/model/TTS");
    expect(audioModelCacheDir(base)).toBe("/storage-base/model/audio");
    expect(sfxModelCacheDir(base)).toBe("/storage-base/model/sfx");
    expect(music3ModelCacheDir(base)).toBe("/storage-base/model/minimax");
  });

  it("does not route generation families through the TTS directory", () => {
    const tts = ttsModelCacheDir(base);
    expect(audioModelCacheDir(base)).not.toBe(tts);
    expect(sfxModelCacheDir(base)).not.toBe(audioModelCacheDir(base));
    expect(music3ModelCacheDir(base)).not.toBe(tts);
  });
});
