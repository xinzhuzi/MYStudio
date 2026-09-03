// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneCreateMenu } from "./pane-create-menu";

afterEach(cleanup);

function renderMenu(onSelect = vi.fn(), onClose = vi.fn()) {
  return render(
    <PaneCreateMenu x={200} y={150} onSelect={onSelect} onClose={onClose} />,
  );
}

describe("PaneCreateMenu", () => {
  it("渲染三类候选并锚定右键坐标", () => {
    renderMenu();
    const menu = screen.getByRole("menu", { name: "创建节点" });
    expect(menu.style.left).toBe("200px");
    expect(menu.style.top).toBe("150px");
    expect(screen.getByRole("menuitem", { name: /^文生图/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^图生图/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^参考图/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^提示词/ })).toBeTruthy();
  });

  it("点击候选回调类型并关闭;↑↓ 键盘导航;ESC 关闭", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu(onSelect, onClose);
    const first = screen.getByRole("menuitem", { name: /^文生图/ });
    expect(document.activeElement).toBe(first);
    // 顺序:文生图→图生图→参考图→提示词(09-03 图生图入列)
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /^图生图/ }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: /^图生图/ }));
    expect(onSelect).toHaveBeenCalledWith("generation-group-i2i");
    expect(onClose).toHaveBeenCalled();
  });

  it("菜单内点击不关闭;ESC 关闭", () => {
    const onClose = vi.fn();
    renderMenu(undefined, onClose);
    const menu = screen.getByRole("menu", { name: "创建节点" });
    fireEvent.pointerDown(menu);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("未聚焦时 ArrowUp 直达末项(不跳过最后一项)", () => {
    renderMenu();
    const menu = screen.getByRole("menu", { name: "创建节点" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /^适配画布/ }));
  });

  it("父组件重渲染不抢回键盘焦点(onClose 经 ref 透传)", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PaneCreateMenu x={0} y={0} onSelect={vi.fn()} onClose={onClose} />);
    const second = screen.getByRole("menuitem", { name: /^图生图/ });
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /^文生图/ }), { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    rerender(<PaneCreateMenu x={0} y={0} onSelect={vi.fn()} onClose={onClose} />);
    expect(document.activeElement).toBe(second);
  });
});

describe("PaneCreateMenu wave3 新节点(09-03)", () => {
  it("便利贴/分组框在创建项中,选中回调收到 kind", () => {
    const onSelect = vi.fn();
    render(<PaneCreateMenu x={8} y={8} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /便利贴/ }));
    expect(onSelect).toHaveBeenCalledWith("sticky");
    cleanup();
    render(<PaneCreateMenu x={8} y={8} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /分组框/ }));
    expect(onSelect).toHaveBeenCalledWith("group");
  });
});
