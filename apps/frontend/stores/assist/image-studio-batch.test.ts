import { afterEach, describe, expect, it } from "vitest";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "./image-studio-store";

afterEach(() => {
  useImageStudioStore.setState(useImageStudioStore.getState(), true);
});

function activeGraph() {
  return selectActiveImageStudioWorkflow(useImageStudioStore.getState());
}

describe("批量图片组 store 语义", () => {
  it("setNodeBatchResult:images[0] 为主图,>1 才成组;count=1 无组", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup();
    const genId = group!.generatedNodeId;

    useImageStudioStore.getState().setNodeBatchResult(genId, ["a.png", "b.png", "c.png"], "m1");
    const gen = activeGraph()!.nodes.find((n) => n.id === genId);
    expect(gen && gen.type === "generated" ? gen.resultUrl : null).toBe("a.png");
    expect(gen && gen.type === "generated" ? gen.imageBatch : null).toEqual({
      images: ["a.png", "b.png", "c.png"],
      primaryIndex: 0,
    });

    // 单张:无组(回归 count=1 语义)
    useImageStudioStore.getState().setNodeBatchResult(genId, ["solo.png"]);
    const solo = activeGraph()!.nodes.find((n) => n.id === genId);
    expect(solo && solo.type === "generated" ? solo.resultUrl : null).toBe("solo.png");
    expect(solo && solo.type === "generated" ? solo.imageBatch : null).toBeUndefined();
  });

  it("setBatchPrimary:主图切换同步 resultUrl;重复设置无操作;越界钳制", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup();
    const genId = group!.generatedNodeId;
    useImageStudioStore.getState().setNodeBatchResult(genId, ["a.png", "b.png", "c.png"]);

    useImageStudioStore.getState().setBatchPrimary(genId, 2);
    let gen = activeGraph()!.nodes.find((n) => n.id === genId);
    expect(gen && gen.type === "generated" ? gen.resultUrl : null).toBe("c.png");
    expect(gen && gen.type === "generated" ? gen.imageBatch?.primaryIndex : null).toBe(2);

    // 越界钳制到有效范围
    useImageStudioStore.getState().setBatchPrimary(genId, 99);
    gen = activeGraph()!.nodes.find((n) => n.id === genId);
    expect(gen && gen.type === "generated" ? gen.imageBatch?.primaryIndex : null).toBe(2);

    // 无组节点:无操作不炸
    useImageStudioStore.getState().setBatchPrimary(group!.promptNodeId, 1);
  });
});
