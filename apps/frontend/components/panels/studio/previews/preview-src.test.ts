import { describe, expect, it } from "vitest";
import { toPreviewSrc, withThumbVariant } from "./preview-src";

describe("preview src helpers", () => {
  it("keeps toPreviewSrc semantics unchanged", () => {
    expect(toPreviewSrc("project-file://p/a.png")).toBe("project-file://p/a.png");
    expect(toPreviewSrc("/abs/a.png")).toBe("file:///abs/a.png");
    expect(toPreviewSrc("relative.png")).toBe("relative.png");
  });

  it("appends ?thumb=1 only for managed image schemes without a query", () => {
    expect(withThumbVariant("project-file://p/a.png")).toBe("project-file://p/a.png?thumb=1");
    expect(withThumbVariant("asset-file://role/hero.png")).toBe("asset-file://role/hero.png?thumb=1");
    expect(withThumbVariant("project-file://p/a.png?x=2")).toBe("project-file://p/a.png?x=2");
    expect(withThumbVariant("local-image://m/a.png")).toBe("local-image://m/a.png");
    expect(withThumbVariant("https://cdn/a.png")).toBe("https://cdn/a.png");
    expect(withThumbVariant("/abs/a.png")).toBe("/abs/a.png");
  });
});
