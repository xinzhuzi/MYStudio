// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { describe, expect, it } from "vitest";
import { selectActiveImageStudioWorkflow, useImageStudioStore } from "./image-studio-store";

/** 09-03 wave3:便利贴/分组框——建、改、复制、连线域豁免 */

const initial = useImageStudioStore.getState();

describe("image-studio 便利贴/分组框(09-03 wave3)", () => {
  it("建便利贴:默认黄+可换色+文本可改", () => {
    useImageStudioStore.setState(initial, true);
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const id = useImageStudioStore.getState().addStickyNote({ text: "第三镜加雨" });
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    const sticky = graph.nodes.find((node) => node.id === id);
    expect(sticky).toMatchObject({ type: "sticky", text: "第三镜加雨", color: "yellow" });
    useImageStudioStore.getState().updateNode(id, { color: "pink" });
    const updated = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!.nodes.find((n) => n.id === id);
    expect(updated).toMatchObject({ color: "pink" });
  });

  it("建分组框:label 默认分组,成员可空", () => {
    useImageStudioStore.setState(initial, true);
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const id = useImageStudioStore.getState().addGroup();
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    expect(graph.nodes.find((node) => node.id === id)).toMatchObject({
      type: "group",
      title: "分组",
      memberIds: [],
    });
  });

  it("复制便利贴:携文本与颜色,标题加副本", () => {
    useImageStudioStore.setState(initial, true);
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const id = useImageStudioStore.getState().addStickyNote({ text: "备忘", color: "blue" });
    const newId = useImageStudioStore.getState().duplicateNode(id)!;
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    expect(graph.nodes.find((node) => node.id === newId)).toMatchObject({
      type: "sticky",
      text: "备忘",
      color: "blue",
      title: "便利贴 副本",
    });
  });

  it("连线域豁免:便利贴连成图被拒(标注件不进生成图)", () => {
    useImageStudioStore.setState(initial, true);
    useImageStudioStore.getState().ensureDefaultWorkflow();
    const group = useImageStudioStore.getState().addGenerationGroup();
    const stickyId = useImageStudioStore.getState().addStickyNote();
    useImageStudioStore.getState().connect(stickyId, group.generatedNodeId);
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState())!;
    expect(graph.edges.some((edge) => edge.source === stickyId)).toBe(false);
  });
});
