// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import { storyboardSourceFingerprint } from "@/stores/studio/studio-store-continuity-helpers";
import { updateImageWorkflowNodePosition } from "@/lib/studio/image-workflow/graph-build-mutations";

const generateImageMock = vi.hoisted(() => vi.fn());
const saveImage = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { generateImage: generateImageMock } }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({ saveImage, readAsBase64: async () => ({ success: true, base64: "QQ==", mimeType: "image/png" }) }),
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
// jsdom 没有 Canvas；仅替换排版边界，保留真实请求装配、来源围栏和落库。
const referenceSheet = vi.hoisted(() => vi.fn());
vi.mock("./storyboard-reference-sheet", () => ({ buildStoryboardReferenceSheet: referenceSheet }));

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
  referenceSheet.mockImplementation(async ({ referenceImages, graph }: {
    referenceImages: string[]; graph: ImageWorkflowGraph;
  }) => ({
    imageUrl: "data:image/png;base64,U0hFRVQ=",
    mappings: referenceImages.map((imageUrl, index) => ({ order: index + 1, imageUrl })),
    prompt: referenceImages.map((url, index) => {
      const node = graph.nodes.find((item) => item.type === "reference" && item.imageUrl === url);
      return `图${index + 1}对应拼板第${index + 1}格：${node?.title ?? "上游成图"}`;
    }).join("；"),
  }));
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

