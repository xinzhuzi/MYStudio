import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAssetRegenerationPrompt,
  getAssetDisplayName,
  getAssetSpokenText,
} from "./StudioAssetDetailDialog";
import type { StudioAssetSummary } from "@/types/studio-assets";

describe("buildAssetRegenerationPrompt", () => {
  it("combines prompt, setting, and description for regenerating an asset image", () => {
    const asset: StudioAssetSummary = {
      id: "asset-1",
      source: "toonflow-runtime",
      type: "role",
      name: "主角",
      prompt: "水墨修仙少年，玄色长衣",
      setting: "道劫主角，三族灵气缠身",
      description: "冷峻、克制、背负旧债",
    };

    expect(buildAssetRegenerationPrompt(asset)).toBe([
      "水墨修仙少年，玄色长衣",
      "道劫主角，三族灵气缠身",
      "冷峻、克制、背负旧债",
    ].join("\n\n"));
  });

  it("skips empty fields instead of inserting blank sections", () => {
    const asset: StudioAssetSummary = {
      id: "asset-2",
      source: "manying-local",
      type: "scene",
      name: "山门",
      setting: "云雾山门，残碑与剑痕",
    };

    expect(buildAssetRegenerationPrompt(asset)).toBe("云雾山门，残碑与剑痕");
  });

  it("uses the audio file name as a clean visible title", () => {
    const asset: StudioAssetSummary = {
      id: "asset-audio-1",
      source: "manying-local",
      type: "audio",
      name: "/Users/zhengbingjin/Documents/音频/800+音色合集/少年旁白_穿过雨夜.wav",
      filePath: "/project/assets/audio/少年旁白_穿过雨夜.wav",
    };

    expect(getAssetDisplayName(asset)).toBe("少年旁白_穿过雨夜");
    expect(getAssetSpokenText(asset)).toBe("少年旁白 穿过雨夜");
  });

  it("keeps a real spoken description ahead of the file path", () => {
    const asset: StudioAssetSummary = {
      id: "asset-audio-2",
      source: "manying-local",
      type: "audio",
      name: "女声试音.mp3",
      description: "你终于回来了，风雪已经等了你三年。",
    };

    expect(getAssetSpokenText(asset)).toBe("你终于回来了，风雪已经等了你三年。");
  });

  it("loads full asset data from an effect instead of mutating state during render", () => {
    const source = readFileSync(new URL("./StudioAssetDetailDialog.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("if (asset && asset.id !== prevAssetId.current)");
    expect(source).toContain("useEffect(() =>");
  });
});
