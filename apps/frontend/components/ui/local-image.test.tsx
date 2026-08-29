// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalImage } from "./local-image";
import { __resetImageResolutionCacheForTests } from "./image-resolution-badge";

describe("LocalImage", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    __resetImageResolutionCacheForTests();
    cleanup();
  });

  it("syncs a changed src without updating state during render", () => {
    const { rerender } = render(<LocalImage src="local-image://one.png" alt="preview" />);

    rerender(<LocalImage src="local-image://two.png" alt="preview" />);

    expect(screen.getByAltText("preview").getAttribute("src")).toBe("local-image://two.png");
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("Cannot update a component while rendering"),
      expect.anything(),
    );
  });

  it("recovers from a failed image when a new src is provided", () => {
    const { rerender } = render(<LocalImage src="local-image://missing.png" alt="preview" />);

    fireEvent.error(screen.getByAltText("preview"));
    expect(screen.getByText("图片加载失败")).toBeTruthy();

    rerender(<LocalImage src="local-image://generated.png" alt="preview" />);

    expect(screen.queryByText("图片加载失败")).toBeNull();
    expect(screen.getByAltText("preview").getAttribute("src")).toBe("local-image://generated.png");
  });

  it("renders absolute filesystem paths as file URLs", () => {
    render(
      <LocalImage
        src="/tmp/MYStudio Test/assets/files/role/dugu.png"
        alt="preview"
      />,
    );

    expect(screen.getByAltText("preview").getAttribute("src")).toBe(
      "file:///tmp/MYStudio%20Test/assets/files/role/dugu.png",
    );
  });

  it("leaves app-relative and protocol URLs unchanged", () => {
    const { rerender } = render(<LocalImage src="/assets/brand.png" alt="preview" />);

    expect(screen.getByAltText("preview").getAttribute("src")).toBe("/assets/brand.png");

    rerender(<LocalImage src="project-file://project-id/workflow-images/shot.png" alt="preview" />);
    expect(screen.getByAltText("preview").getAttribute("src")).toBe(
      "project-file://project-id/workflow-images/shot.png",
    );

    rerender(<LocalImage src="local-image://characters/dugu.png" alt="preview" />);
    expect(screen.getByAltText("preview").getAttribute("src")).toBe(
      "local-image://characters/dugu.png",
    );
  });

  it("keeps the default render as a bare <img> without any wrapper (layout red line)", () => {
    const { container } = render(
      <LocalImage src="local-image://m/a.png" alt="a" className="h-full w-full object-cover" />,
    );
    expect(container.children).toHaveLength(1);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("class")).toBe("h-full w-full object-cover");
    expect(container.querySelector("span")).toBeNull();
  });

  it("keeps the no-fallback error branch as the terminal placeholder with marker and label (08-30 合一后统一占位形态)", () => {
    const { container } = render(
      <LocalImage src="file:///definitely-missing/x.png" alt="x" fallbackLabel="自定义文案" />,
    );
    fireEvent.error(screen.getByAltText("x"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-local-image-failed]")?.getAttribute("data-local-image-failed")).toBe("x");
    expect(container.textContent).toContain("自定义文案");
  });

  it("wraps with a positioned span only in resolutionBadge mode", () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = "";
      },
    );
    const { container } = render(
      <LocalImage
        src="local-image://m/b.png"
        alt="b"
        className="h-full w-full object-cover"
        resolutionBadge
      />,
    );
    const wrapper = container.querySelector("span");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("relative");
    const img = wrapper?.querySelector("img");
    expect(img?.getAttribute("class")).toBe("h-full w-full object-cover");
  });
});
