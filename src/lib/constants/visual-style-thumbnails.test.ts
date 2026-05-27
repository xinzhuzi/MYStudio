import { describe, expect, it } from "vitest";
import { VISUAL_STYLE_PRESETS } from "./visual-styles";
import { getStyleThumbnailSource } from "./visual-style-thumbnails";

describe("visual style thumbnails", () => {
  it("resolves every built-in style to a bundled thumbnail source", () => {
    const resolved = VISUAL_STYLE_PRESETS.map((style) => ({
      id: style.id,
      source: getStyleThumbnailSource(style),
    }));

    expect(resolved).toHaveLength(VISUAL_STYLE_PRESETS.length);
    expect(resolved.every((item) => item.source.length > 0)).toBe(true);
    expect(new Set(resolved.map((item) => item.source)).size).toBeGreaterThan(1);
  });
});
