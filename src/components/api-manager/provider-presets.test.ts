import { describe, expect, it } from "vitest";
import { API_PROVIDER_PRESETS } from "./AddProviderDialog";

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
        "vidu",
        "custom",
      ]),
    );

    const allCopy = API_PROVIDER_PRESETS
      .flatMap((preset) => [preset.platform, preset.name, preset.description])
      .join("\n");

    expect(allCopy).not.toMatch(/memefast|漫影API|赞助|广告|推广|推荐/i);
  });
});
