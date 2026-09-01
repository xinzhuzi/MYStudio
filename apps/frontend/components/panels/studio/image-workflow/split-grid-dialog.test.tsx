// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitGridDialog } from "./split-grid-dialog";

afterEach(cleanup);

describe("SplitGridDialog", () => {
  it("默认 2x2:预览网格线 1横1竖,提示 4 张", () => {
    render(
      <SplitGridDialog open imageUrl="data:image/png;base64,AAAA" sourceTitle="测试" onClose={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByText(/切为 4 张/)).toBeTruthy();
    expect(document.querySelectorAll(".bg-white\\/70").length).toBe(2);
  });

  it("行加到 3:网格变 2横1竖,回调 (3,2)", () => {
    const onConfirm = vi.fn();
    render(
      <SplitGridDialog open imageUrl="data:image/png;base64,AAAA" sourceTitle="测试" onClose={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "行 加一" }));
    fireEvent.click(screen.getByRole("button", { name: "确认切图" }));
    expect(onConfirm).toHaveBeenCalledWith(3, 2);
  });

  it("行列边界 1-4:减到 1 禁用,加到 4 禁用", () => {
    render(
      <SplitGridDialog open imageUrl="data:image/png;base64,AAAA" sourceTitle="测试" onClose={() => {}} onConfirm={() => {}} />,
    );
    expect((screen.getByRole("button", { name: "行 减一" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "行 减一" }));
    expect((screen.getByRole("button", { name: "行 减一" }) as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "列 加一" }));
    expect((screen.getByRole("button", { name: "列 加一" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/切为 4 张/)).toBeTruthy();
  });

  it("取消回调 onClose 不触发 onConfirm", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <SplitGridDialog open imageUrl="data:image/png;base64,AAAA" sourceTitle="测试" onClose={onClose} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
