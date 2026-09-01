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
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";

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

/** 用户报障复现:提示词节点 textarea 输入 1 字符即失焦(辅助画布) */
describe("辅助画布提示词输入焦点", () => {
  it("输入一字符后焦点仍在 textarea", async () => {
    useFreedomStore.setState({ imagePrompt: "剑客立于山门" });
    render(<ImageStudioCanvas />);
    const textarea = await waitFor(
      () => screen.getByPlaceholderText("描述要生成的图片") as HTMLTextAreaElement,
      { timeout: 5000 },
    );
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    fireEvent.keyDown(textarea, { key: "1" });
    fireEvent.input(textarea, { target: { value: "12" } });

    await new Promise((resolve) => setTimeout(resolve, 400));

    const focused = document.activeElement === textarea;
    const inDoc = document.body.contains(textarea);
    const storePrompt = selectActiveImageStudioWorkflow(useImageStudioStore.getState())?.nodes.find(
      (node) => node.type === "prompt",
    )?.prompt;

    expect({ focused, inDoc, storePrompt }).toEqual({
      focused: true,
      inDoc: true,
      storePrompt: "12",
    });
  });
});
