// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/panels/assist/ModelSelector", () => ({
  ModelSelector: ({ value }: { value: string }) => (
    <select data-testid="model-selector" value={value} disabled>
      <option value={value}>{value || "默认模型"}</option>
    </select>
  ),
}));
const updateNodeInternalsMock = vi.hoisted(() => vi.fn());
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useUpdateNodeInternals: () => updateNodeInternalsMock,
  };
});

import { ImageStudioCanvas } from "./ImageStudioCanvas";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";

(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as unknown as { matchMedia?: unknown }).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const initialStudioState = useImageStudioStore.getState();
const initialFreedomState = useFreedomStore.getState();

afterEach(() => {
  cleanup();
  updateNodeInternalsMock.mockReset();
  useImageStudioStore.setState(initialStudioState, true);
  useFreedomStore.setState(initialFreedomState, true);
});

/**
 * 防回归(实弹报障根修):输入字符只改节点内容不改节点集,
 * updateNodeInternals 不得因数组引用抖动被重触发——否则 React Flow
 * 清空测量重测,重测窗口节点 visibility:hidden → 输入框隐没失焦。
 */
describe("测量刷新稳定性", () => {
  it("输入一字符不重触发 updateNodeInternals(节点集未变)", async () => {
    useFreedomStore.setState({ imagePrompt: "剑客立于山门" });
    render(<ImageStudioCanvas />);
    const textarea = await waitFor(
      () => screen.getByPlaceholderText("描述要生成的图片") as HTMLTextAreaElement,
      { timeout: 5000 },
    );
    // 等初始测量刷新(挂载/种子物化)落定
    await new Promise((resolve) => setTimeout(resolve, 600));
    updateNodeInternalsMock.mockClear();

    fireEvent.input(textarea, { target: { value: "剑客立于山门甲" } });
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 节点集成员未变 → 不应再调 updateNodeInternals
    expect(updateNodeInternalsMock).not.toHaveBeenCalled();
  });

  it("焦点保持:输入一字符后仍在 textarea", async () => {
    useFreedomStore.setState({ imagePrompt: "剑客立于山门" });
    render(<ImageStudioCanvas />);
    const textarea = await waitFor(
      () => screen.getByPlaceholderText("描述要生成的图片") as HTMLTextAreaElement,
      { timeout: 5000 },
    );
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "a" });
    fireEvent.input(textarea, { target: { value: "剑客立于山门甲" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(document.activeElement).toBe(textarea);
  });
});
