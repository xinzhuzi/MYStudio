import { describe, expect, it } from "vitest";
import { looksLikeAudioPathText, normalizeReferenceText } from "./reference-text";

describe("reference text normalization", () => {
  it("keeps trimmed spoken text", () => {
    expect(normalizeReferenceText("  我会走到最后。  ")).toBe("我会走到最后。");
  });

  it("drops empty labels and path-like audio labels", () => {
    expect(normalizeReferenceText("   ")).toBeUndefined();
    expect(normalizeReferenceText("/voices/hero.wav")).toBeUndefined();
    expect(normalizeReferenceText("C:\\voices\\hero.mp3")).toBeUndefined();
    expect(normalizeReferenceText("hero.OPUS")).toBeUndefined();
  });

  it("classifies Unix, Windows, and audio-extension labels as path-like", () => {
    expect(looksLikeAudioPathText("/voices/hero.wav")).toBe(true);
    expect(looksLikeAudioPathText("C:\\voices\\hero.wav")).toBe(true);
    expect(looksLikeAudioPathText("hero.flac")).toBe(true);
    expect(looksLikeAudioPathText("这一夜，雨没有停。")).toBe(false);
  });
});
