import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioAssetCard } from "./StudioAssetCard";
import type { StudioAssetSummary } from "@/types/studio-assets";

describe("StudioAssetCard", () => {
  it("uses the default audio cover instead of rendering a thumbnail image", () => {
    const asset: StudioAssetSummary = {
      id: "voice-1",
      source: "manying-local",
      type: "audio",
      name: "/Users/zhengbingjin/Documents/音频/800+音色合集/少年旁白_穿过雨夜.wav",
      thumbnailUrl: "file:///missing/audio-cover.png",
    };

    const html = renderToStaticMarkup(<StudioAssetCard asset={asset} />);

    expect(html).not.toContain("<img");
    expect(html).toContain("音频素材");
    expect(html).toContain("少年旁白_穿过雨夜");
    expect(html).toContain("studio-audio-waveform");
  });
});
