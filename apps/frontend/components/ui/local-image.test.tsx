// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalImage } from "./local-image";

describe("LocalImage", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
        src="/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/files/role/dugu.png"
        alt="preview"
      />,
    );

    expect(screen.getByAltText("preview").getAttribute("src")).toBe(
      "file:///Users/zhengbingjin/Library/Application%20Support/%E6%BC%AB%E5%BD%B1%E5%B7%A5%E4%BD%9C%E5%AE%A4/assets/files/role/dugu.png",
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
});
