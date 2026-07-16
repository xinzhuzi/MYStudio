import { describe, expect, it } from "vitest";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/constants";
import {
  DEFAULT_LOCAL_TTS_PROVIDER_ID,
  PROVIDER_INFO,
  createDefaultLocalTtsProvider,
  ensureDefaultLocalTtsProvider,
  isLocalTtsProvider,
  omitRecordKeys,
} from "./api-config-provider-helpers";

describe("api config provider helpers", () => {
  it("keeps the legacy provider service metadata stable", () => {
    expect(PROVIDER_INFO).toEqual({
      memefast: { name: "OpenAI 兼容服务", services: ["chat", "image", "video", "vision"] },
      runninghub: { name: "RunningHub", services: ["image", "vision"] },
      openai: { name: "OpenAI", services: [] },
      custom: { name: "Custom", services: [] },
    });
  });

  it("removes owned record keys without mutating the source", () => {
    const source = { kept: "one", removed: "two" };
    expect(omitRecordKeys(source, ["removed"])).toEqual({ kept: "one" });
    expect(source).toEqual({ kept: "one", removed: "two" });
  });

  it("prepends the default local TTS provider only when missing", () => {
    const remote = { ...createDefaultLocalTtsProvider(), id: "remote", platform: "custom" };
    const withDefault = ensureDefaultLocalTtsProvider([remote]);
    expect(withDefault[0].id).toBe(DEFAULT_LOCAL_TTS_PROVIDER_ID);
    expect(ensureDefaultLocalTtsProvider(withDefault)).toBe(withDefault);
  });

  it("recognizes the built-in and URL-compatible local TTS providers", () => {
    expect(isLocalTtsProvider(createDefaultLocalTtsProvider())).toBe(true);
    expect(isLocalTtsProvider({
      ...createDefaultLocalTtsProvider(),
      id: "compatible",
      platform: "tts-compatible",
      baseUrl: ` ${LOCAL_TTS_BASE_URL}/// `,
    })).toBe(true);
    expect(isLocalTtsProvider({
      ...createDefaultLocalTtsProvider(),
      id: "remote",
      platform: "tts-compatible",
      baseUrl: "https://tts.example.com/v1",
    })).toBe(false);
  });
});
