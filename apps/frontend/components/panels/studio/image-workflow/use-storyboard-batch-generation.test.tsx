// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";

const freedomImage = vi.hoisted(() => vi.fn());
const saveImage = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { freedomImage } }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({ saveImage }),
}));
const assetsBridge = vi.hoisted(() => ({ readImageDataUrl: null as null | ((id: string) => Promise<string>) }));
vi.mock("@/lib/bridge/studio-assets", () => ({ getStudioAssetsBridge: () => (assetsBridge.readImageDataUrl ? { readImageDataUrl: assetsBridge.readImageDataUrl } : null) }));
vi.mock("@/lib/studio/visual-manual-style-tokens", () => ({
  // 手册装配链 fail-empty 形态:无手册内容/阵营数据时建流退化为裸描述
  withActiveVisualManualStoryboardStyleTokens: (prompt: string) => prompt,
  // 非道劫/未预热语义:不进分镜帧编译(enhanced 传输原样)
  compileActiveDaojieStoryboardFramePrompt: async () => null,
  getExtendedStoryboardManualContent: () => "",
  parseStoryboardFrameTemplates: () => [],
  selectStoryboardFrameTemplate: () => null,
  getExtendedStoryboardFactionData: () => ({ members: {}, palette: {} }),
  getExtendedStoryboardFrameNegative: () => "",
  EXTENDED_STORYBOARD_STYLE_TOKENS: [],
}));
const resolvedReferences = vi.hoisted(() => ({ value: [] as Array<{ imageUrl: string; title: string; assetType: string; assetId?: string }> }));
vi.mock("./storyboard-asset-references", () => ({
  resolveStoryboardAssetReferences: async () => resolvedReferences.value,
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


function createBareStoryboardGraph(storyboardId: string, workflowId: string) {
  const context = {
    target: { kind: "storyboard", id: storyboardId },
    title: "分镜 1",
    prompt: "测试画面",
    storyboardSourceFingerprint: "fp-1",
  };
  const now = 1;
  return {
    id: workflowId,
    name: "G",
    target: context.target,
    targetSourceFingerprint: "fp-1",
    nodes: [
      { id: "gen-x", type: "generated", title: "分镜 1 成图", prompt: "测试画面", aspectRatio: "16:9", quality: "standard", status: "idle", position: { x: 600, y: 120 }, createdAt: now, updatedAt: now },
      { id: "prompt-x", type: "prompt", title: "图片生成", prompt: "测试画面", aspectRatio: "16:9", quality: "standard", targetNodeId: "gen-x", position: { x: 560, y: 500 }, createdAt: now, updatedAt: now },
    ],
    edges: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as ImageWorkflowGraph;
}

describe("useStoryboardBatchGeneration(一键生图串行批量)", () => {
  it("retries once via chat transport when the images endpoint succeeds but the URL download fails (504 类丢图根修)", async () => {
    resetStore([
      shot({ id: "sb-1", index: 1 }),
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let saveCalls = 0;
    saveImage.mockImplementation(async (_payload: unknown) => {
      saveCalls += 1;
      if (saveCalls === 1) return { success: false, error: "504 download timeout" };
      return { success: true, url: "project-file://proj/workflow/gen-out.png", size: 10 };
    });
    freedomImage.mockImplementation(async (params: { transport?: string }) => {
      if (params?.transport === "chat") return { url: "data:image/png;base64,QQ==" };
      return { url: "https://cdn.test/remote.png" };
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });

    expect(freedomImage).toHaveBeenCalledTimes(2);
    expect(freedomImage.mock.calls[0][0].transport).toBeUndefined();
    expect(freedomImage.mock.calls[1][0].transport).toBe("chat");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("回退 chat base64"), expect.anything());
    const sb1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(sb1.mediaRef).toMatchObject({ kind: "image", path: "project-file://proj/workflow/gen-out.png" });
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 0 });
    warnSpy.mockRestore();
  });

  it("does not burn a chat retry when the failed save source is not a remote http URL", async () => {
    resetStore([
      shot({ id: "sb-1", index: 1 }),
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    saveImage.mockImplementation(async (_payload: unknown) => ({ success: false, error: "disk full" }));
    freedomImage.mockImplementation(async () => ({ url: "data:image/png;base64,QQ==" }));

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });

    expect(freedomImage).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 1 });
    warnSpy.mockRestore();
  });

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
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("分镜 3"), expect.anything());
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("成功 1"));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("失败 1"));
    expect(result.current.state).toMatchObject({ total: 2, done: 2, failed: 1, currentShotIndex: null });
  });

  it("M3a 多帧镜按空槽帧串行生成并逐帧回写 keyframes(帧间链保序)", async () => {
    resetStore([
      shot({
        id: "sb-kf", index: 1, duration: 12, durationTarget: 12,
        keyframes: [
          { frameId: "sb-kf-kf-1", mediaRef: { kind: "image", path: "" }, inUs: 0 },
          { frameId: "sb-kf-kf-2", mediaRef: { kind: "image", path: "" }, inUs: 6_000_000 },
        ],
      }),
    ]);
    const genCalls: string[] = [];
    freedomImage.mockImplementation(async () => {
      genCalls.push(`call-${genCalls.length + 1}`);
      return { url: `https://provider.test/kf-${genCalls.length}.png` };
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });

    // 两帧都生成(建流克隆出的两对帧节点各一次)
    expect(genCalls).toHaveLength(2);
    const store = useStudioStore.getState();
    const updated = store.storyboards.find((item) => item.id === "sb-kf")!;
    expect(updated.keyframes).toHaveLength(2);
    expect(updated.keyframes?.every((frame) => frame.mediaRef.path.includes("gen-out.png"))).toBe(true);
    // I1 首帧镜像同步
    expect(updated.mediaRef?.path).toBe(updated.keyframes?.[0].mediaRef.path);
    // 进度按帧计
    expect(result.current.state).toMatchObject({ total: 2, done: 2, failed: 0, currentShotIndex: null });
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
    expect(toast.info).toHaveBeenCalledWith("所有分镜画面均已齐备");
    expect(result.current.state.running).toBe(false);
  });

  it("prefers the reference-bearing workflow when duplicate matches exist, and backfills references on a bare one (身份防线)", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    resolvedReferences.value = [
      { imageUrl: "file://assets/ref-scene.png", title: "金水河码头", assetType: "scene", assetId: "sc-1" },
      { imageUrl: "file://assets/ref-zhaosi.png", title: "监工赵四", assetType: "character", assetId: "ch-1" },
    ];
    const bareGraph = createBareStoryboardGraph("sb-1", "wf-bare");
    const richGraph = {
      ...createBareStoryboardGraph("sb-1", "wf-rich"),
      id: "wf-rich",
      edges: [{ id: "existing-ref->gen-x", source: "existing-ref", target: "gen-x" }],
      nodes: [
        ...createBareStoryboardGraph("sb-1", "wf-rich").nodes.filter((n) => n.type !== "reference"),
        {
          id: "existing-ref", type: "reference", title: "监工赵四",
          imageUrl: "file://assets/ref-zhaosi.png",
          source: { kind: "asset", assetType: "character", id: "ch-1" },
          position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1,
        } as never,
      ],
    } as unknown as ImageWorkflowGraph;
    // 空壳排在前面(历史数组序)——择优必须跳过它
    useStudioStore.setState({ imageWorkflows: [bareGraph, richGraph] });

    freedomImage.mockResolvedValue({ url: "https://provider.test/ok.png" });
    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    // 择优:生成走了带参考的 wf-rich(其既有参考直接生效)
    expect(freedomImage.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-zhaosi.png");
    // 空壳 wf-bare 未被补挂(未被选中)
    const bareInStore = useStudioStore.getState().imageWorkflows.find((g) => g.id === "wf-bare");
    expect(bareInStore?.nodes.some((n) => n.type === "reference")).toBe(false);
  });

  it("backfills resolved references onto a bare matched workflow before generating (S08 形态修复)", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    resolvedReferences.value = [
      { imageUrl: "file://assets/ref-scene.png", title: "金水河码头", assetType: "scene", assetId: "sc-1" },
      { imageUrl: "file://assets/ref-zhaosi.png", title: "监工赵四", assetType: "character", assetId: "ch-1" },
    ];
    useStudioStore.setState({ imageWorkflows: [createBareStoryboardGraph("sb-1", "wf-bare")] });
    freedomImage.mockResolvedValue({ url: "https://provider.test/ok.png" });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    const stored = useStudioStore.getState().imageWorkflows.find((g) => g.id === "wf-bare");
    const refTitles = stored?.nodes.filter((n) => n.type === "reference").map((n) => n.title);
    expect(refTitles).toEqual(["金水河码头", "监工赵四"]);
    expect(freedomImage.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-scene.png");
    expect(freedomImage.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-zhaosi.png");
    // 补挂的参考连向成图节点
    const genId = stored?.nodes.find((n) => n.type === "generated")?.id;
    expect(stored?.edges.some((e) => e.source === "existing-ref" || (e.target === genId && e.source !== "existing-ref"))).toBe(true);
  });

  it("completes generation when workflows carry no fingerprint (旧建流形态不炸)", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    const bare = createBareStoryboardGraph("sb-1", "wf-fp-bare");
    const noFp = { ...createBareStoryboardGraph("sb-1", "wf-nofp"), targetSourceFingerprint: undefined } as ImageWorkflowGraph;
    useStudioStore.setState({ imageWorkflows: [bare, noFp] });
    resolvedReferences.value = [];
    freedomImage.mockResolvedValue({ url: "https://provider.test/ok.png" });
    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });
    expect(result.current.state.done).toBe(1);
  });

  it("picks the fingerprintless reference-bearing workflow over a fingerprint-matched bare one (S08 真实形态)", async () => {
    resetStore([shot({ id: "sb-1", index: 1, sourceFingerprint: "fp-real" })]);
    // 旧代:指纹匹配但零参考(排在数组前);新代:无指纹+带参考(直连脚本建流形态)
    const bare = createBareStoryboardGraph("sb-1", "wf-bare");
    const rich = {
      ...createBareStoryboardGraph("sb-1", "wf-rich"),
      targetSourceFingerprint: undefined,
      nodes: [
        ...createBareStoryboardGraph("sb-1", "wf-rich").nodes,
        {
          id: "ref-1", type: "reference", title: "监工赵四",
          imageUrl: "file://assets/ref-zhaosi.png",
          source: { kind: "asset", assetType: "character", id: "ch-1" },
          position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1,
        } as never,
      ],
      edges: [{ id: "ref-1->gen-x", source: "ref-1", target: "gen-x" }],
    } as unknown as ImageWorkflowGraph;
    useStudioStore.setState({ imageWorkflows: [bare, rich] });
    resolvedReferences.value = [];
    freedomImage.mockResolvedValue({ url: "https://provider.test/ok.png" });
    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });
    expect(freedomImage.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-zhaosi.png");
  });
  it("rejects a fingerprintless cross-generation workflow whose references are outside the current shot list (S20 形态)", async () => {
    resetStore([shot({ id: "sb-1", index: 1, sourceFingerprint: "fp-real", associateAssetsNames: ["道口镇街巷", "独孤剑尘"] })]);
    // 跨代旧流:参考是旧分镜表时代的资产(悦来客栈斗室),不在当前清单
    const crossGen = {
      ...createBareStoryboardGraph("sb-1", "wf-crossgen"),
      targetSourceFingerprint: undefined,
      nodes: [
        ...createBareStoryboardGraph("sb-1", "wf-crossgen").nodes,
        { id: "ref-old", type: "reference", title: "悦来客栈斗室", imageUrl: "file://assets/inn.png",
          source: { kind: "asset", assetType: "scene", id: "sc-inn" },
          position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1 } as never,
      ],
      edges: [{ id: "ref-old->gen-x", source: "ref-old", target: "gen-x" }],
    } as unknown as ImageWorkflowGraph;
    useStudioStore.setState({ imageWorkflows: [crossGen] });
    resolvedReferences.value = [{ imageUrl: "file://assets/street.png", title: "道口镇街巷", assetType: "scene", assetId: "sc-street" }];
    freedomImage.mockResolvedValue({ url: "https://provider.test/ok.png" });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    // 跨代流被拒→不选它→走参考补挂?补挂在选中图上——选中集为空时建新流:
    // 断言生成参考=当前清单解析出的街巷(而非客栈)
    const call = freedomImage.mock.calls[0]?.[0];
    expect(call?.referenceImages).toContain("file://assets/street.png");
    expect(call?.referenceImages).not.toContain("file://assets/inn.png");
  });
  it("backfilled references regenerate a matching @图 binding head (S15 装配门禁)", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    resolvedReferences.value = [
      { imageUrl: "file://assets/street.png", title: "道口镇街巷", assetType: "scene", assetId: "sc-1" },
      { imageUrl: "file://assets/guanshi.png", title: "掌柜", assetType: "character", assetId: "ch-1" },
    ];
    useStudioStore.setState({ imageWorkflows: [createBareStoryboardGraph("sb-1", "wf-bare")] });
    freedomImage.mockResolvedValue({ url: "https://provider.test/ok.png" });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    const stored = useStudioStore.getState().imageWorkflows.find((g) => g.id === "wf-bare");
    const prompt = stored?.nodes.find((n) => n.type === "prompt")?.prompt ?? "";
    expect(prompt.startsWith("@图1 为道口镇街巷场景；@图2 为掌柜角色")).toBe(true);
    expect(prompt).toContain("测试画面");
  });
  it("pre-flight rejects a broken reference before touching the provider (不烧配额)", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    const graph = {
      ...createBareStoryboardGraph("sb-1", "wf-bare"),
      nodes: [
        ...createBareStoryboardGraph("sb-1", "wf-bare").nodes,
        { id: "ref-dead", type: "reference", title: "独孤剑尘", imageUrl: "file://assets/dead.png",
          source: { kind: "asset", assetType: "character", id: "dead-asset" },
          position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1 } as never,
      ],
      edges: [{ id: "ref-dead->gen-x", source: "ref-dead", target: "gen-x" }],
    } as unknown as ImageWorkflowGraph;
    useStudioStore.setState({ imageWorkflows: [graph] });
    resolvedReferences.value = [];
    freedomImage.mockResolvedValue({ url: "https://provider.test/ok.png" });
    assetsBridge.readImageDataUrl = async () => { throw new Error("missing"); };
    try {
      const { result } = renderHook(() =>
        useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
      );
      act(() => result.current.start());
      await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

      expect(freedomImage).not.toHaveBeenCalled();
      expect(result.current.state.failed).toBe(1);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("无法读取"), expect.anything());
    } finally {
      assetsBridge.readImageDataUrl = null;
    }
  });

  it("pre-flight rejects an over-length prompt before touching the provider", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    const longGraph = createBareStoryboardGraph("sb-1", "wf-bare");
    for (const n of longGraph.nodes as never as Array<{ type?: string; prompt?: string }>) {
      if (n.type === "prompt") n.prompt = "长".repeat(850);
    }
    useStudioStore.setState({ imageWorkflows: [longGraph] });
    resolvedReferences.value = [];

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(freedomImage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("800"), expect.anything());
  });
});

