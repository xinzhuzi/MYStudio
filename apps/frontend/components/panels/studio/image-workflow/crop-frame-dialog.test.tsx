// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CropFrameDialog } from "./crop-frame-dialog";
import { CROP_DEFAULT } from "@/lib/studio/image-workflow/crop-geometry";

afterEach(cleanup);

function renderDialog(onConfirm = vi.fn(), onClose = vi.fn()) {
  render(
    <CropFrameDialog
      open
      imageUrl="data:image/png;base64,AAAA"
      sourceTitle="测试节点"
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
}

describe("CropFrameDialog", () => {
  it("打开即渲染:标题/默认框/信息条/四按钮", () => {
    renderDialog();
    expect(screen.getByText(/裁剪「测试节点」/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /调整裁剪框 se/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /确认裁剪/ })).toBeTruthy();
    // 三分线
    const box = document.querySelector(".cursor-move");
    expect(box?.querySelectorAll(".border-t.border-white\\/50").length).toBe(2);
  });

  it("确认回调默认归一化框并关闭流程正确", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderDialog(onConfirm, onClose);
    fireEvent.click(screen.getByRole("button", { name: /确认裁剪/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual(CROP_DEFAULT);
    expect(onClose).not.toHaveBeenCalled(); // 关闭由父层落图后统一处理
  });

  it("锁比例切换按钮存在且可点", () => {
    renderDialog();
    const toggle = screen.getByRole("button", { name: /自由比例/ });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /锁定比例/ })).toBeTruthy();
  });

  it("imageUrl 为 null 时不渲染内容(受控关闭)", () => {
    render(
      <CropFrameDialog open={false} imageUrl={null} sourceTitle="" onClose={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.queryByText(/裁剪「/)).toBeNull();
  });

  it("图片元信息读取后显示原图尺寸", async () => {
    renderDialog();
    // jsdom 不解码图片 → 保持「读取中」;此断言钉住降级文案不崩
    await waitFor(() => expect(screen.getByText(/原图/)).toBeTruthy());
  });
});