describe("useStoryboardBatchGeneration(stale 完整性与来源隔离)", () => {
  beforeEach(() => { resolvedReferences.value = []; generateImageMock.mockReset(); });

  it("真实双帧图共享版本资产，次帧完整承接首帧成图", async () => {
    const sourceUrl = "file://assets/check-scene.png";
    const sb = shot({ duration: 12, assetIds: ["scene"], associateAssetsNames: ["场景"], keyframes: [
      { frameId: "sb-1-kf-1", inUs: 0, mediaRef: { kind: "image", path: "" } },
      { frameId: "sb-1-kf-2", inUs: 6_000_000, mediaRef: { kind: "image", path: "" } },
    ] });
    sb.sourceFingerprint = storyboardSourceFingerprint(sb);
    resetStore([sb]);
    const { createOpenImageWorkflowGraph } = await import("./image-workflow-graph-utils");
    const { buildStoryboardItemOpenContext } = await import("../storyboard-open-context");
    const { buildImageWorkflowGenerationRequest } = await import("@/lib/studio/image-workflow/request");
    const graph = createOpenImageWorkflowGraph({
      ...buildStoryboardItemOpenContext(sb),
      assetReferences: [{ title: "场景", imageUrl: sourceUrl, assetType: "scene", assetId: "scene" }],
    }, "check");
    graph.nodes = graph.nodes.map((node) => node.type === "reference" ? { ...node, continuityVersionId: "scene-v1" } : node);
    useStudioStore.setState({ imageWorkflows: [graph] });
    const frameUrls = ["project-file://proj/workflow/first.png", "project-file://proj/workflow/second.png"];
    saveImage.mockResolvedValueOnce({ success: true, url: frameUrls[0], size: 10 })
      .mockResolvedValueOnce({ success: true, url: frameUrls[1], size: 10 });
    generateImageMock.mockResolvedValue({ url: "https://provider.test/ok.png" });
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "check", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(result.current.state.failed).toBe(0);
    expect(saveImage).toHaveBeenCalledTimes(2);
    expect(useStudioStore.getState().storyboards[0].keyframes?.map((frame) => frame.mediaRef.path)).toEqual(frameUrls);
    expect(generateImageMock.mock.calls.map(([params]) => params.model)).toEqual(["qwen-image-2-1", "qwen-image-2-1"]);
    expect(generateImageMock.mock.calls[1][0].referenceImages).toEqual(["data:image/png;base64,U0hFRVQ="]);
    expect(referenceSheet).toHaveBeenCalledTimes(2);
    expect(referenceSheet.mock.calls[0][0].referenceImages).toEqual([sourceUrl]);
    expect(referenceSheet.mock.calls[0][0].aspectRatio).toBe("16:9");
    expect(referenceSheet.mock.calls[1][0].referenceImages).toEqual([sourceUrl, frameUrls[0]]);
    expect(referenceSheet.mock.calls[1][0].aspectRatio).toBe("16:9");
    const finalGraph = useStudioStore.getState().imageWorkflows[0];
    const second = finalGraph.nodes.find((node) => node.type === "generated" && node.frameId === "sb-1-kf-2")!;
    const request = buildImageWorkflowGenerationRequest(finalGraph, second.id);
    expect(request.referenceImages).toEqual([sourceUrl, frameUrls[0]]);
    expect(request.orderedReferenceManifest.map((ref) => ref.order)).toEqual([1, Number.MAX_SAFE_INTEGER]);
    expect(request.orderedReferenceManifest[0].versionId).toBe("scene-v1");
    expect(request.orderedReferenceManifest[1].referenceRole).toBe("previous-approved-frame");
    expect(request.continuityRequired).toBe(true);
    expect(request.previousApprovedFrameIncluded).toBe(true);
  });

  it("regenerates a stale single image even when its old URI is nonempty", async () => {
    resetStore([shot({ stale: true, mediaRef: { kind: "image", path: "project-file://old.png" } })]);
    generateImageMock.mockResolvedValue({ url: "https://provider.test/new.png" });
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().storyboards[0]?.mediaRef?.path).toContain("gen-out.png");
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toEqual([]);
    expect(toast.info).not.toHaveBeenCalledWith("所有分镜画面均已齐备");
  });

  // W2(1112 验尸 .trellis/tasks/11-12-storyboard-asset-refchain-repair):「脏而
  // 未标」镜(离线 CLI 直写分片改 lines 却不置 stale 不重算指纹——11-04 实弹
  // 验尸:5 镜 lines 变而 sourceFingerprint 逐字节未变)不得被当新鲜跳过。
  // 桩抄 store 分片真源形态(snap-20261111 storyboards-002:sb-chapter-001-009)。
  it("指纹漂移(脏而未标)的单帧镜纳入批量重生成,不再冒充齐备", async () => {
    const sb = shot({
      id: "sb-chapter-001-009",
      prompt: "夜。金水塾馆三间青瓦房围一方小院，门楣上朽烂的木匾墨迹漫漶。",
      lines: "管事：识字么？认得几个，行。",
      mediaRef: { kind: "image", path: "project-file://49dce4c1/workflow-images/chapter-001/storyboard-1027/sb-chapter-001-009.png" },
    });
    sb.sourceFingerprint = storyboardSourceFingerprint(sb);
    // 离线 CLI 裸写:lines 已改,存档指纹未跟,stale 未标。
    sb.lines = "管事：离线 CLI 改写后的新台词。";
    resetStore([sb]);
    generateImageMock.mockResolvedValue({ url: "https://provider.test/new.png" });
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().storyboards[0]?.mediaRef?.path).toContain("gen-out.png");
    // 指纹随 freshWrite 收敛,镜不再漂移。
    const landed = useStudioStore.getState().storyboards[0]!;
    expect(landed.stale).not.toBe(true);
    expect(landed.sourceFingerprint).toBe(storyboardSourceFingerprint(landed));
    expect(toast.info).not.toHaveBeenCalledWith("所有分镜画面均已齐备");
  });

  it("指纹漂移的多帧镜既有帧全部重生成(旧帧基于旧文本,无可续跑)", async () => {
    const sb = shot({
      id: "sb-chapter-001-009",
      duration: 12,
      lines: "管事：识字么？认得几个，行。",
      keyframes: [
        { frameId: "sb-chapter-001-009-kf-1", inUs: 0, mediaRef: { kind: "image", path: "project-file://49dce4c1/workflow-images/sb-009-kf-1.png" } },
        { frameId: "sb-chapter-001-009-kf-2", inUs: 6_000_000, mediaRef: { kind: "image", path: "project-file://49dce4c1/workflow-images/sb-009-kf-2.png" } },
      ],
    });
    sb.sourceFingerprint = storyboardSourceFingerprint(sb);
    sb.lines = "管事：离线 CLI 改写后的新台词。"; // 裸写,指纹滞旧,stale 未标
    resetStore([sb]);
    generateImageMock.mockResolvedValue({ url: "https://provider.test/new.png" });
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    const landed = useStudioStore.getState().storyboards[0]!;
    expect(landed.keyframes?.every((frame) => frame.mediaRef?.path.includes("gen-out.png"))).toBe(true);
  });

  it("keeps a successfully rebuilt stale frame across ladder retries and later recovery", async () => {
    resetStore([shot({ stale: true, staleSince: 10, duration: 12, keyframes: [
      { frameId: "sb-1-kf-1", inUs: 0, mediaRef: { kind: "image", path: "project-file://old-1.png" } },
      { frameId: "sb-1-kf-2", inUs: 6_000_000, mediaRef: { kind: "image", path: "project-file://old-2.png" } },
    ] })]);
    generateImageMock.mockResolvedValueOnce({ url: "https://provider.test/new.png" })
      .mockRejectedValue(new Error("second frame unavailable"));
    const { result, unmount } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    const partial = useStudioStore.getState().storyboards[0]!;
    expect(generateImageMock).toHaveBeenCalledTimes(4);
    expect(partial.keyframes?.[0]?.mediaRef.path).toContain("gen-out.png");
    expect(partial.keyframes?.[1]?.mediaRef.path).toBe("project-file://old-2.png");
    expect(partial.stale).toBe(true);
    unmount();
    generateImageMock.mockResolvedValue({ url: "https://provider.test/recovery.png" });
    const resumed = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => resumed.result.current.start());
    await waitFor(() => expect(resumed.result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(5);
    expect(useStudioStore.getState().storyboards[0]?.stale).toBe(false);
    expect(useStudioStore.getState().storyboards[0]?.visualReview?.status).not.toBe("approved");
  });

  it("rebuilds a stale one-slot keyframe through the single generated node", async () => {
    resetStore([shot({ stale: true, keyframes: [
      { frameId: "sb-1-kf-1", inUs: 0, mediaRef: { kind: "image", path: "project-file://old.png" } },
    ] })]);
    generateImageMock.mockResolvedValue({ url: "https://provider.test/new.png" });
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().storyboards[0]?.keyframes?.[0]?.mediaRef.path).toContain("gen-out.png");
    expect(useStudioStore.getState().storyboards[0]?.stale).toBe(false);
  });

  it("does not regenerate an already completed frame when a non-stale second frame retries", async () => {
    resetStore([shot({ duration: 12, keyframes: [
      { frameId: "sb-1-kf-1", inUs: 0, mediaRef: { kind: "image", path: "" } },
      { frameId: "sb-1-kf-2", inUs: 6_000_000, mediaRef: { kind: "image", path: "" } },
    ] })]);
    generateImageMock.mockResolvedValueOnce({ url: "https://provider.test/first.png" })
      .mockRejectedValueOnce(new Error("transient second frame"))
      .mockResolvedValue({ url: "https://provider.test/second.png" });
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(3);
    expect(useStudioStore.getState().storyboards[0]?.keyframes?.every((frame) => frame.mediaRef.path)).toBe(true);
  });

  it.each([
    { index: 5, name: "room entry" },
    { index: 4, name: "room inspection" },
  ])("rejects late image save after only the source scene changes to %j", async (scene) => {
    resetStore([shot({
      sourceEvidence: { source: "storyboard-table", scene: { index: 4, name: "room entry" } },
    })]);
    let resolve!: (value: { url: string }) => void;
    generateImageMock.mockImplementation(() => new Promise<{ url: string }>((done) => { resolve = done; }));
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "check", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(1));
    const pendingShot = useStudioStore.getState().storyboards[0];
    const sourceEvidence = { ...pendingShot.sourceEvidence!, scene };
    act(() => useStudioStore.getState().updateStoryboard(pendingShot.id, { sourceEvidence }));
    expect(useStudioStore.getState().storyboards[0]).toEqual({
      ...pendingShot,
      sourceEvidence,
      sourceFingerprint: storyboardSourceFingerprint({ ...pendingShot, sourceEvidence }),
    });

    await act(async () => { resolve({ url: "https://provider.test/late.png" }); });
    await waitFor(() => expect(result.current.state.running).toBe(false));

    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(saveImage).not.toHaveBeenCalled();
    expect(result.current.state.failed).toBe(1);
    expect(useStudioStore.getState().storyboards[0]?.mediaRef).toBeUndefined();
    expect(useStudioStore.getState().materials).toHaveLength(0);
    expect(useStudioStore.getState().imageWorkflows.flatMap((graph) => graph.nodes)
      .filter((node) => node.type === "generated" && node.resultUrl)).toEqual([]);
  });

  it.each(["project", "chapter", "source"])("rejects late writeback after %s changes", async (change) => {
    resetStore([shot({})]);
    let resolve!: (value: { url: string }) => void;
    generateImageMock.mockImplementation(() => new Promise<{ url: string }>((done) => { resolve = done; }));
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: "道劫", submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(1));
    act(() => {
      if (change === "project") useProjectStore.setState({ activeProjectId: "other-project" });
      if (change === "chapter") useStudioStore.setState({ activeChapterId: "chapter-002" });
      if (change === "source") useStudioStore.getState().updateStoryboard("sb-1", { prompt: "上游已变更" });
    });
    await act(async () => { resolve({ url: "https://provider.test/late.png" }); });
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().storyboards[0]?.mediaRef).toBeUndefined();
    expect(useStudioStore.getState().materials).toHaveLength(0);
  });
});

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
    expect(referenceSheet.mock.calls[0]?.[0]?.referenceImages).toEqual(["file://assets/ref-zhaosi.png"]);
    expect(referenceSheet.mock.calls[0]?.[0]?.aspectRatio).toBe("16:9");
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toEqual(["data:image/png;base64,U0hFRVQ="]);
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
    expect(referenceSheet.mock.calls[0]?.[0]?.referenceImages).toEqual([
      "file://assets/ref-scene.png", "file://assets/ref-zhaosi.png",
    ]);
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toEqual(["data:image/png;base64,U0hFRVQ="]);
    expect(generateImageMock.mock.calls[0]?.[0]?.prompt).toContain("图1对应拼板第1格：金水河码头；图2对应拼板第2格：监工赵四");
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
    expect(referenceSheet.mock.calls[0]?.[0]?.referenceImages).toEqual(["file://assets/ref-zhaosi.png"]);
    expect(referenceSheet.mock.calls[0]?.[0]?.aspectRatio).toBe("16:9");
    expect(generateImageMock.mock.calls[0]?.[0]?.referenceImages).toEqual(["data:image/png;base64,U0hFRVQ="]);
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
    const sheetInput = referenceSheet.mock.calls[0]?.[0];
    expect(sheetInput?.referenceImages).toEqual(["file://assets/street.png"]);
    expect(sheetInput?.referenceImages).not.toContain("file://assets/inn.png");
    expect(sheetInput?.aspectRatio).toBe("16:9");
    const call = generateImageMock.mock.calls[0]?.[0];
    expect(call?.referenceImages).toEqual(["data:image/png;base64,U0hFRVQ="]);
    expect(call?.aspectRatio).toBe("16:9");
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
      if (n.type === "prompt") n.prompt = "长".repeat(1650);
    }
    useStudioStore.setState({ imageWorkflows: [longGraph] });
    resolvedReferences.value = [];

    const { result } = renderHook(() =>
      useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: "道劫" }),
    );
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false), { timeout: 8000 });

    expect(generateImageMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("1600"), expect.anything());
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
    // jsdom@29 的 Storage setItem 内部用 setTimeout(0) 排队存储事件广播(zustand persist
    // 每次落盘各挂一个)——环境实现噪音而非业务节流定时器,不隔离会击穿「零残留」断言;
    // 桩掉写入不影响本用例(会话状态读内存态,持久化链路在其余用例真定时器下覆盖)。
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
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
      setItemSpy.mockRestore();
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


