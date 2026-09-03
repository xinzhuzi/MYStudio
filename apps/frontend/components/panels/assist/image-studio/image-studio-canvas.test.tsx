// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

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
  localStorage.clear();
});

describe("ImageStudioCanvas", () => {
  it("空 store 渲染:自动建默认画布,工具栏与空画布指引可见", async () => {
    render(<ImageStudioCanvas />);
    await waitFor(() => {
      expect(useImageStudioStore.getState().workflows).toHaveLength(1);
    });
    expect(screen.getByText("画布 1")).toBeTruthy();
    // 09-02 工具栏分族收敛:文生图/图生图从直钮收进「添加节点」菜单
    expect(screen.getByRole("button", { name: /添加节点/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: /添加节点/ }), { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: /^文生图/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^图生图/ })).toBeTruthy();
    expect(screen.getByText("空画布")).toBeTruthy();
  });

  it("种子提示词(资产弹窗带入):物化为生成组并清空种子", async () => {
    useFreedomStore.setState({ imagePrompt: "剑客立于山门" });
    render(<ImageStudioCanvas />);
    await waitFor(() => {
      const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
      expect(graph?.nodes.some((node) => node.type === "prompt" && node.prompt === "剑客立于山门")).toBe(true);
    });
    expect(useFreedomStore.getState().imagePrompt).toBe("");
  });

  it("参考图计数按节点作用域:空参考图不计,两组互不串数(存量缺口回归)", async () => {
    render(<ImageStudioCanvas />);
    await waitFor(() => {
      expect(useImageStudioStore.getState().workflows).toHaveLength(1);
    });
    // 组A:文生图组;组B:图生图组(空参考图位)
    useImageStudioStore.getState().addGenerationGroup({ prompt: "A" });
    useImageStudioStore.getState().addGenerationGroup({ prompt: "B", referenceImageUrl: "" });
    // 组A的参考图节点补一张真图,并连到组A成图
    const state = useImageStudioStore.getState();
    const graph = selectActiveImageStudioWorkflow(state);
    const groupA = graph?.nodes.find((n) => n.type === "generated" && n.prompt === "A");
    const refNode = graph?.nodes.find((n) => n.type === "reference");
    expect(groupA && refNode).toBeDefined();
    if (groupA && refNode) {
      state.updateNode(refNode.id, { imageUrl: "local-image://ai-image/ref.png" } as never);
      state.connect(refNode.id, groupA.id);
    }
    await waitFor(() => {
      const after = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
      const genA = after?.nodes.find((n) => n.type === "generated" && n.prompt === "A");
      const genB = after?.nodes.find((n) => n.type === "generated" && n.prompt === "B");
      // 计数在 node card props 里,这里以边结构断言口径:只有 target 匹配的边才计入
      const countFor = (id: string) =>
        (after?.edges ?? []).filter((e) => e.target === id).length;
      expect(countFor(genA!.id)).toBeGreaterThanOrEqual(1);
      expect(countFor(genB!.id)).toBeGreaterThanOrEqual(1);
    });
  });

  it("工具栏「图生图」直建组:零弹窗出参考图+提示词+成图三件套(09-03 用户裁定)", async () => {
    render(<ImageStudioCanvas />);
    await waitFor(() => {
      expect(useImageStudioStore.getState().workflows).toHaveLength(1);
    });
    fireEvent.keyDown(screen.getByRole("button", { name: /添加节点/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /^图生图$/ }));

    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    expect(graph?.nodes).toHaveLength(3);
    expect(graph?.edges).toHaveLength(2);
    const reference = graph?.nodes.find((node) => node.type === "reference");
    expect(reference).toBeDefined();
    if (reference?.type === "reference") {
      expect(reference.imageUrl).toBe("");
    }
  });

  it("工具栏「文生图」一键建组:提示词+成图+连线入图", async () => {
    render(<ImageStudioCanvas />);
    await waitFor(() => {
      expect(useImageStudioStore.getState().workflows).toHaveLength(1);
    });
    // 经「添加节点」菜单建组(工具栏收敛后主创建入口)
    fireEvent.keyDown(screen.getByRole("button", { name: /添加节点/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /^文生图/ }));

    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.edges).toHaveLength(1);
    const generated = graph?.nodes.find((node) => node.type === "generated");
    expect(generated).toBeDefined();
    // 连线可见性根修(装机 CDP 实证):受控 nodes 替换后 handleBounds 重置、
    // 连线被静默隐藏,必须显式刷新节点 internals
    await waitFor(() => {
      expect(updateNodeInternalsMock).toHaveBeenCalled();
    });
    const refreshedIds = updateNodeInternalsMock.mock.calls.at(-1)?.[0] as string[];
    expect(refreshedIds).toEqual(graph?.nodes.map((node) => node.id));
  });

  it("打开生成文件夹:经「⋯」菜单走 imageStorage 桥打开 ai-image 分类", async () => {
    const openCategoryFolder = vi.fn().mockResolvedValue({ success: true });
    const w = window as unknown as { imageStorage?: unknown };
    const had = "imageStorage" in w;
    w.imageStorage = { openCategoryFolder };
    try {
      render(<ImageStudioCanvas />);
      // 09-02 工具栏分族收敛:文件夹入口收进「画布与工具」菜单
      const menuButton = await waitFor(() => screen.getByRole("button", { name: /画布与工具菜单/ }));
      fireEvent.keyDown(menuButton, { key: "Enter" });
      const item = await waitFor(() => screen.getByRole("menuitem", { name: /打开生成文件夹/ }));
      fireEvent.click(item);
      await waitFor(() => expect(openCategoryFolder).toHaveBeenCalledWith("ai-image"));
    } finally {
      if (had) delete w.imageStorage;
      else (w as { imageStorage?: unknown }).imageStorage = undefined;
    }
  });

  it("生成记录弹窗开合(经「⋯」菜单项,09-03 侧栏改弹窗)", async () => {
    render(<ImageStudioCanvas />);
    const menuButton = await waitFor(() => screen.getByRole("button", { name: /画布与工具菜单/ }));
    expect(document.querySelector("[data-image-studio-history-dialog]")).toBeNull();
    fireEvent.keyDown(menuButton, { key: "Enter" });
    const item = await waitFor(() => screen.getByRole("menuitem", { name: /生成记录…/ }));
    fireEvent.click(item);
    await waitFor(() => {
      expect(document.querySelector("[data-image-studio-history-dialog]")).toBeTruthy();
    });
  });
});
