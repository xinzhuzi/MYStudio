// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";

const generateImageMock = vi.hoisted(() => vi.fn());
const saveImage = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { generateImage: generateImageMock } }));
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
import { useStoryboardBatchSessionStore } from "@/stores/studio/storyboard-batch-session-store";

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
  // 断点续跑会话隔离:逐用例清空持久化会话
  useStoryboardBatchSessionStore.setState({ session: null });
  saveImage.mockImplementation(async (_payload: unknown) => ({
    success: true,
    url: "project-file://proj/workflow/gen-out.png",
    size: 10,
  }));
});

afterEach(() => {
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
  useStoryboardBatchSessionStore.setState({ session: null });
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
      { id: "gen-x", type: "generated", title: "分镜 1 成图", prompt: "测试画面", aspectRatio: "16:9", status: "idle", position: { x: 600, y: 120 }, createdAt: now, updatedAt: now },
      { id: "prompt-x", type: "prompt", title: "图片生成", prompt: "测试画面", aspectRatio: "16:9", targetNodeId: "gen-x", position: { x: 560, y: 500 }, createdAt: now, updatedAt: now },
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
    generateImageMock.mockImplementation(async (params: { transport?: string }) => {
      if (params?.transport === "chat") return { url: "data:image/png;base64,QQ==" };
      return { url: "https://cdn.test/remote.png" };
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });

    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(generateImageMock.mock.calls[0][0].transport).toBeUndefined();
    expect(generateImageMock.mock.calls[1][0].transport).toBe("chat");
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
    generateImageMock.mockImplementation(async () => ({ url: "data:image/png;base64,QQ==" }));

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });

    // 失败回退阶梯(09-15 P3):保存失败也走三段(原样→原样→降载),共 3 次生成
    expect(generateImageMock).toHaveBeenCalledTimes(3);
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
    generateImageMock.mockImplementation(async () => {
      const index = callOrder.length === 0 ? 2 : 3;
      callOrder.push(index);
        if (index === 2) return { url: "https://provider.test/ok.png" };
      throw new Error("provider down");
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 4000 });
    // 阶梯(09-15 P3):sb-3 三败(原样→原样→降载),调用序列 [2, 3, 3, 3]
    expect(callOrder).toEqual([2, 3, 3, 3]);
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
    generateImageMock.mockImplementation(async () => {
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
    generateImageMock.mockImplementation(() => new Promise<{ url: string }>((resolve) => {
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

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!.mediaRef?.kind).toBe("image");
    expect(useStudioStore.getState().storyboards.find((item) => item.id === "sb-2")!.mediaRef?.kind).not.toBe("image");
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("已停止"));
  });

  it("ignores re-entry while a batch is already running", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    const resolvers: Array<() => void> = [];
    generateImageMock.mockImplementation(() => new Promise<{ url: string }>((resolve) => {
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

    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });

  it("no-ops with a hint when every shot already has an image", () => {
    resetStore([
      shot({ id: "sb-1", index: 1, mediaRef: { kind: "image", path: "project-file://a.png" } as StoryboardItem["mediaRef"] }),
    ]);
    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    expect(generateImageMock).not.toHaveBeenCalled();
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

    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });
    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    // 择优:生成走了带参考的 wf-rich(其既有参考直接生效)
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-zhaosi.png");
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
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    const stored = useStudioStore.getState().imageWorkflows.find((g) => g.id === "wf-bare");
    const refTitles = stored?.nodes.filter((n) => n.type === "reference").map((n) => n.title);
    expect(refTitles).toEqual(["金水河码头", "监工赵四"]);
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-scene.png");
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-zhaosi.png");
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
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });
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
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });
    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toContain("file://assets/ref-zhaosi.png");
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
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    // 跨代流被拒→不选它→走参考补挂?补挂在选中图上——选中集为空时建新流:
    // 断言生成参考=当前清单解析出的街巷(而非客栈)
    const call = generateImageMock.mock.calls[0]?.[0];
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
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });

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
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });
    assetsBridge.readImageDataUrl = async () => { throw new Error("missing"); };
    try {
      const { result } = renderHook(() =>
        useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
      );
      act(() => result.current.start());
      await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

      expect(generateImageMock).not.toHaveBeenCalled();
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

    expect(generateImageMock).not.toHaveBeenCalled();
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
    generateImageMock.mockImplementation(async () => ({ url: "https://provider.test/ok.png" }));
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

    expect(generateImageMock).toHaveBeenCalledTimes(1);
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

    expect(generateImageMock).toHaveBeenCalledTimes(2);
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

    // 阶梯(09-15 P3):每次尝试内部 VLM 重生 1 次共 2 生成,三段尝试共 6 次
    expect(generateImageMock).toHaveBeenCalledTimes(6);
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

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const sb1 = useStudioStore.getState().storyboards.find((item) => item.id === "sb-1")!;
    expect(sb1.mediaRef).toMatchObject({ kind: "image" });
    expect(sb1.visualReview).toBeUndefined();
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 0 });
  });
});