function continuityState(groupId: string, previousStoryboardId?: string): NonNullable<StoryboardItem['continuityState']> {
  return {
    groupId, previousStoryboardId, sceneVersionId: 'v1', sceneViewpointId: 'wide',
    lighting: '', palette: '', actionIn: 'enter', actionOut: 'leave', characters: [], inputFingerprint: 'check',
  };
}

// Six independent reviewer cases, now permanent hook regressions.
describe('independent check', () => {
  beforeEach(() => { resolvedReferences.value = []; generateImageMock.mockReset(); });
  function restoredFrame(generatedAt: number) {
    const mediaRef: StoryboardItem['mediaRef'] = { kind: 'image', path: 'project-file://proj/old.png', imageWorkflowId: 'wf-check', imageWorkflowNodeId: 'gen-x' };
    const sb = shot({ stale: true, staleSince: 10, staleReason: '旧连续镜失效', mediaRef, keyframes: [
      { frameId: 'sb-1-kf-1', inUs: 0, mediaRef, origin: { kind: 'generated' } },
    ] });
    const fp = storyboardSourceFingerprint(sb);
    sb.sourceFingerprint = fp;
    const graph = createBareStoryboardGraph(sb.id, 'wf-check');
    graph.targetSourceFingerprint = fp;
    graph.nodes = graph.nodes.map(n => n.type === 'generated' ? { ...n, resultUrl: mediaRef.path, generatedAt, updatedAt: generatedAt, status: 'ready' } : n);
    resetStore([sb]);
    useStudioStore.setState({ imageWorkflows: [graph] });
    return { sb, graph };
  }
  it('old frame must still regenerate after only moving its node', async () => {
    const { graph } = restoredFrame(1);
    useStudioStore.getState().upsertImageWorkflow(updateImageWorkflowNodePosition(graph, 'gen-x', { x: 700, y: 200 }, 20));
    generateImageMock.mockResolvedValue({ url: 'https://provider.test/new.png' });
    const { result } = renderHook(() => useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0 }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });
  it('all recovered fresh frames must clear stale', async () => {
    restoredFrame(20);
    generateImageMock.mockResolvedValue({ url: 'https://provider.test/new.png' });
    const { result } = renderHook(() => useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0 }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(0);
    expect(useStudioStore.getState().storyboards[0]?.stale).toBe(false);
    expect(useStudioStore.getState().storyboards[0]?.staleSince).toBeUndefined();
    expect(useStudioStore.getState().storyboards[0]?.staleReason).toBeUndefined();
    expect(useStudioStore.getState().storyboards[0]?.visualReview?.status).not.toBe('approved');
  });
  it.each(['generatedAt', 'fingerprint', 'resultUrl', 'origin'])(
    'does not finalize recovered frames without matching %s evidence', async (missing) => {
      const { graph, sb } = restoredFrame(20);
      if (missing === 'generatedAt') {
        graph.nodes = graph.nodes.map(node => node.type === 'generated' ? { ...node, generatedAt: undefined } : node);
      }
      if (missing === 'fingerprint') graph.targetSourceFingerprint = 'other-source';
      if (missing === 'resultUrl') {
        graph.nodes = graph.nodes.map(node => node.type === 'generated' ? { ...node, resultUrl: 'project-file://other.png' } : node);
      }
      if (missing === 'origin') {
        useStudioStore.setState({ storyboards: [{ ...sb, keyframes: sb.keyframes?.map(frame => ({ ...frame, origin: undefined })) }] });
      }
      useStudioStore.setState({ imageWorkflows: [graph] });
      generateImageMock.mockRejectedValue(new Error('unavailable'));
      const { result } = renderHook(() => useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0 }));
      act(() => result.current.start());
      await waitFor(() => expect(result.current.state.running).toBe(false));
      expect(generateImageMock).toHaveBeenCalledTimes(3);
      expect(useStudioStore.getState().storyboards[0]?.stale).toBe(true);
    },
  );
  it('normal continuity landing must allow two successive shots', async () => {
    const semantics = { sceneViewpointId: 'wide', personFree: true, visibleCharacters: [], visibleProps: [], actionIn: 'enter', actionOut: 'leave' };
    resetStore([shot({ id: 'sb-1', index: 1, shotSemantics: semantics }), shot({ id: 'sb-2', index: 2, shotSemantics: semantics })]);
    resolvedReferences.value = [{ imageUrl: 'file://assets/check-scene.png', title: 'check-scene', assetType: 'scene', assetId: 'check-scene' }];
    useStudioStore.setState({ continuityAssetVersions: [{ assetId: 'check-scene', versionId: 'v1', assetKind: 'scene', label: 'check-scene', structurallyComplete: true, source: 'test', referenceImagePaths: ['file://assets/check-scene.png'], contentFingerprint: 'scene-fp', approved: false }] });
    generateImageMock.mockResolvedValue({ url: 'https://provider.test/new.png' });
    const { result } = renderHook(() => useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0 }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(result.current.state.failed).toBe(0);
    expect(useStudioStore.getState().storyboards[1]?.continuityState?.previousStoryboardId).toBe('sb-1');
  });
  it('missing staleSince must not lose a completed frame on retry', async () => {
    resetStore([shot({ stale: true, duration: 12, keyframes: [
      { frameId: 'sb-1-kf-1', inUs: 0, mediaRef: { kind: 'image', path: 'project-file://old-1.png' } },
      { frameId: 'sb-1-kf-2', inUs: 6000000, mediaRef: { kind: 'image', path: 'project-file://old-2.png' } },
    ] })]);
    generateImageMock.mockResolvedValueOnce({ url: 'https://provider.test/one.png' }).mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ url: 'https://provider.test/two.png' });
    const { result } = renderHook(() => useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0 }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(3);
    expect(useStudioStore.getState().storyboards[0]?.stale).toBe(false);
  });
});


