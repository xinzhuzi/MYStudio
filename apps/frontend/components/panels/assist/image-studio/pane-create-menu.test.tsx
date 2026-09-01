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
    expect(screen.getByRole("menuitem", { name: /^参考图/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^提示词/ })).toBeTruthy();
  });

  it("点击候选回调类型并关闭;↑↓ 键盘导航;ESC 关闭", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu(onSelect, onClose);
    const first = screen.getByRole("menuitem", { name: /^文生图/ });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /^参考图/ }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: /^提示词/ }));
    expect(onSelect).toHaveBeenCalledWith("prompt");
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
});
