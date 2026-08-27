// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionFlowNodeModel } from "./workflow-node-model";
// 重副作用子 hook 全部打桩——本测试只钉 useStudioViewModel 自身的推导契约
vi.mock("./useNovelPipelineActions", () => ({ useNovelPipelineActions: () => ({}) }));
vi.mock("./useProductionPlanningActions", () => ({ useProductionPlanningActions: () => ({}) }));
vi.mock("./useScriptStageActions", () => ({
  useScriptStageActions: () => ({
    runStage: vi.fn(),
    runReview: vi.fn(),
    previewStageUserMessage: vi.fn(),
    setHeaderActions: vi.fn(),
    scriptStreaming: false,
  }),
}));
vi.mock("./useChapterAutoVideoActions", () => ({
  useChapterAutoVideoActions: () => ({
    chapterAutoVideoStatus: undefined,
    chapterAutoVideoRunning: false,
    handleRunChapterAutoVideo: vi.fn(),
    handleOpenFinalVideo: vi.fn(),
  }),
}));
vi.mock("./useWorkflowNodeEditor", () => ({
  useWorkflowNodeEditor: () => ({
    editingWorkflowNodeId: null,
    workflowNodeDraft: "",
    setWorkflowNodeDraft: vi.fn(),
    openNodeEditor: vi.fn(),
    closeNodeEditor: vi.fn(),
    saveWorkflowNodeEdit: vi.fn(),
    handleEnterWorkflowNodeStage: vi.fn(),
  }),
}));
vi.mock("./useStudioManualCatalog", () => ({ useStudioManualCatalog: () => ({ catalog: null }) }));
const FLOW_NODES = [{ id: "script", label: "剧本" }] as unknown as ProductionFlowNodeModel[];
vi.mock("./useProductionFlowModel", () => ({
  useProductionFlowModel: vi.fn(() => ({
    nodes: FLOW_NODES,
    remotionShotSlots: [],
    chapterAutoVideoStatus: undefined,
  })),
}));
vi.mock("@/stores/studio/studio-store-runtime", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadSourceBibleMirrorForActiveProject: vi.fn(),
}));
vi.mock("@/lib/studio/remotion/remotion-workspace-storage", () => ({
  buildRemotionProductionProfile: vi.fn(() => ({})),
  syncRemotionWorkspaceProductionProfile: vi.fn(),
}));
vi.mock("@/lib/studio/remotion-shot-render-request", () => ({
  subscribeRemotionShotRenderRequest: vi.fn(() => () => undefined),
}));
vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: {} }));

import { useStudioViewModel } from "./useStudioViewModel";
import { useProductionFlowModel } from "./useProductionFlowModel";
import { scriptPlanSourceFingerprint } from "./workflow-helpers";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";

describe("useStudioViewModel 数据枢纽契约(08-24 审查补测)", () => {
  beforeEach(() => {
    vi.mocked(useProductionFlowModel).mockClear();
    useStudioStore.setState({
      storyboards: [
        { id: "sb-1", episodeId: "episode-1", index: 1, prompt: "本章镜" },
        { id: "sb-2", episodeId: "chapter-999", index: 1, prompt: "他章镜" },
      ] as never,
      scriptPlans: [
        { episodeId: "episode-1", id: "plan-1" },
        { episodeId: "chapter-999", id: "plan-old" },
      ] as never,
      agentWorkData: [],
      entityExtractions: [],
      novelChapters: [],
      sourceBible: "",
      seriesBible: undefined,
      productionTracks: [],
      videoCandidates: [],
      workflowConfig: {
        workflowStage: "storyboard",
        platformSpec: "16:9",
      } as never,
    });
    useProjectStore.setState({ activeProject: undefined });
  });

  it("chapterStoryboards 按当前制作章节过滤,不串章", () => {
    const { result } = renderHook(() => useStudioViewModel());
    expect(result.current.chapterStoryboards).toHaveLength(1);
    expect(result.current.chapterStoryboards[0]?.id).toBe("sb-1");
  });

  it("无激活项目时 projectName 回落到默认名,不裸用品牌名", () => {
    const { result } = renderHook(() => useStudioViewModel());
    expect(result.current.projectName).toBe("漫影工作室项目");
  });

  it("productionFlowNodes 原样透传节点模型", () => {
    const { result } = renderHook(() => useStudioViewModel());
    expect(result.current.productionFlowNodes).toBe(FLOW_NODES);
  });

  it("directorPlan 取当前章节的规划", () => {
    const { result } = renderHook(() => useStudioViewModel());
    expect((result.current.directorPlan as { id: string } | undefined)?.id).toBe("plan-1");
  });

  it("production flow 只吃当前章 scriptPlans,旧章 ⑦ 预划不并排(R0 章过滤)", () => {
    renderHook(() => useStudioViewModel());
    // 重渲染会多次调用 hook,但每一次都必须只拿到当前章的规划
    const calls = vi.mocked(useProductionFlowModel).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [input] of calls) {
      expect(input.scriptPlans).toHaveLength(1);
      expect((input.scriptPlans as Array<{ id: string }>)[0]?.id).toBe("plan-1");
    }
  });

  it("production flow 拿到的当前剧本指纹 = 同提取源+同公式算出的值(二期 R1)", () => {
    const scriptText = "第一场金水河码头，独孤剑尘救下小杂役。";
    useStudioStore.setState({
      agentWorkData: [
        {
          id: "script-draft-fp",
          key: "scriptDraft",
          episodeId: "episode-1",
          data: scriptText,
          createdAt: 1,
          updatedAt: 1,
        },
      ] as never,
    });
    // 文件内前序测试的 hook 可能仍未卸载,beforeEach 的 setState 会触发它们
    // 重渲染并记入 mock——只断言本次 setState 之后新增的调用。
    const baseline = vi.mocked(useProductionFlowModel).mock.calls.length;
    renderHook(() => useStudioViewModel());
    const calls = vi.mocked(useProductionFlowModel).mock.calls.slice(baseline);
    expect(calls.length).toBeGreaterThan(0);
    for (const [input] of calls) {
      expect(input.currentScriptFingerprint).toBe(
        scriptPlanSourceFingerprint("episode-1", scriptText),
      );
    }
  });
});
