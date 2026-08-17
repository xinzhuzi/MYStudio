// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStudioStore } from "@/stores/studio/studio-store";
import { serializeStoryboardTable } from "@/lib/studio/storyboard-table";
import { formatStoryboardJson } from "@/lib/studio/storyboard-json";
import type { StoryboardItem } from "@/types/studio";
import { useWorkflowNodeEditor } from "./useWorkflowNodeEditor";
import {
  PRODUCTION_FLOW_EDGES,
  type ProductionFlowModel,
} from "./workflow-node-model";

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
});

const flowModel: ProductionFlowModel = {
  edges: PRODUCTION_FLOW_EDGES,
  nodes: [
    {
      id: "script",
      label: "剧本",
      description: "测试剧本节点",
      targetStage: "script",
      status: "ready",
      previewTitle: "剧本内容",
      previewLines: [],
      metrics: [],
      actions: [],
    },
  ],
};

const storyboardFlowModel: ProductionFlowModel = {
  ...flowModel,
  nodes: [
    ...flowModel.nodes,
    {
      id: "storyboardTable",
      label: "分镜表",
      description: "测试分镜表节点",
      targetStage: "storyboard",
      status: "ready",
      previewTitle: "分镜表",
      previewLines: [],
      metrics: [],
      actions: [],
    },
  ],
};