describe('independent check continuous source', () => {
  beforeEach(() => { resolvedReferences.value = []; generateImageMock.mockReset(); });
  it.each(['mediaRef', 'previous invalidation', 'current invalidation'])(
    'changing %s in flight must reject the current old result', async (change) => {
    const prior = shot({ id: 'sb-prev', index: 1, mediaRef: { kind: 'image', path: 'project-file://proj/prior-old.png' }, continuityState: continuityState('chapter-001:scene:s') });
    const current = shot({ id: 'sb-current', index: 2, stale: true, staleSince: 10, continuityState: continuityState('chapter-001:scene:s', 'sb-prev'), visualReview: { status: 'pending', reasons: [], characterChecks: [], sceneChecks: [], propChecks: [], transitionChecks: [], textWatermarkCheck: { passed: true }, reviewer: 'human', evidencePaths: [], inputFingerprint: 'check' } });
    resetStore([prior, current]);
    let resolve!: (value: { url: string }) => void;
    generateImageMock.mockImplementation(() => new Promise<{ url: string }>(done => { resolve = done; }));
    const { result } = renderHook(() => useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0 }));
    act(() => result.current.start());
    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(1));
    act(() => {
      if (change === 'mediaRef') {
        useStudioStore.getState().updateStoryboard('sb-prev', { mediaRef: { kind: 'image', path: 'project-file://proj/prior-new.png' } });
      } else {
        useStudioStore.getState().updateStoryboard(change === 'previous invalidation' ? 'sb-prev' : 'sb-current', {
          stale: true, staleSince: 25, staleReason: '外部重新作废',
        });
      }
    });
    if (change !== 'previous invalidation') expect(useStudioStore.getState().storyboards[1]?.stale).toBe(true);
    await act(async () => { resolve({ url: 'https://provider.test/late.png' }); });
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(useStudioStore.getState().storyboards[1]?.mediaRef).toBeUndefined();
    expect(useStudioStore.getState().materials).toHaveLength(0);
    expect(saveImage).not.toHaveBeenCalled();
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(useStoryboardBatchSessionStore.getState().session).toMatchObject({ status: 'interrupted', cursorShotIndex: 2 });
  });
});