/** R6 四象限批次测试(Trellis 08-27-vlm-visual-consistency):
 * mock window.vlmReview 验证 accepted 正常回写 / rejected 重生一次 /
 * 两次 rejected 标 failed / 模型未就绪(probe blocked)fail-open 跳过。 */
describe("useStoryboardBatchGeneration(VLM 视觉一致性四象限)", () => {
  function vlmArtifact(partial: Partial<VlmReviewArtifactV1> & { status: "accepted" | "rejected" }): VlmReviewArtifactV1 {
    return {
      schemaVersion: 1,
      projectId: "proj",
      shotId: "sb-1",
      model: "qwen3-vl-8b-instruct-mlx-8bit",
      checks: { character_ok: true, costume_ok: true, scene_ok: true, prop_ok: true, text_watermark_ok: true },
      reasons: [],
      inferenceMs: 1200,
      inputSha256: "sha-test",
      generatedAt: 1_700_000_000_000,
      ...partial,
    };
  }

  function vlmShot(): StoryboardItem {
    return shot({
      id: "sb-1",
      index: 1,
      associateAssetsNames: ["监工赵四"],
      orderedReferenceManifest: [
        { order: 1, assetId: "ch-1", assetName: "监工赵四", assetKind: "character", imagePath: "file://assets/ref-zhaosi.png" },
      ],
    });
  }

  function installVlmBridge(overrides?: {
    probe?: () => Promise<unknown>;
    run?: (payload: unknown) => Promise<unknown>;
  }) {
    const probe = vi.fn(overrides?.probe ?? (async () => ({ status: "ready" })));
    const run = vi.fn(overrides?.run ?? (async () => vlmArtifact({ status: "accepted" })));
    (window as unknown as { vlmReview: unknown }).vlmReview = { probe, run };
    return { probe, run };
  }

  beforeEach(() => {
    resolvedReferences.value = [];
    freedomImage.mockImplementation(async () => ({ url: "https://provider.test/ok.png" }));
  });

  afterEach(() => {
    delete (window as unknown as { vlmReview?: unknown }).vlmReview;
  });

  it("accepted:正常回写 mediaRef 且 visualReview 落库为 vlm 预审 pending", async () => {
    resetStore([vlmShot()]);
    const { run } = installVlmBridge();

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(freedomImage).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    const sb1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(sb1.mediaRef).toMatchObject({ kind: "image", path: "project-file://proj/workflow/gen-out.png" });
    expect(sb1.visualReview).toMatchObject({ status: "pending", reviewer: "vlm" });
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 0 });
  });

  it("rejected 后重生一次通过:共生成两次,终稿落库", async () => {
    resetStore([vlmShot()]);
    let runCalls = 0;
    installVlmBridge({
      run: async () => {
        runCalls += 1;
        return runCalls === 1
          ? vlmArtifact({ status: "rejected", reasons: ["服装形制与参考不一致"], checks: { costume_ok: false } })
          : vlmArtifact({ status: "accepted" });
      },
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(freedomImage).toHaveBeenCalledTimes(2);
    const sb1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(sb1.mediaRef).toMatchObject({ kind: "image" });
    expect(sb1.visualReview).toMatchObject({ status: "pending", reviewer: "vlm" });
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 0 });
  });

  it("两次 rejected:镜计失败,toast 报 VLM 审核不通过,不回写画面", async () => {
    resetStore([vlmShot()]);
    installVlmBridge({
      run: async () => vlmArtifact({ status: "rejected", reasons: ["角色面部与参考不符"], checks: { character_ok: false } }),
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(freedomImage).toHaveBeenCalledTimes(2);
    const sb1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(sb1.mediaRef?.kind).not.toBe("image");
    expect(sb1.visualReview).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("VLM 审核不通过"), expect.anything());
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 1 });
  });

  it("模型未就绪(probe blocked):fail-open 跳过审核,生成照常成功", async () => {
    resetStore([vlmShot()]);
    const { run } = installVlmBridge({ probe: async () => ({ status: "blocked", code: "model-not-downloaded" }) });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(freedomImage).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const sb1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(sb1.mediaRef).toMatchObject({ kind: "image" });
    expect(sb1.visualReview).toBeUndefined();
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 0 });
  });
});

