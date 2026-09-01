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
      () => screen.getByPlaceholderText(/描述要生成的图片/) as HTMLTextAreaElement,
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
      () => screen.getByPlaceholderText(/描述要生成的图片/) as HTMLTextAreaElement,
      { timeout: 5000 },
    );
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "a" });
    fireEvent.input(textarea, { target: { value: "剑客立于山门甲" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(document.activeElement).toBe(textarea);
  });

  /**
   * 防回归(09-02 实弹报障三次根修):用户真实时序=点文生图建组后立刻打字。
   * 两层契约:①测量刷新防抖+排除焦点节点(旧节点照刷保连线,输入节点不进
   * 隐藏窗口);②建组后自动把光标放进新提示词(新节点测量前 visibility:hidden,
   * 该窗口内手动点击落焦会被浏览器丢弃——自动聚焦让「点按钮→直接打字」闭环)。
   */
  it("点文生图建组:新提示词自动聚焦且测量刷新不打焦点节点", async () => {
    useFreedomStore.setState({ imagePrompt: "剑客立于山门" });
    render(<ImageStudioCanvas />);
    await waitFor(
      () => screen.getByPlaceholderText(/描述要生成的图片/) as HTMLTextAreaElement,
      { timeout: 5000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    updateNodeInternalsMock.mockClear();

    // 复刻用户操作:点「文生图」按钮(不手动聚焦,等自动聚焦)
    // (jsdom 的 ResizeObserver 是空壳→节点永远「未测量」,真机由测量翻可见;
    //  这里对 getComputedStyle 打桩放行可见门,聚焦逻辑本身保持真逻辑)
    const computedSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(() => ({ visibility: "visible" } as CSSStyleDeclaration));
    try {
    const t2iButton = screen.getAllByRole("button").find((b) => b.textContent?.includes("文生图"));
    expect(t2iButton).toBeTruthy();
    fireEvent.click(t2iButton!);
    const textareas = await waitFor(() => {
      const all = screen.getAllByPlaceholderText(/描述要生成的图片/) as HTMLTextAreaElement[];
      expect(all.length).toBeGreaterThanOrEqual(2);
      return all;
    }, { timeout: 5000 });
    const fresh = textareas[textareas.length - 1];

    // 自动聚焦应落进新提示词(rAF 后),随后打字焦点保持
    await waitFor(() => expect(document.activeElement).toBe(fresh), { timeout: 3000 });
    fireEvent.input(fresh, { target: { value: "国" } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(document.activeElement).toBe(fresh);
    expect(fresh.value).toContain("国");

    // 防抖窗过后的测量刷新不得包含焦点节点(其余节点照刷保 handleBounds)
    await waitFor(() => expect(updateNodeInternalsMock.mock.calls.length).toBeGreaterThan(0), { timeout: 3000 });
    const focusedNode = fresh.closest(".react-flow__node")?.getAttribute("data-id");
    for (const ids of updateNodeInternalsMock.mock.calls) {
      expect(ids).not.toContain(focusedNode);
    }
    } finally {
      computedSpy.mockRestore();
    }
  });
});
