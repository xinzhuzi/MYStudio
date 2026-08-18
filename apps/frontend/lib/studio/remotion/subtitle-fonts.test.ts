import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBTITLE_FONT_ID,
  SUBTITLE_FONT_CATEGORIES,
  SUBTITLE_FONT_IDS,
  SUBTITLE_FONT_STYLES,
  isSubtitleFontId,
  resolveSubtitleFontStyle,
} from "./subtitle-fonts";

describe("subtitle font registry", () => {
  it("defaults to the brush kaishu font with seven curated fonts", () => {
    expect(DEFAULT_SUBTITLE_FONT_ID).toBe("ma-shan-zheng");
    expect(SUBTITLE_FONT_IDS).toHaveLength(7);
    expect(SUBTITLE_FONT_IDS).toContain(DEFAULT_SUBTITLE_FONT_ID);
  });

  it("groups every font into a known category with descriptions", () => {
    for (const id of SUBTITLE_FONT_IDS) {
      const style = SUBTITLE_FONT_STYLES[id];
      expect(SUBTITLE_FONT_CATEGORIES, `${id} category`).toContain(style.category);
      expect(style.label.length, `${id} label`).toBeGreaterThan(0);
      expect(style.description.length, `${id} description`).toBeGreaterThan(0);
      expect(style.outlinePx, `${id} outlinePx`).toBeGreaterThan(0);
    }
    const calligraphy = SUBTITLE_FONT_IDS.filter((id) => SUBTITLE_FONT_STYLES[id].category === "calligraphy");
    expect(calligraphy).toEqual([
      "ma-shan-zheng",
      "zhi-mang-xing",
      "long-cang",
      "lxgw-wenkai",
      "liu-jian-mao-cao",
    ]);
  });

  it("resolves known ids to their registered style", () => {
    const style = resolveSubtitleFontStyle("noto-sans-sc");
    expect(style.fontFamily).toContain("Noto Sans SC");
    expect(style.fontWeight).toBe(900);
    expect(resolveSubtitleFontStyle("lxgw-wenkai").fontFamily).toContain("LXGW WenKai");
  });

  it("falls back to the default font for unknown or missing ids", () => {
    expect(resolveSubtitleFontStyle(undefined).fontFamily)
      .toBe(SUBTITLE_FONT_STYLES[DEFAULT_SUBTITLE_FONT_ID].fontFamily);
    expect(resolveSubtitleFontStyle("bogus").fontFamily)
      .toBe(SUBTITLE_FONT_STYLES[DEFAULT_SUBTITLE_FONT_ID].fontFamily);
  });

  it("keeps single-weight calligraphy fonts at 400 (synthetic bold smears brush strokes)", () => {
    for (const id of ["ma-shan-zheng", "zhi-mang-xing", "long-cang", "lxgw-wenkai", "liu-jian-mao-cao"] as const) {
      expect(SUBTITLE_FONT_STYLES[id].fontWeight, id).toBe(400);
    }
  });

  it("keeps the cursive title font on a thinner outline to avoid smearing", () => {
    expect(SUBTITLE_FONT_STYLES["liu-jian-mao-cao"].outlinePx).toBeLessThan(
      SUBTITLE_FONT_STYLES["ma-shan-zheng"].outlinePx,
    );
  });

  it("guards the id whitelist", () => {
    expect(isSubtitleFontId("noto-serif-sc")).toBe(true);
    expect(isSubtitleFontId("zhi-mang-xing")).toBe(true);
    expect(isSubtitleFontId(42)).toBe(false);
    expect(isSubtitleFontId("ma-shan")).toBe(false);
  });
});
