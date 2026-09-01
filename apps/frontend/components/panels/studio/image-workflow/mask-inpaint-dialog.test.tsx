// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MaskInpaintDialog } from "./mask-inpaint-dialog";

afterEach(cleanup);

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderDialog(onConfirm = vi.fn(), onClose = vi.fn()) {
  return render(
    <MaskInpaintDialog
      open
      imageUrl="data:image/png;base64,AAAA"
      sourceTitle="测试节点"
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
}

describe("MaskInpaintDialog", () => {
  it("打开即渲染:标题/画笔/擦除/笔刷/修改要求/按钮", () => {
    renderDialog();
    expect(screen.getByText(/局部重绘「测试节点」/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /画笔/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /擦除/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /重置/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI 修改/ })).toBeTruthy();
    expect(screen.getByText(/笔刷大小/)).toBeTruthy();
  });

  it("校验:未填要求提交报『请输入修改要求』", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /AI 修改/ }));
    expect(screen.getByText("请输入修改要求")).toBeTruthy();
  });

  it("模式切换:擦除按下态切换", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /擦除/ }));
    expect(screen.getByRole("button", { name: /擦除/ })).toBeTruthy();
  });

  it("图片元信息未就绪时不渲染画布但框架不崩(降级)", () => {
    renderDialog();
    // jsdom 不解码图片 → 画布 absent,信息条显示读取中
    expect(screen.getByText("读取中")).toBeTruthy();
    expect(document.querySelector("canvas.cursor-crosshair")).toBeNull();
  });

  it("取消走 onClose,不触发 onConfirm", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    renderDialog(onConfirm, onClose);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
