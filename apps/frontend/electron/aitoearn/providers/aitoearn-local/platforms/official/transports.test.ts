import { describe, expect, it, vi } from "vitest";
import { createOfficialPlatformTransports } from "./transports";

describe("official platform transport wiring", () => {
  it("creates transports only for platforms whose production config is complete", () => {
    const result = createOfficialPlatformTransports({
      userDataPath: "/tmp/mystudio-official-platform-test",
      env: {
        MYSTUDIO_SELF_MEDIA_TWITTER_CLIENT_ID: "twitter-client",
        MYSTUDIO_SELF_MEDIA_TWITTER_REDIRECT_URI: "https://localhost/oauth/twitter",
        MYSTUDIO_SELF_MEDIA_TIKTOK_CLIENT_ID: "tiktok-client",
        MYSTUDIO_SELF_MEDIA_TIKTOK_REDIRECT_URI: "https://localhost/oauth/tiktok",
      },
      fetch: vi.fn() as unknown as typeof fetch,
      authorize: vi.fn(),
    });
    expect(result.configuredPlatforms).toEqual(["twitter"]);
    expect(Object.keys(result.transports)).toEqual(["twitter"]);
  });
});
