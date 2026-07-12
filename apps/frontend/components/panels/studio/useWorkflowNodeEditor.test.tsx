// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStudioStore } from "@/stores/studio-store";
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
});