describe('independent check continuity retries', () => {
  beforeEach(() => { resolvedReferences.value = []; generateImageMock.mockReset(); });
  it('rejects an external previous-shot write after accepting its own earlier landing', async () => {
    resetStore([
      shot({ id: 'sb-1', index: 1, continuityState: continuityState('chapter-001:scene:s') }),
      shot({ id: 'sb-2', index: 2, continuityState: continuityState('chapter-001:scene:s', 'sb-1') }),
    ]);
    let resolve!: (value: { url: string }) => void;
    generateImageMock.mockResolvedValueOnce({ url: 'https://provider.test/first.png' })
      .mockImplementation(() => new Promise<{ url: string }>(done => { resolve = done; }));
    const { result } = renderHook(() => useStoryboardBatchGeneration({
      storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0,
    }));
    act(() => result.current.start());
    await waitFor(() => expect(generateImageMock).toHaveBeenCalledTimes(2));
    expect(useStudioStore.getState().storyboards[0]?.mediaRef?.path).toContain('gen-out.png');
    act(() => useStudioStore.getState().updateStoryboard('sb-1', {
      mediaRef: { kind: 'image', path: 'project-file://external.png' },
    }));
    await act(async () => { resolve({ url: 'https://provider.test/late.png' }); });
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().materials).toHaveLength(1);
    expect(useStudioStore.getState().storyboards[1]?.mediaRef).toBeUndefined();
    expect(useStudioStore.getState().storyboards[0]?.mediaRef?.path).toBe('project-file://external.png');
  });
  it.each([false, true])('two stale multiframe shots continue after real continuity landing and one frame retry (reviewed=%s)', async (reviewed) => {
    const make = (id: string, index: number) => shot({ id, index, stale: true, staleSince: 10, duration: 12,
      shotSemantics: { sceneViewpointId: 'wide', personFree: true, visibleCharacters: [], visibleProps: [], actionIn: 'enter', actionOut: 'leave' },
      keyframes: [
        { frameId: id + '-kf-1', inUs: 0, mediaRef: { kind: 'image', path: 'project-file://old-1.png' } },
        { frameId: id + '-kf-2', inUs: 6000000, mediaRef: { kind: 'image', path: 'project-file://old-2.png' } },
      ],
    });
    const shots = [make('sb-1', 1), make('sb-2', 2)];
    if (reviewed) {
      for (const item of shots) {
        item.continuityState = continuityState('chapter-001:scene:check-scene');
        item.visualReview = { status: 'pending', reasons: [], characterChecks: [], sceneChecks: [], propChecks: [], transitionChecks: [], textWatermarkCheck: { passed: true }, reviewer: 'human', evidencePaths: [], inputFingerprint: 'check' };
      }
    }
    resetStore(shots);
    resolvedReferences.value = [{ imageUrl: 'file://assets/check-scene.png', title: 'check-scene', assetType: 'scene', assetId: 'check-scene' }];
    useStudioStore.setState({ continuityAssetVersions: [{ assetId: 'check-scene', versionId: 'v1', assetKind: 'scene', label: 'check-scene', structurallyComplete: true, source: 'test', referenceImagePaths: ['file://assets/check-scene.png'], contentFingerprint: 'scene-fp', approved: false }] });
    generateImageMock.mockResolvedValueOnce({ url: 'https://provider.test/one.png' }).mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ url: 'https://provider.test/rest.png' });
    const { result } = renderHook(() => useStoryboardBatchGeneration({ storyboards: useStudioStore.getState().storyboards, projectName: 'check', submitIntervalMs: 0 }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(generateImageMock).toHaveBeenCalledTimes(5);
    expect(result.current.state.failed).toBe(0);
    expect(useStudioStore.getState().storyboards.map(sb => sb.stale)).toEqual([false, false]);
    expect(useStudioStore.getState().storyboards[1]?.continuityState?.previousStoryboardId).toBe('sb-1');
  });
});

