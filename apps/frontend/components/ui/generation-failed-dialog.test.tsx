// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { eventBus } from "@/lib/events/event-bus";
import { IMAGE_GENERATION_FAILED_EVENT } from "@/lib/events/image-generation-events";
import { GenerationFailedDialog } from "./generation-failed-dialog";

/**
 * 09-03 用户裁定:生图失败提示弹窗化(不放节点卡)。本组件由编排层
 * eventBus 广播驱动,surface 区分两个画布视图(可能同时挂载)。
 */

afterEach(() => {
  cleanup();
  eventBus.clear(IMAGE_GENERATION_FAILED_EVENT);
});

describe("GenerationFailedDialog", () => {
  it("本画布失败:弹窗呈现大白话原因,可关闭", async () => {
    render(<GenerationFailedDialog surface="image-studio" />);
    eventBus.emit(IMAGE_GENERATION_FAILED_EVENT, {
      surface: "image-studio",
      reason: "网络连接失败,请稍后重试",
    });
    expect(await screen.findByText("生成失败")).toBeTruthy();
    expect(screen.getByText("网络连接失败,请稍后重试")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByText("网络连接失败,请稍后重试")).toBeNull();
  });

  it("其他画布的失败:不弹(两视图同时挂载时各弹各的)", () => {
    render(<GenerationFailedDialog surface="image-studio" />);
    eventBus.emit(IMAGE_GENERATION_FAILED_EVENT, {
      surface: "image-workflow",
      reason: "分镜链失败原因",
    });
    expect(screen.queryByText("生成失败")).toBeNull();
    expect(screen.queryByText("分镜链失败原因")).toBeNull();
  });

  it("卸载即解绑:组件移除后事件不再影响", () => {
    const view = render(<GenerationFailedDialog surface="image-studio" />);
    view.unmount();
    expect(() =>
      eventBus.emit(IMAGE_GENERATION_FAILED_EVENT, {
        surface: "image-studio",
        reason: "无人监听",
      }),
    ).not.toThrow();
  });
});
