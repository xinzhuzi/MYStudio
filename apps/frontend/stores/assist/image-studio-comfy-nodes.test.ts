// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  sanitizeWorkflowsForPersist,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import type { ComfyWorkflowDescriptor } from "@/lib/assist/image-studio/comfy-workflow-import";
import type { ImageWorkflowComfyGenericNode, ImageWorkflowComfyWorkflowNode } from "@/types/studio";

/**
 * ComfyUI 生态节点 store 面(09-08 流X):创建-持久化字段、状态/结果/widget
 * 回写(定向到节点所在画布)、导出导入往返、瞬态净化。
 */

const initialState = useImageStudioStore.getState();

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(initialState, true);
  localStorage.clear();
});

const DESCRIPTOR: ComfyWorkflowDescriptor = {
  ports: [
    { id: "6.text", type: "prompt-text", label: "正向提示词", nodeId: "6", inputKey: "text", polarity: "positive" },
    { id: "10.image", type: "image", label: "参考图 1", nodeId: "10", inputKey: "image" },
  ],
  widgets: [
    { id: "12.seed", type: "INT", label: "随机种子", default: 42, nodeId: "12", inputKey: "seed" },
  ],
  classTypesUsed: ["CLIPTextEncode"],
  nodeCount: 5,
  missing: [],
};

describe("addComfyWorkflowNode(工作流库导入成卡)", () => {
  it("创建即持久化:type/workflowId/descriptor 快照/widgets 值/输出 mediaRef 字段齐备", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const id = store.addComfyWorkflowNode({
      workflowId: "wf-9",
      workflowName: "K2 专业流",
      descriptor: DESCRIPTOR,
    });
    const graph = useImageStudioStore.getState().workflows[0];
    const node = graph.nodes.find((item) => item.id === id) as ImageWorkflowComfyWorkflowNode;
    expect(node.type).toBe("comfy-workflow");
    expect(node.workflowId).toBe("wf-9");
    expect(node.workflowName).toBe("K2 专业流");
    expect(node.descriptor.ports).toHaveLength(2);
    expect(node.descriptor.widgets[0].default).toBe(42);
    expect(node.widgetValues).toBeUndefined();
    expect(node.resultUrl).toBeUndefined();
    expect(node.status).toBe("idle");
    // 槽位:comfy 泳道(成图列)首位置
    expect(node.position.x).toBe(1010);
  });

  it("落位下一个空位(既有 comfy 节点之下)", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    store.addComfyWorkflowNode({ workflowId: "a", workflowName: "A", descriptor: DESCRIPTOR });
    const second = store.addComfyWorkflowNode({ workflowId: "b", workflowName: "B", descriptor: DESCRIPTOR });
    const node = useImageStudioStore.getState().workflows[0].nodes.find((item) => item.id === second);
    expect(node?.position.y).toBeGreaterThan(40);
  });
});

describe("comfy 节点回写动作(定向到节点所在画布)", () => {
  it("状态/结果/widget 现值分别落位,生成期间切画布不丢", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const id = store.addComfyWorkflowNode({ workflowId: "wf", workflowName: "W", descriptor: DESCRIPTOR });
    store.setComfyNodeStatus(id, "running", "引擎执行中:排队");
    let node = useImageStudioStore.getState().workflows[0].nodes.find((n) => n.id === id) as ImageWorkflowComfyWorkflowNode;
    expect(node.status).toBe("running");
    expect(node.statusMessage).toContain("排队");
    // 切到新画布后回写仍落原画布
    store.createWorkflow("画布 2");
    store.setComfyNodeResult(id, {
      resultUrl: "project-file://p1/media/ai-image/x.png",
      resultMediaId: "m1",
      resultCount: 3,
    });
    node = useImageStudioStore.getState().workflows[0].nodes.find((n) => n.id === id) as ImageWorkflowComfyWorkflowNode;
    expect(node.status).toBe("ready");
    expect(node.resultUrl).toBe("project-file://p1/media/ai-image/x.png");
    expect(node.resultCount).toBe(3);
    store.setComfyNodeWidgetValue(id, "12.seed", 99);
    node = useImageStudioStore.getState().workflows[0].nodes.find((n) => n.id === id) as ImageWorkflowComfyWorkflowNode;
    expect(node.widgetValues).toEqual({ "12.seed": 99 });
  });
});

