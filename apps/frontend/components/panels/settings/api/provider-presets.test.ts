import { describe, expect, it } from "vitest";
import { API_PROVIDER_PRESETS } from "./AddProviderDialog";
import { LOCAL_TTS_BASE_URL } from "@/lib/tts/client";

describe("API provider presets", () => {
  it("offers Toonflow-style neutral provider templates without promotional defaults", () => {
    expect(API_PROVIDER_PRESETS.map((preset) => preset.platform)).toEqual(
      expect.arrayContaining([
        "openai-compatible",
        "anthropic-compatible",
        "gemini-compatible",
        "openai",
        "deepseek",
        "volcengine",
        "klingai",
        "minimax",
        "tts-compatible",
        "vidu",
        "custom",
      ]),
    );

    const allCopy = API_PROVIDER_PRESETS
      .flatMap((preset) => [preset.platform, preset.name, preset.description])
      .join("\n");

    expect(allCopy).not.toMatch(/memefast|漫影API|赞助|广告|推广|推荐/i);
  });

  it("prefills the TTS backend with the local URL while allowing external keys", () => {
    const preset = API_PROVIDER_PRESETS.find((item) => item.platform === "tts-compatible");

    expect(preset).toMatchObject({
      name: "TTS 后端",
      baseUrl: LOCAL_TTS_BASE_URL,
      apiKeyOptional: true,
      capabilities: ["tts"],
    });
    expect(preset?.models).toEqual(expect.arrayContaining([
      "qwen-tts-0.6B",
      "kokoro",
      "tada-1b",
    ]));
    expect(preset?.models).toEqual(expect.arrayContaining(["tts-1", "gpt-4o-mini-tts"]));
  });

  it("pins compatible provider presets to their runtime protocol", () => {
    expect(API_PROVIDER_PRESETS.find((item) => item.platform === "openai-compatible")?.apiProtocol)
      .toBe("openai-compatible");
    expect(API_PROVIDER_PRESETS.find((item) => item.platform === "anthropic-compatible")?.apiProtocol)
      .toBe("anthropic-compatible");
    expect(API_PROVIDER_PRESETS.find((item) => item.platform === "gemini-compatible")?.apiProtocol)
      .toBe("gemini-compatible");
  });
});
