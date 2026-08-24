// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";

const freedomImage = vi.hoisted(() => vi.fn());
const saveImage = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { freedomImage } }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({ saveImage }),
}));
vi.mock("@/lib/bridge/studio-assets", () => ({ getStudioAssetsBridge: () => null }));
vi.mock("@/lib/studio/visual-manual-style-tokens", () => ({
  // 手册装配链 fail-empty 形态:无手册内容/阵营数据时建流退化为裸描述
  withActiveVisualManualStoryboardStyleTokens: (prompt: string) => prompt,
  getExtendedStoryboardManualContent: () => "",
  parseStoryboardFrameTemplates: () => [],
  selectStoryboardFrameTemplate: () => null,
  getExtendedStoryboardFactionData: () => ({ members: {}, palette: {} }),
  getExtendedStoryboardFrameNegative: () => "",
  EXTENDED_STORYBOARD_STYLE_TOKENS: [],
}));
vi.mock("./storyboard-asset-references", () => ({
  resolveStoryboardAssetReferences: async () => [],
}));

import { useStoryboardBatchGeneration } from "./use-storyboard-batch-generation";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";

const initialStudioState = useStudioStore.getState();
const initialProjectState = useProjectStore.getState();

function shot(partial: Partial<StoryboardItem>): StoryboardItem {
  return {
    id: partial.id ?? "sb-1",
    episodeId: "chapter-001",
    index: partial.index ?? 1,
    trackKey: "001-1",
    trackId: "",
    duration: 6,
    prompt: partial.prompt ?? "矿奴队列压过石板。",
    assetIds: [],
    shouldGenerateImage: true,
    state: "idle",
    ...partial,
  } as StoryboardItem;
}

function resetStore(storyboards: StoryboardItem[]) {
  useStudioStore.setState(
    { ...initialStudioState, storyboards, imageWorkflows: [], materials: [] },
    true,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.setState({ ...initialProjectState, activeProjectId: "proj" });
  saveImage.mockImplementation(async (_payload: unknown) => ({
    success: true,
    url: "project-file://proj/workflow/gen-out.png",
    size: 10,
  }));
});

afterEach(() => {
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
});

describe("useStoryboardBatchGeneration(一键生图串行批量)", () => {
  it("skips generated shots, writes mediaRef back for success, and continues past failure in index order", async () => {
    resetStore([
      shot({ id: "sb-1", index: 1, mediaRef: { kind: "image", path: "project-file://a.png" } as StoryboardItem["mediaRef"] }),
      shot({ id: "sb-2", index: 2 }),
      shot({ id: "sb-3", index: 3 }),
    ]);
    const callOrder: number[] = [];
    freedomImage.mockImplementation(async () => {
      const index = callOrder.length === 0 ? 2 : 3;
      callOrder.push(index);
        if (index === 2) return { url: "https://provider.test/ok.png" };
      throw new Error("provider down");
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });
    expect(callOrder).toEqual([2, 3]);
    const store = useStudioStore.getState();
    const sb2 = store.storyboards.find((item) => item.id === "sb-2")!;
    expect(sb2.mediaRef).toMatchObject({ kind: "image", path: "project-file://proj/workflow/gen-out.png" });
    expect(sb2.state).toBe("ready");
    expect(sb2.imageWorkflowId).toBeTruthy();
    const sb3 = store.storyboards.find((item) => item.id === "sb-3")!;
    expect(sb3.mediaRef?.kind).not.toBe("image");
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("分镜 3"));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("成功 1"));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("失败 1"));
    expect(result.current.state).toMatchObject({ total: 2, done: 2, failed: 1, currentShotIndex: null });
  });

  it("stops after the current shot when stop() is requested mid-run", async () => {
    resetStore([shot({ id: "sb-1", index: 1 }), shot({ id: "sb-2", index: 2 })]);
    const resolvers: Array<() => void> = [];
    freedomImage.mockImplementation(() => new Promise<{ url: string }>((resolve) => {
      resolvers.push(() => resolve({ url: "https://provider.test/ok.png" }));
    }));

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(resolvers.length).toBe(1));
    act(() => result.current.stop());
    await act(async () => { resolvers[0]!(); });
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });

    expect(freedomImage).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!.mediaRef?.kind).toBe("image");
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "sb-2")!.mediaRef?.kind).not.toBe("image");
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("已停止"));
  });

  it("ignores re-entry while a batch is already running", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    const resolvers: Array<() => void> = [];
    freedomImage.mockImplementation(() => new Promise<{ url: string }>((resolve) => {
      resolvers.push(() => resolve({ url: "https://provider.test/ok.png" }));
    }));

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    act(() => result.current.start()); // 重入被忽略
    await waitFor(() => expect(resolvers.length).toBe(1));
    await act(async () => { resolvers[0]!(); });
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });

    expect(freedomImage).toHaveBeenCalledTimes(1);
  });

  it("no-ops with a hint when every shot already has an image", () => {
    resetStore([
      shot({ id: "sb-1", index: 1, mediaRef: { kind: "image", path: "project-file://a.png" } as StoryboardItem["mediaRef"] }),
    ]);
    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    expect(freedomImage).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("所有分镜都已生成画面");
    expect(result.current.state.running).toBe(false);
  });
});