describe("useWorkflowNodeEditor", () => {
  it("opens script node draft from latest saved script work", () => {
    useStudioStore.setState({
      novelChapters: [
        {
          id: "chapter-1",
          index: 1,
          title: "第一章",
          sourceText: "原文",
          importedAt: 1,
        },
      ],
      agentWorkData: [
        {
          id: "work-1",
          key: "scriptDraft",
          episodeId: "chapter-1",
          data: "旧剧本",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "work-2",
          key: "scriptDraft",
          episodeId: "chapter-1",
          data: "最新剧本",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkflowNodeEditor({
        productionFlowModel: flowModel,
        productionEpisodeId: "chapter-1",
        saveAgentWorkData: useStudioStore.getState().saveAgentWorkData,
        saveScriptPlan: useStudioStore.getState().saveScriptPlan,
      }),
    );

    act(() => result.current.openNodeEditor("script"));

    expect(result.current.editingWorkflowNodeId).toBe("script");
    expect(result.current.workflowNodeDraft).toBe("最新剧本");
    expect(result.current.workflowNodeEditTitle).toBe("编辑剧本");
    expect(result.current.workflowNodeEditWritable).toBe(true);
  });

  it("names the canonical storyboard source for Remotion", () => {
    const { result } = renderHook(() =>
      useWorkflowNodeEditor({
        productionFlowModel: storyboardFlowModel,
        projectId: "project-1",
        productionEpisodeId: "chapter-1",
        saveAgentWorkData: useStudioStore.getState().saveAgentWorkData,
        saveScriptPlan: useStudioStore.getState().saveScriptPlan,
      }),
    );

    act(() => result.current.openNodeJson("storyboardTable"));

    expect(result.current.workflowNodeEditTitle).toBe("Remotion 分镜源数据");
    expect(result.current.workflowNodeEditJson).toBe(true);
    expect(result.current.workflowNodeEditReadOnlyJson).toBe(false);
    expect(result.current.workflowNodeEditWritable).toBe(true);
  });

  it("blocks weak three-block director plan edits before writeback", async () => {
    const saveAgentWorkData = vi.fn();
    const saveScriptPlan = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowNodeEditor({
        productionFlowModel: flowModel,
        productionEpisodeId: "chapter-1",
        saveAgentWorkData,
        saveScriptPlan,
      }),
    );

    act(() => result.current.openNodeEditor("scriptPlan"));
    act(() =>
      result.current.setWorkflowNodeDraft([
        "<scriptPlan>",
        "## 分场汇总表",
        "| 场次 | 场景名 | 台词条数 | 台词字数 | 情绪浓度 | 情绪基调（含 X→Y） |",
        "|---|---|---:|---:|---:|---|",
        "| Sc1 | 金水河码头 | 7 | 35 | 7 | 压迫→隐忍 |",
        "## 逐场注意事项",
        "- **Sc1**：独孤救人但不暴露身份。",
        "## 场间过渡",
        "| 场间 | 过渡方式 | 说明 |",
        "|---|---|---|",
        "| Sc1 → Sc2 | 硬切 | 进入客栈 |",
        "</scriptPlan>",
      ].join("\n")),
    );

    await act(async () => {
      await result.current.saveWorkflowNodeEdit();
    });

    expect(saveAgentWorkData).not.toHaveBeenCalled();
    expect(saveScriptPlan).not.toHaveBeenCalled();
    expect(result.current.editingWorkflowNodeId).toBe("scriptPlan");
  });

  it("does not open another chapter's storyboard source in canonical JSON mode", () => {
    const otherChapterStoryboard = {
      id: "sb-chapter-2-001",
      episodeId: "chapter-2",
      index: 1,
      trackKey: "2", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
      trackId: "",
      duration: 2,
      prompt: "另一章画面",
      videoDesc: "另一章镜头",
      assetIds: [],
      state: "ready",
      shotSemantics: {
        sceneViewpointId: "chapter-2-scene-1",
        personFree: true,
        visibleCharacters: [],
        visibleProps: [],
        actionIn: "起",
        actionOut: "止",
      },
    } as StoryboardItem;
    useStudioStore.setState({
      storyboards: [],
      agentWorkData: [{
        id: "work-chapter-2",
        key: "storyboardTable",
        episodeId: "chapter-2",
        data: serializeStoryboardTable([otherChapterStoryboard]),
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    const { result } = renderHook(() =>
      useWorkflowNodeEditor({
        productionFlowModel: flowModel,
        projectId: "project-1",
        productionEpisodeId: "chapter-1",
        saveAgentWorkData: useStudioStore.getState().saveAgentWorkData,
        saveScriptPlan: useStudioStore.getState().saveScriptPlan,
      }),
    );

    act(() => result.current.openNodeJson("storyboardTable"));

    expect(result.current.workflowNodeDraft).toBe("[]");
  });

  it("blocks invalid canonical JSON instead of falling back to Markdown writeback", async () => {
    const saveAgentWorkData = vi.fn();
    const validStoryboard = {
      id: "sb-chapter-1-001",
      episodeId: "chapter-1",
      index: 1,
      trackKey: "1", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
      trackId: "",
      duration: 2,
      prompt: "雨夜码头",
      videoDesc: "镜头向前推进",
      assetIds: [],
      state: "ready",
      shotSemantics: {
        sceneViewpointId: "dock",
        personFree: true,
        visibleCharacters: [],
        visibleProps: [],
        actionIn: "雨落",
        actionOut: "雨声延续",
      },
    } as StoryboardItem;
    const { result } = renderHook(() =>
      useWorkflowNodeEditor({
        productionFlowModel: storyboardFlowModel,
        projectId: "project-1",
        productionEpisodeId: "chapter-1",
        saveAgentWorkData,
        saveScriptPlan: vi.fn(),
      }),
    );

    act(() => result.current.openNodeJson("storyboardTable"));
    act(() => result.current.setWorkflowNodeDraft(serializeStoryboardTable([validStoryboard])));
    await act(async () => {
      await result.current.saveWorkflowNodeEdit();
    });

    expect(saveAgentWorkData).not.toHaveBeenCalled();
    expect(result.current.editingWorkflowNodeId).toBe("storyboardTable");
  });

  it("persists canonical cinematic markers and marks an existing shot stale", async () => {
    const previous = {
      id: "sb-chapter-1-001",
      episodeId: "chapter-1",
      index: 1,
      trackKey: "1",
      trackId: "",
      duration: 2,
      prompt: "雨夜码头",
      videoDesc: "镜头向前推进",
      assetIds: [],
      state: "ready",
      mediaRef: { kind: "image", path: "/same.png" },
      cinematic: {
        preset: "cinematic-dolly-in",
        parallaxStrength: 0.35,
        dofAperture: 2.8,
      },
      outputVersion: 2,
    } as unknown as StoryboardItem;
    useStudioStore.setState({ storyboards: [previous] });
    const { result } = renderHook(() =>
      useWorkflowNodeEditor({
        productionFlowModel: storyboardFlowModel,
        projectId: "project-1",
        productionEpisodeId: "chapter-1",
        saveAgentWorkData: vi.fn(),
        saveScriptPlan: vi.fn(),
      }),
    );

    act(() => result.current.openNodeJson("storyboardTable"));
    act(() => result.current.setWorkflowNodeDraft(formatStoryboardJson([{
      ...previous,
      cinematic: {
        preset: "cinematic-orbit",
        parallaxStrength: 0.6,
        dofAperture: 3.2,
      },
    } as unknown as StoryboardItem])));
    await act(async () => { await result.current.saveWorkflowNodeEdit(); });

    const saved = useStudioStore.getState().storyboards[0] as StoryboardItem & { cinematic?: unknown };
    expect(saved.cinematic).toEqual({ preset: "cinematic-orbit", parallaxStrength: 0.6, dofAperture: 3.2 });
    expect(saved.stale).toBe(true);
    expect(saved.outputVersion).toBe(2);
    expect(result.current.editingWorkflowNodeId).toBeNull();
  });
});
