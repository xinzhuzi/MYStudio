// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeContextMenu } from "./node-context-menu";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import {
  selectActiveImageStudioWorkflow,
} from "@/stores/assist/image-studio-store";

afterEach(cleanup);

function renderMenu(
  onDuplicate = vi.fn(),
  onDelete = vi.fn(),
  onClose = vi.fn(),
  onClear = vi.fn(),
) {
  return render(
    <NodeContextMenu
      x={100}
      y={80}
      onDuplicate={onDuplicate}
      onClear={onClear}
      onDelete={onDelete}
      onClose={onClose}
    />,
  );
}

describe("NodeContextMenu", () => {
  it("渲染复制/清空内容/删除三项并锚定坐标", () => {
    renderMenu();
    const menu = screen.getByRole("menu", { name: "节点操作" });
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("80px");
    expect(screen.getByRole("menuitem", { name: "复制" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "清空内容" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeTruthy();
  });

  it("复制/清空内容/删除回调并关闭;ESC 关闭零副作用", () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();
    const onClear = vi.fn();
    renderMenu(onDuplicate, onDelete, onClose, onClear);
    fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "清空内容" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(screen.getByRole("menu", { name: "节点操作" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("store.duplicateNode:提示词复制携正文落偏移位", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup();
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    expect(group?.promptNodeId).toBeTruthy();
    const prompt = graph?.nodes.find((n) => n.type === "prompt");
    expect(prompt).toBeTruthy();
    if (!prompt) return;
    useImageStudioStore.getState().updateActiveWorkflow((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === prompt.id ? { ...n, prompt: "剑客立于山门" } : n)),
    }));
    const newId = useImageStudioStore.getState().duplicateNode(prompt.id);
    expect(newId).toBeTruthy();
    const after = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    const copy = after?.nodes.find((n) => n.id === newId);
    expect(copy?.type).toBe("prompt");
    if (copy?.type === "prompt") {
      expect(copy.prompt).toBe("剑客立于山门");
      expect(copy.title).toContain("副本");
      expect(copy.position.x).toBeGreaterThan(prompt.position.x);
    }
  });

  it("store.duplicateNode:不存在的 id 返回 null", () => {
    expect(useImageStudioStore.getState().duplicateNode("missing")).toBeNull();
  });
});
