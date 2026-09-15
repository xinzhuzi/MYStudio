// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ABCompare } from "./ab-compare";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installFakeImage() {
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 100;
      naturalHeight = 60;
      private src_ = "";
      constructor() {
        Object.defineProperty(this, "src", {
          get: () => this.src_,
          set: (value: string) => {
            this.src_ = value;
            queueMicrotask(() => {
              if (value.includes("broken")) this.onerror?.();
              else this.onload?.();
            });
          },
        });
      }
    },
  );
}

function stubCanvasRect(width = 400, height = 240) {
  // jsdom 无布局:getBoundingClientRect 恒 0,pointer 坐标换算需要真实宽高
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, toJSON: () => ({}),
  } as DOMRect));
}

describe("ABCompare 图片对比基件", () => {
  it("渲染 A/B 角标与默认 3x 放大镜倍数;滑杆 2-7", async () => {
    installFakeImage();
    render(<ABCompare urlA="https://example.test/a.png" urlB="https://example.test/b.png" labelA="旧版" labelB="新版" />);
    expect(screen.getByText("旧版")).toBeTruthy();
    expect(screen.getByText("新版")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("3x")).toBeTruthy();
    });
    const zoom = screen.getByLabelText("放大镜倍数") as HTMLInputElement;
    expect(Number(zoom.min)).toBe(2);
    expect(Number(zoom.max)).toBe(7);
    fireEvent.change(zoom, { target: { value: "5" } });
    await waitFor(() => {
      expect(screen.getByText("5x")).toBeTruthy();
    });
  });

  it("指针拖动更新分割线位置(role=slider 值联动);左右方向键微调", async () => {
    installFakeImage();
    stubCanvasRect();
    render(<ABCompare urlA="https://example.test/a.png" urlB="https://example.test/b.png" />);
    const stage = screen.getByRole("slider", { name: "对比分割线位置" });
    await waitFor(() => {
      expect(stage.getAttribute("data-ab-compare-stage")).toBe("50");
    });
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 120 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 100, clientY: 120 });
    await waitFor(() => {
      expect(stage.getAttribute("data-ab-compare-stage")).toBe("25");
    });
    // 放大镜随指针出现
    expect(stage.getAttribute("data-ab-compare-loupe")).toBe("on");
    fireEvent.pointerUp(stage, { pointerId: 1 });
    // 键盘微调:默认步进 2%
    stage.focus();
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    await waitFor(() => {
      expect(stage.getAttribute("data-ab-compare-stage")).toBe("27");
    });
  });

  it("单图加载失败显示对应失败角标;双图不可用显示占位", async () => {
    installFakeImage();
    render(<ABCompare urlA="https://example.test/broken.png" urlB="https://example.test/b.png" labelA="旧版" labelB="新版" />);
    await waitFor(() => {
      expect(screen.getByText("旧版加载失败")).toBeTruthy();
    });
    expect(screen.queryByText("新版加载失败")).toBeNull();

    cleanup();
    render(<ABCompare urlA="https://example.test/broken.png" urlB="https://example.test/broken2.png" />);
    await waitFor(() => {
      expect(screen.getByText("图片不可用")).toBeTruthy();
    });
  });

  it("jsdom 无 2d 上下文(canvas.getContext=null)不崩:DOM 行为照常", async () => {
    installFakeImage();
    stubCanvasRect();
    render(<ABCompare urlA="a.png" urlB="b.png" />);
    const stage = screen.getByRole("slider", { name: "对比分割线位置" });
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 100 });
    await waitFor(() => {
      expect(stage.getAttribute("data-ab-compare-stage")).toBe("75");
    });
  });
});
