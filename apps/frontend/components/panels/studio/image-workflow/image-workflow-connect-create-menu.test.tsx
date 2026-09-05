// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageWorkflowConnectCreateMenu } from "./image-workflow-connect-create-menu";
import { getCreatableImageNodeTypes } from "@/lib/studio/image-workflow/connect-create";

afterEach(cleanup);

function renderMenu(
  direction: "downstream" | "upstream" = "upstream",
  onSelect = vi.fn(),
  onClose = vi.fn(),
) {
  return render(
    <ImageWorkflowConnectCreateMenu
      x={120}
      y={80}
      options={getCreatableImageNodeTypes(direction)}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
}

describe("ImageWorkflowConnectCreateMenu", () => {
  it("按落点屏幕坐标锚定,渲染方向对应的候选", () => {
    renderMenu("upstream");
    const menu = screen.getByRole("menu", { name: "创建节点并连接" });
    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("80px");
    expect(screen.getByRole("menuitem", { name: /提示词节点/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /参考图节点/ })).toBeTruthy();
    // 无衣物(09-04 通用化):upstream/downstream 均提供候选
    expect(screen.getByRole("menuitem", { name: /无衣物节点/ })).toBeTruthy();
    cleanup();
    renderMenu("downstream");
    expect(screen.getByRole("menuitem", { name: /无衣物节点/ })).toBeTruthy();
  });

  it("点击候选回调类型并关闭", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu("upstream", onSelect, onClose);
    fireEvent.click(screen.getByRole("menuitem", { name: /参考图节点/ }));
    expect(onSelect).toHaveBeenCalledWith("reference");
    expect(onClose).toHaveBeenCalled();
  });

  it("ESC 关闭且不选择;↑↓ 在选项间移动焦点", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu("upstream", onSelect, onClose);
    const first = screen.getByRole("menuitem", { name: /提示词节点/ });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /参考图节点/ }),
    );
  });

  it("点击遮罩关闭", () => {
    const onClose = vi.fn();
    renderMenu("downstream", vi.fn(), onClose);
    fireEvent.pointerDown(document.querySelector("[data-connect-create-menu]")!);
    expect(onClose).toHaveBeenCalled();
  });
});