describe("addComfyGenericNode(效果节点直放)", () => {
  it("创建:classType/descriptor 快照/标题,状态 idle", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const id = store.addComfyGenericNode({
      classType: "ImageBlur",
      title: "模糊",
      descriptor: {
        ports: [
          { id: "image", label: "图片", type: "IMAGE", side: "input" },
          { id: "0", label: "输出", type: "IMAGE", side: "output" },
        ],
        widgets: [{ id: "blur_radius", label: "blur_radius", type: "INT", default: 1 }],
      },
    });
    const node = useImageStudioStore.getState().workflows[0].nodes.find((n) => n.id === id) as ImageWorkflowComfyGenericNode;
    expect(node.type).toBe("comfy-generic");
    expect(node.classType).toBe("ImageBlur");
    expect(node.title).toBe("模糊");
    expect(node.descriptor.ports).toHaveLength(2);
  });

  it("副本(duplicateNode):descriptor/widgets 随行,状态归零", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const id = store.addComfyGenericNode({
      classType: "ImageBlur",
      title: "模糊",
      descriptor: { ports: [], widgets: [] },
    });
    store.setComfyNodeWidgetValue(id, "blur_radius", 8);
    store.setComfyNodeResult(id, { resultUrl: "data:image/png;base64,QQ==" });
    const copyId = store.duplicateNode(id);
    const copy = useImageStudioStore.getState().workflows[0].nodes.find((n) => n.id === copyId) as ImageWorkflowComfyGenericNode;
    expect(copy.title).toBe("模糊 副本");
    expect(copy.widgetValues).toEqual({ blur_radius: 8 });
    expect(copy.status).toBe("idle");
    expect(copy.resultUrl).toBeUndefined();
  });
});

describe("持久化净化与画布导入往返", () => {
  it("data: 输出图剥离+状态置 failed(内存预览不持久化)", () => {
    const workflows = [{
      ...useImageStudioStore.getState().workflows,
    }];
    void workflows;
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const id = store.addComfyWorkflowNode({ workflowId: "wf", workflowName: "W", descriptor: DESCRIPTOR });
    store.setComfyNodeResult(id, { resultUrl: "data:image/png;base64,QUJD" });
    const sanitized = sanitizeWorkflowsForPersist(useImageStudioStore.getState().workflows);
    const node = sanitized[0].nodes.find((n) => n.id === id) as ImageWorkflowComfyWorkflowNode;
    expect(node.resultUrl).toBeUndefined();
    expect(node.status).toBe("failed");
    // 受管地址不剥离
    store.setComfyNodeResult(id, { resultUrl: "project-file://p1/x.png" });
    const kept = sanitizeWorkflowsForPersist(useImageStudioStore.getState().workflows);
    const keptNode = kept[0].nodes.find((n) => n.id === id) as ImageWorkflowComfyWorkflowNode;
    expect(keptNode.resultUrl).toBe("project-file://p1/x.png");
    expect(keptNode.status).toBe("ready");
  });

  it("导出画布含 comfy 节点/连线可往返导入(白名单+口别回落)", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const wfId = store.addComfyWorkflowNode({ workflowId: "wf", workflowName: "W", descriptor: DESCRIPTOR });
    const genId = store.addComfyWorkflowNode({ workflowId: "wf2", workflowName: "W2", descriptor: DESCRIPTOR });
    store.connect(wfId, genId, "image");
    const source = useImageStudioStore.getState().workflows[0];
    const payload = {
      schemaVersion: 1,
      name: source.name,
      nodes: source.nodes,
      edges: source.edges,
    };
    const result = useImageStudioStore.getState().importWorkflow(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imported = useImageStudioStore.getState().workflows.find((w) => w.id === result.id);
    expect(imported?.nodes.filter((n) => n.type === "comfy-workflow")).toHaveLength(2);
    expect(imported?.edges.filter((e) => e.targetHandle === "image")) .toHaveLength(1);
  });
});