/** 批量队列四协议(09-15 P3 / Trellis 09-15-teman-absorption AC5):
 * 断点续跑(游标+指纹跳过)/间隔节流(可中断零残留)/精确停队(只删本会话)/
 * 失败回退阶梯(三段各一次+三败汇总一条)。 */
describe("useStoryboardBatchGeneration(批量四协议)", () => {
  beforeEach(() => {
    resolvedReferences.value = [];
  });

  it("断点续跑:重入从持久化游标镜继续,游标前失败镜不重试,已完成镜指纹跳过(必测)", async () => {
    resetStore([
      // 游标前缺图(上轮三败放弃的镜)→ 续跑不得重试
      shot({ id: "sb-1", index: 1 }),
      // 游标后已有图(上轮已完成)→ 既有 mediaRef 幂等口径跳过(指纹命中)
      shot({ id: "sb-2", index: 2, mediaRef: { kind: "image", path: "project-file://done.png" } as StoryboardItem["mediaRef"] }),
      shot({ id: "sb-3", index: 3 }),
      shot({ id: "sb-4", index: 4 }),
    ]);
    useStoryboardBatchSessionStore.setState({
      session: {
        sessionId: "sess-1", projectId: "proj", episodeId: "chapter-001",
        cursorShotIndex: 3, totalFrames: 4, doneFrames: 1, failedFrames: 1,
        status: "interrupted", updatedAt: 1,
      },
    });
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0 }),
    );
    // 重入前 UI 可见「继续」候选:游标镜+剩余帧数
    expect(result.current.resumable).toEqual({ shotIndex: 3, remainingFrames: 2 });

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    // 只提交游标起的缺图镜(S3/S4):sb-1 游标前不重试,sb-2 指纹命中跳过
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    // 进度接续上轮计数(priorDone=1 起步)
    expect(result.current.state).toMatchObject({ total: 3, done: 3, failed: 0 });
    // 自然完成:持久化会话清空,继续候选消失
    expect(useStoryboardBatchSessionStore.getState().session).toBeNull();
    expect(result.current.resumable).toBeNull();
  });

  it("断点续跑:停止后游标与 interrupted 状态落盘,续跑候选指向下一镜", async () => {
    resetStore([shot({ id: "sb-1", index: 1 }), shot({ id: "sb-2", index: 2 })]);
    const resolvers: Array<() => void> = [];
    generateImageMock.mockImplementation(() => new Promise<{ url: string }>((resolve) => {
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

    // 游标推进到下一队列镜,状态落 interrupted,续跑候选可用
    expect(useStoryboardBatchSessionStore.getState().session).toMatchObject({
      status: "interrupted",
      cursorShotIndex: 2,
      doneFrames: 1,
      failedFrames: 0,
    });
    expect(result.current.resumable).toEqual({ shotIndex: 2, remainingFrames: 1 });
  });

  it("间隔节流:镜间等待可配;停止立即中断且零残留定时器(必测)", async () => {
    vi.useFakeTimers();
    // 微任务泵:推进微任务链直至稳定(mock 全即时resolve,链上无真等待)
    const flushMicrotasks = async (ticks = 40) => {
      for (let i = 0; i < ticks; i += 1) await Promise.resolve();
    };
    try {
      resetStore([shot({ id: "sb-1", index: 1 }), shot({ id: "sb-2", index: 2 })]);
      const resolvers: Array<() => void> = [];
      generateImageMock.mockImplementation(() => new Promise<{ url: string }>((resolve) => {
        resolvers.push(() => resolve({ url: "https://provider.test/ok.png" }));
      }));

      const { result } = renderHook(() =>
        useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 60_000 }),
      );
      act(() => result.current.start());
      await act(async () => { await flushMicrotasks(); });

      // 首镜直发;完成一镜后,下一镜进间隔等待(不提交)
      expect(resolvers.length).toBe(1);
      act(() => { resolvers[0]!(); });
      await act(async () => { await flushMicrotasks(); });
      expect(generateImageMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);

      // 停止:间隔立即中断,批量收尾,第二镜未提交,定时器池清空(零残留)
      act(() => result.current.stop());
      await act(async () => { await flushMicrotasks(); });
      expect(result.current.state.running).toBe(false);
      expect(generateImageMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(useStoryboardBatchSessionStore.getState().session?.status).toBe("interrupted");
    } finally {
      vi.useRealTimers();
    }
  });

  it("失败回退阶梯:原样→原样重试→降载 1K 三段各走一次,三败只出一条汇总 toast(必测)", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    generateImageMock.mockRejectedValue(new Error("engine exploded"));

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(generateImageMock).toHaveBeenCalledTimes(3);
    // 前两段原样(保持图内默认档 2K),第三段降载 1K
    expect(generateImageMock.mock.calls[0]?.[0]?.resolution).toBe("2K");
    expect(generateImageMock.mock.calls[1]?.[0]?.resolution).toBe("2K");
    expect(generateImageMock.mock.calls[2]?.[0]?.resolution).toBe("1K");
    // 三败才报告:单镜只出一条失败 toast(汇总),重试过程不出声
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("分镜 1"), expect.anything());
    // done=进度口径(成功+失败,与既有批量语义一致)
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 1 });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("失败 1"));
  });

  it("失败回退阶梯:原样重试救活则不降载不记失败", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    let calls = 0;
    generateImageMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { url: "https://provider.test/ok.png" };
    });

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0 }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(generateImageMock.mock.calls[1]?.[0]?.resolution).toBe("2K");
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 0 });
  });

  it("精确停队:收尾只撤回本会话归因的排队项,他人任务零触碰(注入通道,必测)", async () => {
    resetStore([shot({ id: "sb-1", index: 1 })]);
    // 状态化队列 mock:首次快照(提交前)只有他人任务;本会话超时遗留任务
    // mine-1 之后出现在 pending——差分归因把它记入本会话集合
    const deleteCalls: string[][] = [];
    let getQueueCalls = 0;
    const queueChannel = {
      async getQueue() {
        getQueueCalls += 1;
        return {
          runningPromptIds: ["foreign-running"],
          pendingPromptIds: getQueueCalls <= 1 ? ["foreign-pending"] : ["foreign-pending", "mine-1"],
        };
      },
      async deleteQueueItems(ids: string[]) {
        deleteCalls.push([...ids]);
      },
    };
    generateImageMock.mockRejectedValue(new Error("bridge-timeout"));

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({
        storyboards: useStudioStore.getState().storyboards,
        projectName: "道劫",
        submitIntervalMs: 0,
        queueChannel,
      }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    // 三败收尾触发精确停队:只删 mine-1,他人任务(foreign-*)不在载荷里
    expect(deleteCalls).toEqual([["mine-1"]]);
    expect(result.current.state).toMatchObject({ total: 1, done: 1, failed: 1 });
  });
});

