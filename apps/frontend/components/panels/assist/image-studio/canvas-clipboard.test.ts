import { afterEach, describe, expect, it } from "vitest";
import {
  __resetClipboardForTests,
  clipboardSize,
  copyNodesToClipboard,
  pasteFromClipboard,
} from "./canvas-clipboard";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";

afterEach(() => {
  useImageStudioStore.setState(useImageStudioStore.getState(), true);
  __resetClipboardForTests();
});

function activeGraph() {
  return selectActiveImageStudioWorkflow(useImageStudioStore.getState());
}

describe("canvas-clipboard", () => {
  it("复制→粘贴:节点偏移 48px+副本标题+集内连线保留+血缘保留", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup();
    const before = activeGraph()!.nodes.length;

    const copied = copyNodesToClipboard([group.promptNodeId, group.generatedNodeId]);
    expect(copied).toBe(2);
    expect(clipboardSize()).toBe(2);

    const pasted = pasteFromClipboard();
    expect(pasted).toHaveLength(2);
    const after = activeGraph()!;
    expect(after.nodes.length).toBe(before + 2);
    const copyPrompt = after.nodes.find((node) => node.id === pasted[0]);
    expect(copyPrompt?.title).toContain("副本");
    const original = after.nodes.find((node) => node.id === group.promptNodeId)!;
    expect(copyPrompt!.position.x).toBe(original.position.x + 48);
    // 集内连线(p→gen)保留
    expect(
      after.edges.some((edge) => edge.source === pasted[0] && edge.target === pasted[1]),
    ).toBe(true);
  });

  it("空选/空剪贴板零操作", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    expect(copyNodesToClipboard([])).toBe(0);
    expect(pasteFromClipboard()).toHaveLength(0);
  });

  it("重复粘贴幂等生成新 id", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup();
    copyNodesToClipboard([group.promptNodeId]);
    const first = pasteFromClipboard();
    const second = pasteFromClipboard();
    expect(first[0]).not.toBe(second[0]);
  });
});
