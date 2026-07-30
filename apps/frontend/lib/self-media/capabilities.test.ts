import { describe, expect, it } from "vitest";
import {
  getSelfMediaCapabilities,
  isSelfMediaLocalTransportPlatform,
  isSelfMediaPublishable,
  SELF_MEDIA_CAPABILITY_MANIFEST,
} from "./capabilities";
import type { SelfMediaPlatform } from "@/types/self-media";

const EXPECTED_PLATFORMS = [
  "tiktok",
  "douyin",
  "xhs",
  "wxSph",
  "KWAI",
  "youtube",
  "bilibili",
  "twitter",
  "wxGzh",
  "facebook",
  "instagram",
  "threads",
  "pinterest",
  "linkedin",
] as const satisfies readonly SelfMediaPlatform[];

describe("self-media capability manifest", () => {
  it("contains exactly the shared 14-platform contract", () => {
    expect(Object.keys(SELF_MEDIA_CAPABILITY_MANIFEST)).toEqual([...EXPECTED_PLATFORMS]);
  });

  it("resolves a local descriptor for every platform ID", () => {
    for (const platform of EXPECTED_PLATFORMS) {
      expect(getSelfMediaCapabilities("aitoearn-local", platform)).toMatchObject({
        providerId: "aitoearn-local",
        platform,
        displayName: expect.any(String),
      });
    }
  });

  it("preserves the four vendor-backed local capabilities", () => {
    expect(SELF_MEDIA_CAPABILITY_MANIFEST.douyin).toMatchObject({
      supportsVideo: true,
      supportsImageText: true,
      supportsScheduling: true,
      supportsCancellation: false,
    });
    expect(SELF_MEDIA_CAPABILITY_MANIFEST.xhs).toMatchObject({
      supportsVideo: true,
      supportsImageText: true,
      supportsScheduling: true,
      supportsCancellation: false,
    });
    expect(SELF_MEDIA_CAPABILITY_MANIFEST.wxSph).toMatchObject({
      supportsVideo: true,
      supportsImageText: false,
      supportsScheduling: true,
      supportsCancellation: false,
    });
    expect(SELF_MEDIA_CAPABILITY_MANIFEST.KWAI).toMatchObject({
      supportsVideo: true,
      supportsImageText: false,
      supportsScheduling: true,
      supportsCancellation: false,
    });
  });

  it("advertises publishing for all ten official platform transports", () => {
    for (const platform of ["tiktok", "youtube", "bilibili", "twitter", "wxGzh", "facebook", "instagram", "threads", "pinterest", "linkedin"] as const) {
      const capability = SELF_MEDIA_CAPABILITY_MANIFEST[platform];
      expect(capability.supportsVideo || capability.supportsImageText).toBe(true);
      expect(capability.supportsScheduling).toBe(true);
    }
  });

  it("keeps the local transport allowlist aligned with the 14-platform contract", () => {
    expect(EXPECTED_PLATFORMS.filter((platform) => isSelfMediaLocalTransportPlatform("aitoearn-local", platform))).toEqual([
      "tiktok",
      "douyin",
      "xhs",
      "wxSph",
      "KWAI",
      "youtube",
      "bilibili",
      "twitter",
      "wxGzh",
      "facebook",
      "instagram",
      "threads",
      "pinterest",
      "linkedin",
    ]);
    expect(isSelfMediaLocalTransportPlatform("aitoearn-local", "youtube")).toBe(true);
    expect(isSelfMediaLocalTransportPlatform("aitoearn-local", "douyin")).toBe(true);
  });

  it("only allows publish content types that have a local transport", () => {
    expect(isSelfMediaPublishable("aitoearn-local", "douyin", "video")).toBe(true);
    expect(isSelfMediaPublishable("aitoearn-local", "xhs", "image-text")).toBe(true);
    expect(isSelfMediaPublishable("aitoearn-local", "wxSph", "image-text")).toBe(false);
    expect(isSelfMediaPublishable("aitoearn-local", "youtube", "video")).toBe(true);
  });
});
