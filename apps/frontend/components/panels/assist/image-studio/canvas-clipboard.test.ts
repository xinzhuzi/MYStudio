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

describe("canvas-clipboard 域规则单源(09-03 对比补口)", () => {
  it("粘贴的边经单源把关:复制合法组,粘贴边全部指向成图", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup();
    copyNodesToClipboard([group.promptNodeId, group.generatedNodeId]);
    pasteFromClipboard();
    const graph = activeGraph()!;
    for (const edge of graph.edges) {
      const target = graph.nodes.find((node) => node.id === edge.target);
      expect(target?.type).toBe("generated");
    }
  });
});

describe("importWorkflow 边域规则(09-03 对比补口)", () => {
  it("导入丢弃非法边:非成图目标/自环/重复边,合法边保留", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const result = useImageStudioStore.getState().importWorkflow({
      schemaVersion: 1,
      name: "规则对拍",
      nodes: [
        { id: "p1", type: "prompt", title: "P1", prompt: "甲" },
        { id: "p2", type: "prompt", title: "P2", prompt: "乙" },
        { id: "g1", type: "generated", title: "G1" },
      ],
      edges: [
        { id: "e1", source: "p1", target: "g1" },      // 合法
        { id: "e2", source: "p1", target: "p2" },      // 非法:目标非成图
        { id: "e3", source: "g1", target: "g1" },      // 非法:自环
        { id: "e4", source: "p1", target: "g1" },      // 非法:重复(同向)
        { id: "e5", source: "p2", target: "g1" },      // 合法(第二提示词是使用歧义,域规则不拦)
      ],
    });
    expect(result.ok).toBe(true);
    const imported = useImageStudioStore
      .getState()
      .workflows.find((workflow) => workflow.name.includes("规则对拍"))!;
    expect(imported.edges.map((edge) => edge.id).sort()).toEqual(["e1", "e5"]);
  });
});
