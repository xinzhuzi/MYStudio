// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyWorkflowBrowser } from "./comfy-workflow-browser";
import { createComfyWorkflowLibraryClient, createInMemoryComfyWorkflowLibraryTransport } from "@/lib/assist/image-studio/comfy-workflow-library";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import { useStudioStore } from "@/stores/studio/studio-store";

/**
 * 浏览器组件(09-08 二期):搜索/文件夹树(数量徽章)/列表(节点数+
 * 缺失插件红标)/选中高亮/onSelect 接线点。数据走内存 mock(与真实
 * 通道同契约)。
 */

function smallWorkflow(name: string): string {
  // 2 节点小流,缺插件口径由 availableClassTypes 控制
  void name;
  return JSON.stringify({
    "1": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["0", 0] } },
    "0": { class_type: "CLIPLoader", inputs: { clip_name: "a.safetensors" } },
  });
}

function nsfwWorkflow(): string {
  return JSON.stringify({
    "1": { class_type: "ConditioningKrea2Rebalance", inputs: { conditioning: ["0", 0], multiplier: 1.0 } },
    "0": { class_type: "CLIPLoader", inputs: { clip_name: "a.safetensors" } },
  });
}

function renderBrowser(options?: {
  availableClassTypes?: string[];
  deleteScanReferences?: { kind: string; name: string }[];
  onSelectWorkflow?: (workflowId: string) => void;
}) {
  const transport = createInMemoryComfyWorkflowLibraryTransport({
    folders: [{ id: "f-nsfw", name: "NSFW", parentId: null }],
    workflows: [
      { name: "K2 文生图", content: smallWorkflow("t2i"), folderId: null },
      { name: "Krea2-NSFW专业流", content: nsfwWorkflow(), folderId: "f-nsfw" },
    ],
    availableClassTypes: options?.availableClassTypes ?? ["CLIPTextEncode", "CLIPLoader", "ConditioningKrea2Rebalance"],
    deleteScanReferences: options?.deleteScanReferences,
  });
  const client = createComfyWorkflowLibraryClient(transport);
  return {
    transport,
    client,
    ...render(
      <ComfyWorkflowBrowser
        client={client}
        onSelectWorkflow={options?.onSelectWorkflow}
        onClose={() => {}}
      />,
    ),
  };
}

const storeInitial = useImageStudioStore.getState();

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(storeInitial, true);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("ComfyWorkflowBrowser 浏览器侧栏", () => {
  it("树+徽章+列表:根层与文件夹数量、节点数徽章、缺失插件红标", async () => {
    renderBrowser({ availableClassTypes: ["CLIPLoader"] }); // CLIPTextEncode/Rebalance 缺
    await waitFor(() => {
      expect(screen.getByText("K2 文生图")).toBeTruthy();
    });
    // 树徽章:全部(根层 1)+ NSFW(1)
    expect(screen.getByText("全部工作流").parentElement?.textContent).toContain("1");
    expect(screen.getByText("NSFW").parentElement?.textContent).toContain("1");
    // 列表只显示当前文件夹(根层):K2 文生图,带节点数徽章与缺插件红标
    expect(screen.getByText("2 节点")).toBeTruthy();
    expect(screen.getAllByText(/缺 \d+ 插件/).length).toBe(1);
  });

  it("点文件夹切换列表;点条目=选中高亮(data-selected)", async () => {
    renderBrowser();
    await waitFor(() => {
      expect(screen.getByText("K2 文生图")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("treeitem", { name: /NSFW/ }));
    await waitFor(() => {
      expect(screen.getByText("Krea2-NSFW专业流")).toBeTruthy();
    });
    expect(screen.queryByText("K2 文生图")).toBeNull();

    const row = screen.getByText("Krea2-NSFW专业流").closest("[data-comfy-browser-workflow]");
    expect(row?.getAttribute("data-selected")).toBeNull();
    fireEvent.click(screen.getByText("Krea2-NSFW专业流"));
    const selected = screen.getByText("Krea2-NSFW专业流").closest("[data-comfy-browser-workflow]");
    expect(selected?.getAttribute("data-selected")).toBe("true");
    expect(useImageStudioStore.getState().comfyBrowserSelectedId).toBe(
      (selected as HTMLElement).getAttribute("data-comfy-browser-workflow"),
    );
  });

  it("搜索跨文件夹过滤:命中条目即时收窄", async () => {
    renderBrowser();
    await waitFor(() => {
      expect(screen.getByText("K2 文生图")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("搜索工作流"), { target: { value: "nsfw专业" } });
    expect(screen.getByText("Krea2-NSFW专业流")).toBeTruthy();
    expect(screen.queryByText("K2 文生图")).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索工作流"), { target: { value: "不存在的词" } });
    expect(screen.getByText("没有匹配的工作流")).toBeTruthy();
  });

  it("onSelectWorkflow 接线点:选中后出现「导入成节点卡」,点击回传 id;未接线不显示", async () => {
    const onSelect = vi.fn();
    renderBrowser({ onSelectWorkflow: onSelect });
    await waitFor(() => {
      expect(screen.getByText("K2 文生图")).toBeTruthy();
    });
    expect(screen.queryByText("导入成节点卡")).toBeNull();
    fireEvent.click(screen.getByText("K2 文生图"));
    fireEvent.click(screen.getByText("导入成节点卡"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const row = screen.getByText("K2 文生图").closest("[data-comfy-browser-workflow]");
    expect(onSelect).toHaveBeenCalledWith((row as HTMLElement).getAttribute("data-comfy-browser-workflow"));
  });
});

describe("ComfyWorkflowBrowser 未接线独立运行", () => {
  it("不传 onSelectWorkflow 也能完整渲染(集成前 UI 可独立开发)", async () => {
    renderBrowser();
    await waitFor(() => {
      expect(screen.getByText("K2 文生图")).toBeTruthy();
    });
    expect(screen.queryByText("导入成节点卡")).toBeNull();
    expect(screen.getByText("从外部导入…")).toBeTruthy();
    expect(screen.getByText("新建文件夹")).toBeTruthy();
  });
});

describe("ComfyWorkflowBrowser 存量画布批量迁移入口(阶段2 批2)", () => {
  it("按钮显示存量计数;点击→迁移入库→刷新后「迁移 ·」条目可见", async () => {
    useStudioStore.setState({
      imageWorkflows: [
        {
          id: "wf-x", name: "道劫41", target: { kind: "storyboard", id: "sb-1" },
          nodes: [
            { id: "p1", type: "prompt", prompt: "山", aspectRatio: "1:1", position: { x: 0, y: 0 } } as never,
            { id: "g1", type: "generated", prompt: "", aspectRatio: "1:1", status: "idle", position: { x: 1, y: 1 } } as never,
          ],
          edges: [{ id: "e1", source: "p1", target: "g1" }] as never,
          createdAt: 0, updatedAt: 0,
        } as never,
      ],
    });
    try {
      renderBrowser();
      const button = await waitFor(() => screen.getByText("导入存量画布(1)"));
      fireEvent.click(button);
      await waitFor(() => {
        expect(screen.getByText(/迁移 · 道劫41/)).toBeTruthy();
      });
    } finally {
      useStudioStore.setState({ imageWorkflows: [] });
    }
  });

  it("零存量:按钮禁用", async () => {
    useStudioStore.setState({ imageWorkflows: [] });
    renderBrowser();
    await waitFor(() => {
      const button = screen.getByText("导入存量画布(0)").closest("button");
      expect(button?.hasAttribute("disabled")).toBe(true);
    });
  });
});
