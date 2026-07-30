import { describe, expect, it } from "vitest";
import { loadOfficialPlatformConfig, OFFICIAL_PLATFORM_IDS } from "./platform-config";

describe("official platform main-process configuration", () => {
  it("covers exactly the ten platforms without a vendor Electron transport", () => {
    expect(OFFICIAL_PLATFORM_IDS).toEqual([
      "tiktok", "youtube", "bilibili", "twitter", "wxGzh",
      "facebook", "instagram", "threads", "pinterest", "linkedin",
    ]);
  });

  it("loads credentials from the main-process environment only", () => {
    expect(loadOfficialPlatformConfig("twitter", {
      MYSTUDIO_SELF_MEDIA_TWITTER_CLIENT_ID: "client-1",
      MYSTUDIO_SELF_MEDIA_TWITTER_CLIENT_SECRET: "secret-1",
      MYSTUDIO_SELF_MEDIA_TWITTER_REDIRECT_URI: "https://localhost/mystudio/oauth/twitter",
      MYSTUDIO_SELF_MEDIA_TWITTER_SCOPES: "tweet.read tweet.write,users.read",
    })).toEqual({
      platformId: "twitter",
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://localhost/mystudio/oauth/twitter",
      scopes: ["tweet.read", "tweet.write", "users.read"],
    });
  });

  it("fails closed when required config is missing or the callback is unsafe", () => {
    expect(loadOfficialPlatformConfig("youtube", {})).toBeNull();
    expect(loadOfficialPlatformConfig("youtube", {
      MYSTUDIO_SELF_MEDIA_YOUTUBE_CLIENT_ID: "client-1",
      MYSTUDIO_SELF_MEDIA_YOUTUBE_REDIRECT_URI: "http://example.com/callback",
    })).toBeNull();
  });

  it("uses reviewed default scopes and requires client secrets where the official contract does", () => {
    expect(loadOfficialPlatformConfig("tiktok", {
      MYSTUDIO_SELF_MEDIA_TIKTOK_CLIENT_ID: "client-1",
      MYSTUDIO_SELF_MEDIA_TIKTOK_CLIENT_SECRET: "secret-1",
      MYSTUDIO_SELF_MEDIA_TIKTOK_REDIRECT_URI: "https://localhost/oauth/tiktok",
    })?.scopes).toEqual(["user.info.basic", "video.publish", "video.upload"]);
    expect(loadOfficialPlatformConfig("tiktok", {
      MYSTUDIO_SELF_MEDIA_TIKTOK_CLIENT_ID: "client-1",
      MYSTUDIO_SELF_MEDIA_TIKTOK_REDIRECT_URI: "https://localhost/oauth/tiktok",
    })).toBeNull();
    expect(loadOfficialPlatformConfig("wxGzh", {
      MYSTUDIO_SELF_MEDIA_WECHAT_OFFICIAL_CLIENT_ID: "app-1",
      MYSTUDIO_SELF_MEDIA_WECHAT_OFFICIAL_CLIENT_SECRET: "secret-1",
    })).toMatchObject({
      platformId: "wxGzh",
      redirectUri: "http://127.0.0.1/self-media/wechat-official",
    });
  });
});
