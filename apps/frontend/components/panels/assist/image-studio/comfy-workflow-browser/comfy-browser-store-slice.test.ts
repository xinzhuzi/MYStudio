// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import type { ComfyWorkflowLibraryTree } from "@/lib/assist/image-studio/comfy-workflow-library";

/**
 * 浏览器态 slice(09-08 二期,只追加):新字段+新动作;
 * partialize 不列名=瞬态不持久化,持久化形状零变化。
 */

const initialState = useImageStudioStore.getState();

afterEach(() => {
  cleanup();
  useImageStudioStore.setState(initialState, true);
  localStorage.clear();
});

describe("image-studio-store ComfyUI 工作流浏览器态 slice", () => {
  it("初始态:浏览器字段全默认(关闭/空树/不加载)", () => {
    const state = useImageStudioStore.getState();
    expect(state.comfyBrowserOpen).toBe(false);
    expect(state.comfyBrowserSearch).toBe("");
    expect(state.comfyBrowserFolderId).toBeNull();
    expect(state.comfyBrowserSelectedId).toBeNull();
    expect(state.comfyBrowserTree).toBeNull();
    expect(state.comfyBrowserLoading).toBe(false);
    expect(state.comfyBrowserError).toBeNull();
  });

  it("六个动作分别落位:开关/搜索/选夹/选流/库快照/加载中", () => {
    const store = useImageStudioStore.getState();
    store.setComfyBrowserOpen(true);
    store.setComfyBrowserSearch("NSFW");
    store.selectComfyBrowserFolder("folder-1");
    store.selectComfyWorkflow("wf-9");
    store.setComfyBrowserLoading(true);

    const tree: ComfyWorkflowLibraryTree = {
      folders: [{ id: "folder-1", name: "K2", parentId: null }],
      workflows: [
        {
          id: "wf-9",
          name: "Krea2-NSFW专业流",
          folderId: "folder-1",
          nodeCount: 13,
          missingClassTypes: [],
          updatedAt: 1,
        },
      ],
    };
    store.setComfyBrowserLibrary(tree);

    const after = useImageStudioStore.getState();
    expect(after.comfyBrowserOpen).toBe(true);
    expect(after.comfyBrowserSearch).toBe("NSFW");
    expect(after.comfyBrowserFolderId).toBe("folder-1");
    expect(after.comfyBrowserSelectedId).toBe("wf-9");
    expect(after.comfyBrowserLoading).toBe(true);
    expect(after.comfyBrowserTree).toEqual(tree);

    after.setComfyBrowserLibrary(null, "读取失败");
    expect(useImageStudioStore.getState().comfyBrowserError).toBe("读取失败");
  });

  it("追加动作不触碰既有画布状态(共存互不干扰)", () => {
    const store = useImageStudioStore.getState();
    store.ensureDefaultWorkflow();
    store.setComfyBrowserOpen(true);
    const after = useImageStudioStore.getState();
    expect(after.workflows.length).toBe(1);
    expect(after.activeWorkflowId).not.toBeNull();
    // 画布动作照常
    store.addPromptNode({ prompt: "x" });
    const graph = after.workflows[0];
    expect(useImageStudioStore.getState().workflows[0].nodes.length).toBe(
      graph.nodes.length + 1,
    );
  });

  it("persist partialize 不含浏览器态:瞬态字段不进项目分片", () => {
    const store = useImageStudioStore.getState();
    store.setComfyBrowserOpen(true);
    store.selectComfyWorkflow("wf-1");
    store.setComfyBrowserSearch("q");
    const partialized = useImageStudioStore.persist.getOptions().partialize!(
      useImageStudioStore.getState(),
    ) as Record<string, unknown>;
    expect(Object.keys(partialized).sort()).toEqual([
      "activeWorkflowId",
      "nodeExtras",
      "workflows",
    ]);
  });
});
