// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as XYFlow from "@xyflow/react";
import { CanvasViewportControls } from "./CanvasViewportControls";

/**
 * 08-31-canvas-minimap:小地图显隐开关 + 偏好记忆。
 * 真实 ReactFlowProvider 上下文(MiniMap/Panel 需要真 store)。
 */

function renderControls() {
  return render(
    <XYFlow.ReactFlowProvider>
      <CanvasViewportControls onFit={() => {}} />
    </XYFlow.ReactFlowProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("CanvasViewportControls 小地图", () => {
  it("默认显示小地图,且开关按钮为按下态", () => {
    renderControls();
    expect(document.querySelector(".workflow-canvas-minimap")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "收起小地图" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("点击开关收起小地图并记忆偏好", () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: "收起小地图" }));
    expect(document.querySelector(".workflow-canvas-minimap")).toBeNull();
    expect(window.localStorage.getItem("studio-canvas-minimap-open")).toBe(
      "0",
    );
    expect(
      screen.getByRole("button", { name: "展开小地图" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("偏好记忆跨渲染生效:上次收起则默认收起,可再展开", () => {
    window.localStorage.setItem("studio-canvas-minimap-open", "0");
    renderControls();
    expect(document.querySelector(".workflow-canvas-minimap")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开小地图" }));
    expect(document.querySelector(".workflow-canvas-minimap")).not.toBeNull();
    expect(window.localStorage.getItem("studio-canvas-minimap-open")).toBe("1");
  });

  it("既有视口按钮与样式契约保留(workflow-tabs 源码断言的行为面)", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "缩小画布" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "放大画布" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "适配画布" })).toBeTruthy();
  });
});
