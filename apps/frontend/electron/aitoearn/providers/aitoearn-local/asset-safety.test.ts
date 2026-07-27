import { describe, expect, it } from "vitest";
import { parseSafeRemoteAssetUrl, resolveSafeLocalAssetPath } from "./asset-safety";

describe("aitoearn local asset safety", () => {
  it("keeps absolute paths inside configured storage roots", () => {
    expect(resolveSafeLocalAssetPath("/data/media/video.mp4", ["/data/media"])).toBe("/data/media/video.mp4");
    expect(resolveSafeLocalAssetPath("/data/media/../secrets.txt", ["/data/media"])).toBeNull();
    expect(resolveSafeLocalAssetPath("/tmp/video.mp4", ["/data/media"])).toBeNull();
  });

  it("accepts HTTPS remote assets and rejects HTTP or malformed URLs", () => {
    expect(parseSafeRemoteAssetUrl("https://cdn.example.test/video.mp4")?.protocol).toBe("https:");
    expect(parseSafeRemoteAssetUrl("http://cdn.example.test/video.mp4")).toBeNull();
    expect(parseSafeRemoteAssetUrl("https://")).toBeNull();
  });
});
