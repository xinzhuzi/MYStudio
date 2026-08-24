// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageWorkflowGraph } from "@/types/studio";

let currentGraph: ImageWorkflowGraph;
let currentStoryboards: Array<{ id: string; episodeId: string }>;
let activeProjectId: string | null;
const freedomImage = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { freedomImage } }));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: Object.assign(vi.fn(), {
    getState: () => ({
      imageWorkflows: [currentGraph],
      storyboards: currentStoryboards,
      upsertImageWorkflow: (graph: ImageWorkflowGraph) => { currentGraph = graph; },
    }),
  }),
}));
vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: Object.assign(vi.fn(), {
    getState: () => ({ activeProjectId }),
  }),
}));
vi.mock("./image-workflow-file-utils", () => ({
  prepareReferenceImages: async (images: string[]) => images,
  createWorkflowFilename: (_kind: string, nodeId: string) => `${nodeId}.png`,
  workflowImageRelativePath: (graphId: string, filename: string, chapterId?: string) =>
    chapterId ? `workflow/${chapterId}/${graphId}/${filename}` : `workflow/${graphId}/${filename}`,
  chapterScopeForWorkflowTarget: (target: { kind?: string; id?: string } | undefined, storyboards?: Array<{ id: string; episodeId: string }>) =>
    target?.kind === "storyboard" ? storyboards?.find((item) => item.id === target.id)?.episodeId : undefined,
}));
vi.mock("@/lib/studio/visual-manual-style-tokens", () => ({
  // 恒等透传:视觉手册风格锁依赖真实 store 形态,与本 hook 的路径逻辑无关
  withActiveVisualManualStoryboardStyleTokens: (prompt: string) => prompt,
  // 非道劫/未预热语义:不进分镜帧编译
  compileActiveDaojieStoryboardFramePrompt: async () => null,
}));
vi.mock("sonner", () => ({ toast }));

import { useImageWorkflowGeneration } from "./use-image-workflow-generation";

function createGraph(prompt = "cinematic portrait"): ImageWorkflowGraph {
  return {
    id: "graph-1",
    name: "Graph",
    target: { kind: "free" },
    nodes: [{
      id: "generated-1",
      type: "generated",
      title: "Hero",
      prompt,
      model: "gpt-image-1",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "hd",
      status: "idle",
      position: { x: 0, y: 0 },
      createdAt: 1,
      updatedAt: 1,
    }],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "projectFiles");
  currentGraph = createGraph();
  currentStoryboards = [];
  activeProjectId = "project-1";
});

describe("useImageWorkflowGeneration", () => {
  it("generates, saves, materializes, and marks the latest graph ready", async () => {
    freedomImage.mockResolvedValue({ url: "https://provider.test/image.png", mediaId: "remote-media" });
    const saveImage = vi.fn().mockResolvedValue({
      success: true,
      url: "project://project-1/workflow/graph-1/generated-1.png",
      size: 123,
    });
    Object.defineProperty(window, "projectFiles", {
      configurable: true,
      value: { saveImage },
    });
    const savedGraphs: ImageWorkflowGraph[] = [];
    const saveGraph = vi.fn((graph: ImageWorkflowGraph) => {
      currentGraph = graph;
      savedGraphs.push(graph);
    });
    const addMaterial = vi.fn(() => "material-1");
    const { result } = renderHook(() => useImageWorkflowGeneration({
      workflowId: "graph-1",
      saveGraph,
      addMaterial,
    }));

    await act(async () => result.current.generateNode("generated-1"));

    expect(savedGraphs[0].nodes[0]).toMatchObject({ status: "generating" });
    expect(freedomImage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "cinematic portrait",
      model: "gpt-image-1",
      extraParams: { quality: "hd" },
    }));
    expect(saveImage).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "workflow/graph-1/generated-1.png",
      source: "https://provider.test/image.png",
    });
    expect(addMaterial).toHaveBeenCalledWith({
      name: "Hero.png",
      localPath: "project://project-1/workflow/graph-1/generated-1.png",
      size: 123,
    });
    // 成图回写经核心函数 store 直写(upsert),最终态看 currentGraph
    expect(currentGraph.nodes[0]).toMatchObject({
      status: "ready",
      resultMediaId: "material-1",
      resultUrl: "project://project-1/workflow/graph-1/generated-1.png",
    });
    expect(toast.success).toHaveBeenCalledWith("图片已生成并保存到当前项目");
  });

  it("saves storyboard-targeted generations under the chapter scope", async () => {
    currentGraph = { ...createGraph(), target: { kind: "storyboard", id: "sb-chapter-001-005" } };
    currentStoryboards = [{ id: "sb-chapter-001-005", episodeId: "chapter-001" }];
    freedomImage.mockResolvedValue({ url: "https://provider.test/image.png" });
    const saveImage = vi.fn().mockResolvedValue({
      success: true,
      url: "project://project-1/workflow/chapter-001/graph-1/generated-1.png",
      size: 456,
    });
    Object.defineProperty(window, "projectFiles", {
      configurable: true,
      value: { saveImage },
    });
    const saveGraph = vi.fn((graph: ImageWorkflowGraph) => {
      currentGraph = graph;
    });
    const { result } = renderHook(() => useImageWorkflowGeneration({
      workflowId: "graph-1",
      saveGraph,
      addMaterial: vi.fn(() => "material-9"),
    }));

    await act(async () => result.current.generateNode("generated-1"));

    expect(saveImage).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: "workflow/chapter-001/graph-1/generated-1.png",
    }));
  });

  it("does not mutate the graph when the prompt is blank", async () => {
    currentGraph = createGraph("   ");
    const saveGraph = vi.fn();
    const { result } = renderHook(() => useImageWorkflowGeneration({
      workflowId: "graph-1",
      saveGraph,
      addMaterial: vi.fn(),
    }));

    await act(async () => result.current.generateNode("generated-1"));

    expect(saveGraph).not.toHaveBeenCalled();
    expect(freedomImage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("请先填写生成提示词");
  });

  it("preserves the project-save failure when the bridge is unavailable", async () => {
    freedomImage.mockResolvedValue({ url: "https://provider.test/image.png" });
    const savedGraphs: ImageWorkflowGraph[] = [];
    const saveGraph = vi.fn((graph: ImageWorkflowGraph) => {
      currentGraph = graph;
      savedGraphs.push(graph);
    });
    const addMaterial = vi.fn();
    const { result } = renderHook(() => useImageWorkflowGeneration({
      workflowId: "graph-1",
      saveGraph,
      addMaterial,
    }));

    await act(async () => result.current.generateNode("generated-1"));

    expect(savedGraphs.at(-1)?.nodes[0]).toMatchObject({
      status: "failed",
      errorReason: "项目内图片保存失败",
    });
    expect(addMaterial).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("项目内图片保存失败");
  });

  it("marks generation failed when no project is active", async () => {
    activeProjectId = null;
    const savedGraphs: ImageWorkflowGraph[] = [];
    const saveGraph = vi.fn((graph: ImageWorkflowGraph) => {
      currentGraph = graph;
      savedGraphs.push(graph);
    });
    const { result } = renderHook(() => useImageWorkflowGeneration({
      workflowId: "graph-1",
      saveGraph,
      addMaterial: vi.fn(),
    }));

    await act(async () => result.current.generateNode("generated-1"));

    expect(savedGraphs.at(-1)?.nodes[0]).toMatchObject({
      status: "failed",
      errorReason: "请先选择项目",
    });
    expect(toast.error).toHaveBeenCalledWith("请先选择项目");
  });
});
