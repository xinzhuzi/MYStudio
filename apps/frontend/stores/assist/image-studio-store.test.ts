// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, describe, expect, it } from "vitest";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "./image-studio-store";
import type { ImageWorkflowNode } from "@/types/studio";

const initialState = useImageStudioStore.getState();

afterEach(() => {
  useImageStudioStore.setState(initialState, true);
  localStorage.clear();
});

function activeNodes(): ImageWorkflowNode[] {
  return selectActiveImageStudioWorkflow(useImageStudioStore.getState())?.nodes ?? [];
}

describe("image-studio-store 画布管理", () => {
  it("ensureDefaultWorkflow:空 store 自动建「画布 1」并激活", () => {
    const id = useImageStudioStore.getState().ensureDefaultWorkflow();
    const state = useImageStudioStore.getState();
    expect(state.workflows).toHaveLength(1);
    expect(state.workflows[0].name).toBe("画布 1");
    expect(state.workflows[0].target).toEqual({ kind: "free" });
    expect(state.activeWorkflowId).toBe(id);
  });

  it("createWorkflow 命名自增;switch/rename/delete 维护激活态", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    const second = store.createWorkflow();
    expect(useImageStudioStore.getState().workflows[1].name).toBe("画布 2");
    expect(useImageStudioStore.getState().activeWorkflowId).toBe(second);

    useImageStudioStore.getState().renameWorkflow(second, "角色探索");
    expect(
      useImageStudioStore.getState().workflows.find((w) => w.id === second)?.name,
    ).toBe("角色探索");

    useImageStudioStore.getState().switchWorkflow(useImageStudioStore.getState().workflows[0].id);
    expect(useImageStudioStore.getState().activeWorkflowId).toBe(
      useImageStudioStore.getState().workflows[0].id,
    );

    useImageStudioStore.getState().deleteWorkflow(useImageStudioStore.getState().activeWorkflowId as string);
    const after = useImageStudioStore.getState();
    expect(after.workflows).toHaveLength(1);
    expect(after.activeWorkflowId).toBe(second);
  });
});

describe("image-studio-store 节点操作", () => {
  it("addGenerationGroup 文生图:提示词+成图+连线", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "山门" });

    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    expect(graph?.nodes).toHaveLength(2);
    expect(group.referenceNodeId).toBeUndefined();
    expect(
      graph?.edges.some((e) => e.source === group.promptNodeId && e.target === group.generatedNodeId),
    ).toBe(true);
  });

  it("addGenerationGroup 图生图:参考图+提示词+成图三件套双连线", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup({
      prompt: "山门",
      referenceImageUrl: "local-image://upload/ref.png",
    });

    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    expect(graph?.nodes).toHaveLength(3);
    expect(graph?.edges).toHaveLength(2);
    expect(
      graph?.edges.some((e) => e.source === group.referenceNodeId && e.target === group.generatedNodeId),
    ).toBe(true);
  });

  it("removeNode 级联清边并清理 nodeExtras", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "山门" });
    useImageStudioStore.getState().setNodeExtras(group.generatedNodeId, { stylization: 100 });

    useImageStudioStore.getState().removeNode(group.promptNodeId);

    const state = useImageStudioStore.getState();
    const graph = selectActiveImageStudioWorkflow(state);
    expect(graph?.nodes).toHaveLength(1);
    expect(graph?.edges).toHaveLength(0);
    expect(state.nodeExtras[group.promptNodeId]).toBeUndefined();
    expect(state.nodeExtras[group.generatedNodeId]).toEqual({ stylization: 100 });
  });

  it("connect 拒绝非成图目标(graph-build 边规则),prompt→prompt 不成边", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const first = useImageStudioStore.getState().addGenerationGroup({ prompt: "a" });
    const second = useImageStudioStore.getState().addGenerationGroup({ prompt: "b" });

    useImageStudioStore.getState().connect(second.promptNodeId, first.promptNodeId);
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    expect(graph?.edges).toHaveLength(2);

    // 成图→成图链式喂图合法
    useImageStudioStore.getState().connect(first.generatedNodeId, second.generatedNodeId);
    expect(selectActiveImageStudioWorkflow(useImageStudioStore.getState())?.edges).toHaveLength(3);
  });

  it("setNodeResult 置 ready 并带地址", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "a" });
    useImageStudioStore.getState().setNodeResult(group.generatedNodeId, {
      imageUrl: "local-image://ai-image/x.png",
      mediaId: "m-1",
    });
    const node = activeNodes().find((item) => item.id === group.generatedNodeId);
    expect(node).toMatchObject({
      status: "ready",
      resultUrl: "local-image://ai-image/x.png",
      resultMediaId: "m-1",
    });
  });

  it("生成生命周期写入按节点所在画布定位(生成期间切画布不串写)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const firstWorkflowId = useImageStudioStore.getState().activeWorkflowId as string;
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "a" });
    // 模拟生成期间用户切换到新画布
    useImageStudioStore.getState().createWorkflow();
    useImageStudioStore.getState().setNodeStatus(group.generatedNodeId, "generating");
    useImageStudioStore.getState().setNodeResult(group.generatedNodeId, {
      imageUrl: "local-image://ai-image/x.png",
    });

    const state = useImageStudioStore.getState();
    const owner = state.workflows.find((workflow) => workflow.id === firstWorkflowId);
    const other = state.workflows.find((workflow) => workflow.id !== firstWorkflowId);
    expect(
      owner?.nodes.find((node) => node.id === group.generatedNodeId),
    ).toMatchObject({ status: "ready", resultUrl: "local-image://ai-image/x.png" });
    expect(other?.nodes ?? []).toHaveLength(0);
  });

  it("画布删光后 add 类动作自愈默认画布", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    useImageStudioStore.getState().deleteWorkflow(
      useImageStudioStore.getState().activeWorkflowId as string,
    );
    expect(useImageStudioStore.getState().workflows).toHaveLength(0);

    useImageStudioStore.getState().addPromptNode({ prompt: "x" });

    const state = useImageStudioStore.getState();
    expect(state.workflows).toHaveLength(1);
    expect(state.workflows[0].nodes).toHaveLength(1);
    expect(state.activeWorkflowId).toBe(state.workflows[0].id);
  });
});

describe("image-studio-store 持久化纪律", () => {
  it("写入 localStorage 时剥离 data: 图片地址(防 dataURL 入库)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    useImageStudioStore.getState().addReferenceNode({ imageUrl: "data:image/png;base64,AAA" });

    const persisted = localStorage.getItem("mystudio-image-studio") ?? "";
    expect(persisted).not.toContain("data:image");
    const parsed = JSON.parse(persisted) as { state: { workflows: Array<{ nodes: Array<{ imageUrl?: string }> }> } };
    const reference = parsed.state.workflows[0].nodes.find((node) => "imageUrl" in node);
    expect((reference?.imageUrl ?? "").startsWith("data:")).toBe(false);
  });

  it("generating 状态经 setNodeStatus 写入后,持久化内容保留(水合复位由 rehydrate 钩子负责)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "a" });
    useImageStudioStore.getState().setNodeStatus(group.generatedNodeId, "generating");
    const persisted = localStorage.getItem("mystudio-image-studio") ?? "";
    expect(persisted).toContain('"status":"generating"');
  });
});
