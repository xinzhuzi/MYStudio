import { describe, expect, it } from "vitest";
import { VideoCache as FacadeVideoCache, videoCache as facadeSingleton } from "./video-cache";
import {
  VideoCache as CanonicalVideoCache,
  videoCache as canonicalSingleton,
} from "./media/video-cache";

describe("video-cache root facade", () => {
  it("re-exports the same VideoCache class and singleton instance", () => {
    expect(FacadeVideoCache).toBe(CanonicalVideoCache);
    expect(facadeSingleton).toBe(canonicalSingleton);
    expect(facadeSingleton).toBeInstanceOf(CanonicalVideoCache);
  });
});