describe("runStoryboardSingleShotOnce", () => {
  beforeEach(() => { resolvedReferences.value = []; generateImageMock.mockReset(); });
  const run = async (board: StoryboardItem) => {
    const module = await import("./use-storyboard-batch-generation");
    return module.runStoryboardSingleShotOnce(board, "check");
  };
  it("finalizes real stale multi-frame slots without entering the batch ladder", async () => {
    const board = shot({ stale: true, staleSince: 10, duration: 12, keyframes: [
      { frameId: "sb-1-kf-1", inUs: 0, mediaRef: { kind: "image", path: "project-file://old-1.png" } },
      { frameId: "sb-1-kf-2", inUs: 6000000, mediaRef: { kind: "image", path: "project-file://old-2.png" } },
    ] });
    resetStore([board]);
    saveImage.mockResolvedValueOnce({ success: true, url: "project-file://proj/one.png", size: 10 })
      .mockResolvedValueOnce({ success: true, url: "project-file://proj/two.png", size: 10 });
    generateImageMock.mockResolvedValue({ url: "data:image/png;base64,QQ==" });
    await run(board);
    const written = useStudioStore.getState().storyboards[0];
    expect(written.keyframes?.map(frame => frame.mediaRef.path)).toEqual(["project-file://proj/one.png", "project-file://proj/two.png"]);
    expect(written.keyframes?.every(frame => frame.origin?.kind === "generated")).toBe(true);
    expect(written.stale).toBe(false);
    expect(written.visualReview?.status).not.toBe("approved");
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(useStoryboardBatchSessionStore.getState().session).toBeNull();
  });
  it("rejects a stale caller snapshot before generation", async () => {
    const board = shot({}); resetStore([board]);
    useStudioStore.getState().updateStoryboard(board.id, { prompt: "changed source" });
    await expect(run(board)).rejects.toThrow("来源已变化");
    expect(generateImageMock).not.toHaveBeenCalled();
  });
  it("rejects late source changes before save and frame finalization", async () => {
    const board = shot({}); resetStore([board]);
    generateImageMock.mockImplementation(async () => {
      useStudioStore.getState().updateStoryboard(board.id, { prompt: "changed source" });
      return { url: "data:image/png;base64,QQ==" };
    });
    await expect(run(board)).rejects.toThrow("来源已变化");
    expect(saveImage).not.toHaveBeenCalled();
    expect(useStudioStore.getState().materials).toHaveLength(0);
  });
  it("keeps prior frame output on failure and does not run the batch retry ladder", async () => {
    const board = shot({ stale: true, mediaRef: { kind: "image", path: "project-file://old.png" } });
    resetStore([board]); generateImageMock.mockRejectedValue(new Error("provider unavailable"));
    await expect(run(board)).rejects.toThrow("provider unavailable");
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().storyboards[0].mediaRef?.path).toBe("project-file://old.png");
  });
});
