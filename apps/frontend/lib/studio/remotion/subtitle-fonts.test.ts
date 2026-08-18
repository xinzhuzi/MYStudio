import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBTITLE_FONT_ID,
  SUBTITLE_FONT_IDS,
  SUBTITLE_FONT_STYLES,
  isSubtitleFontId,
  resolveSubtitleFontStyle,
} from "./subtitle-fonts";

describe("subtitle font registry", () => {
  it("defaults to the brush kaishu font", () => {
    expect(DEFAULT_SUBTITLE_FONT_ID).toBe("ma-shan-zheng");
    expect(SUBTITLE_FONT_IDS).toContain(DEFAULT_SUBTITLE_FONT_ID);
  });

  it("resolves known ids to their registered style", () => {
    const style = resolveSubtitleFontStyle("noto-sans-sc");
    expect(style.fontFamily).toContain("'Noto Sans SC'");
    expect(style.fontWeight).toBe(900);
  });

  it("falls back to the default font for unknown or missing ids", () => {
    expect(resolveSubtitleFontStyle(undefined).fontFamily)
      .toBe(SUBTITLE_FONT_STYLES[DEFAULT_SUBTITLE_FONT_ID].fontFamily);
    expect(resolveSubtitleFontStyle("bogus").fontFamily)
      .toBe(SUBTITLE_FONT_STYLES[DEFAULT_SUBTITLE_FONT_ID].fontFamily);
  });

  it("keeps the brush font at single weight (synthetic bold smears brush strokes)", () => {
    expect(SUBTITLE_FONT_STYLES["ma-shan-zheng"].fontWeight).toBe(400);
  });

  it("guards the id whitelist", () => {
    expect(isSubtitleFontId("noto-serif-sc")).toBe(true);
    expect(isSubtitleFontId(42)).toBe(false);
    expect(isSubtitleFontId("ma-shan")).toBe(false);
  });
});
