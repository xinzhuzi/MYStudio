// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasHints } from "./canvas-hints";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("CanvasHints(画布新手指引)", () => {
  it("首次(未关闭过)自动展开,含五条速查", () => {
    render(<div className="relative"><CanvasHints /></div>);
    expect(screen.getByText("画布速查")).toBeTruthy();
    expect(screen.getByText("建节点")).toBeTruthy();
    expect(screen.getByText("连线")).toBeTruthy();
    expect(screen.getByText("撤销/复制")).toBeTruthy();
    expect(screen.getByText("导航")).toBeTruthy();
    expect(screen.getByText("取材")).toBeTruthy();
  });

  it("关闭=偏好记忆;? 按钮可唤回", () => {
    render(<div className="relative"><CanvasHints /></div>);
    fireEvent.click(screen.getByRole("button", { name: "关闭指引" }));
    expect(window.localStorage.getItem("studio-image-canvas-hints-dismissed")).toBe("1");
    expect(screen.queryByText("画布速查")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "画布操作指引" }));
    expect(screen.getByText("画布速查")).toBeTruthy();
  });

  it("已关闭过的设备不再自动弹出", () => {
    window.localStorage.setItem("studio-image-canvas-hints-dismissed", "1");
    render(<div className="relative"><CanvasHints /></div>);
    expect(screen.queryByText("画布速查")).toBeNull();
  });
});
