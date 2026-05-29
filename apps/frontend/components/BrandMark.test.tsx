import { describe, expect, it } from "vitest";
import { BRAND_MARK_ALT, BRAND_MARK_SOURCE, BrandMark } from "./BrandMark";

describe("BrandMark", () => {
  it("uses the preserved transparent dragon emblem as the in-app brand mark", () => {
    const element = BrandMark({ className: "brand-shell" });
    const image = element.props.children;

    expect(BRAND_MARK_ALT).toBe("漫影工作室");
    expect(BRAND_MARK_SOURCE).toContain("dragon-emblem-source.png");
    expect(element.props.className).toContain("brand-shell");
    expect(image.type).toBe("img");
    expect(image.props.src).toBe(BRAND_MARK_SOURCE);
    expect(image.props.alt).toBe(BRAND_MARK_ALT);
    expect(image.props.draggable).toBe(false);
  });
});
