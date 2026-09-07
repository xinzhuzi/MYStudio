// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, describe, expect, it } from "vitest";
import {
  sanitizeWorkflowsForPersist,
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "./image-studio-store";
import { buildImageStudioGenerationRequest } from "@/lib/assist/image-studio/request";
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

  it("addGenerationGroup 空串参考图=空参考图位直建(图生图入口零弹窗,09-03 用户裁定)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup({
      referenceImageUrl: "",
    });

    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    // 三件套+双连线与带图形态一致;参考图节点为空(用户在节点内上传/拖图)
    expect(graph?.nodes).toHaveLength(3);
    expect(graph?.edges).toHaveLength(2);
    const reference = graph?.nodes.find((node) => node.id === group.referenceNodeId);
    expect(reference?.type).toBe("reference");
    if (reference?.type === "reference") {
      expect(reference.imageUrl).toBe("");
    }
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

  it("updateNodeInOwnerWorkflow 定向落发起画布(09-04 挂账③:uncloth 回显切走不丢)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const firstWorkflowId = useImageStudioStore.getState().activeWorkflowId as string;
    const prompt = useImageStudioStore.getState().addPromptNode({ prompt: "a" });
    // 生成期间切到新画布(active=画布 2,节点全在画布 1)
    useImageStudioStore.getState().createWorkflow();

    useImageStudioStore.getState().updateNodeInOwnerWorkflow(prompt, { prompt: "改后" });

    const state = useImageStudioStore.getState();
    const owner = state.workflows.find((workflow) => workflow.id === firstWorkflowId);
    const other = state.workflows.find((workflow) => workflow.id !== firstWorkflowId);
    expect(owner?.nodes.find((node) => node.id === prompt)).toMatchObject({ prompt: "改后" });
    expect(other?.nodes ?? []).toHaveLength(0);
    // 对照:updateNode(active 定位)在同样场景下找不到节点=静默丢弃,即挂账原病灶
    expect(activeNodes()).toHaveLength(0);
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

describe("image-studio-store NSFW破限节点全生命周期(09-07-nsfw-pro-node)", () => {
  function setupChain() {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const store = useImageStudioStore.getState();
    const promptId = store.addPromptNode({ prompt: "经链提示词" });
    const nsfwId = store.addNsfwNode();
    const groupId = store.addGenerationGroup({ prompt: "组内直连" });
    // 断开建组时的直连提示词边,换成 nsfw 链(模拟用户改线)
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    const groupPromptEdge = graph?.edges.find(
      (edge) => edge.source === groupId.promptNodeId && edge.target === groupId.generatedNodeId,
    );
    if (groupPromptEdge) useImageStudioStore.getState().removeEdge(groupPromptEdge.id);
    useImageStudioStore.getState().connect(promptId, nsfwId);
    useImageStudioStore.getState().connect(nsfwId, groupId.generatedNodeId);
    return { promptId, nsfwId, generatedNodeId: groupId.generatedNodeId };
  }

  it("创建:addNsfwNode 入图,类型/默认标题正确;串链后请求走链", () => {
    const ids = setupChain();
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    expect(graph.nodes.find((node) => node.id === ids.nsfwId)).toMatchObject({
      type: "nsfw",
      title: "NSFW破限",
    });
    expect(graph.edges).toHaveLength(2);
    const request = buildImageStudioGenerationRequest(graph, ids.generatedNodeId);
    expect(request.prompt).toBe("经链提示词");
    expect(request.nsfwPro).toBe(true);
  });

  it("更新:updateNode 改标题/拖动位置(通用路径,nsfw 无专字段)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const nsfwId = useImageStudioStore.getState().addNsfwNode();
    useImageStudioStore.getState().updateNode(nsfwId, { title: "我的破限" } as never);
    const node = activeNodes().find((item) => item.id === nsfwId);
    expect(node?.title).toBe("我的破限");
  });

  it("复制:duplicateNode 生成 nsfw 副本(fall-through 误建成图的回归钉)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const nsfwId = useImageStudioStore.getState().addNsfwNode();
    const copyId = useImageStudioStore.getState().duplicateNode(nsfwId);
    expect(copyId).toBeTruthy();
    const copy = activeNodes().find((item) => item.id === copyId);
    expect(copy?.type).toBe("nsfw");
    expect(copy?.title).toBe("NSFW破限 副本");
  });

  it("删除:removeNode 删破限节点,两条链边级联清空,生成回落普通流", () => {
    const ids = setupChain();
    useImageStudioStore.getState().removeNode(ids.nsfwId);
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    expect(graph.edges).toHaveLength(0);
    // 链断后请求不再置 nsfwPro(成图内联回落)
    const request = buildImageStudioGenerationRequest(graph, ids.generatedNodeId);
    expect(request.nsfwPro).toBeFalsy();
  });

  it("断链互斥恢复:断开 nsfw→成图 边后,直连提示词边重新合法", () => {
    const ids = setupChain();
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    const chainEdge = graph.edges.find(
      (edge) => edge.source === ids.nsfwId && edge.target === ids.generatedNodeId,
    )!;
    useImageStudioStore.getState().removeEdge(chainEdge.id);

    // 互斥是动态的:nsfw 链断开后 prompt 直连不再被拒
    useImageStudioStore.getState().connect(ids.promptId, ids.generatedNodeId);
    const after = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    expect(
      after.edges.some((edge) => edge.source === ids.promptId && edge.target === ids.generatedNodeId),
    ).toBe(true);
  });

  it("导入:含 nsfw 链的画布 JSON 保真(节点与两条边不丢)", () => {
    const ids = setupChain();
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    // 模拟导出 payload(handleExportCanvas 全量导出)
    const payload = {
      schemaVersion: 1,
      name: graph.name,
      nodes: graph.nodes,
      edges: graph.edges,
    };
    const result = useImageStudioStore.getState().importWorkflow(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const imported = useImageStudioStore.getState().workflows.find((w) => w.id === result.id)!;
    expect(imported.nodes.find((node) => node.id === ids.nsfwId)?.type).toBe("nsfw");
    expect(imported.edges).toHaveLength(2);
    expect(
      imported.edges.some((e) => e.source === ids.nsfwId && e.target === ids.generatedNodeId),
    ).toBe(true);
  });
});

describe("image-studio-store 持久化纪律", () => {
  it("持久化净化剥离 data: 图片地址(防 dataURL 入库)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    useImageStudioStore.getState().addReferenceNode({ imageUrl: "data:image/png;base64,AAA" });
    const sanitized = sanitizeWorkflowsForPersist(useImageStudioStore.getState().workflows);
    expect(JSON.stringify(sanitized)).not.toContain("data:image");
    const reference = sanitized[0].nodes.find((node) => "imageUrl" in node);
    expect((reference?.imageUrl ?? "").startsWith("data:")).toBe(false);
  });

  it("generating 状态经 setNodeStatus 写入后,持久化内容保留(水合复位由 rehydrate 钩子负责)", () => {
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup({ prompt: "a" });
    useImageStudioStore.getState().setNodeStatus(group.generatedNodeId, "generating");
    const sanitized = sanitizeWorkflowsForPersist(useImageStudioStore.getState().workflows);
    const generated = sanitized[0].nodes.find((node) => node.id === group.generatedNodeId);
    expect(generated && generated.type === "generated" ? generated.status : undefined).toBe("generating");
  });
});
