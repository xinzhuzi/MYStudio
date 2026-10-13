// @vitest-environment jsdom

// livefire9/10 吞异常防线测试:画布节点动作经 index.tsx `void` 派发,async 链上
// 未捕获异常会被无声吞掉。handleProductionNodeAction 的整体 try/catch 必须把
// handleDirectorPlan / handleStoryboardTable 链上任何 throw 现形为:
//   1) toast.error,文案含 action.id 与错误 message;
//   2) console.error 指纹([handleProductionNodeAction] <actionId> <error>);
//   3) diagnostics logEvent「productionNodeAction.failed」(App 日志留痕,补上
//      装机「console 无人订阅、toast 一闪即逝」的取证盲区);
// 且不得向上抛——void 派发下上抛=无人接收=静默死亡。

import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProductionPlanningActions } from "./useProductionPlanningActions";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// 源记忆读取走桥,jsdom 无桥——打桩为恒成功,让用例聚焦吞异常防线本身。
vi.mock("@/lib/studio/source-memory", () => ({
  readSourceMemoryActionContext: vi.fn(async () => ({ success: true, context: "" })),
}));

const initialProjectState = useProjectStore.getState();
const initialStudioState = useStudioStore.getState();

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  let sequence = 0;
  const subtle = globalThis.crypto?.subtle;
  vi.stubGlobal("crypto", {
    subtle,
    randomUUID: vi.fn(() => `test-uuid-${++sequence}`),
  });
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    textCompletion: vi.fn(),
  };
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  useStudioStore.setState({
    ...initialStudioState,
    novelChapters: [{
      id: "chapter-002",
      index: 2,
      title: "第二章",
      importedAt: 1,
    }],
    agentWorkData: [{
      id: "work-draft-002",
      key: "scriptDraft",
      episodeId: "chapter-002",
      data: "第二章剧本正文",
      createdAt: 1,
      updatedAt: 1,
    }],
    // 分镜表链在 run 落库前需先命中导演规划(缺 plan 会提前 toast 返回,走不到注入点)
    scriptPlans: [{
      id: "plan-002",
      episodeId: "chapter-002",
      theme: "主题",
      visualStyle: "视觉风格",
      narrativeRhythm: "叙事节奏",
      sceneIntents: [],
      soundDirection: "声音方向",
      transitions: "转场",
      derivedAssetPlan: [],
    }],
    // 注入点:startAgentRun 在两个 handler 自身 try 之外,此处 throw 会沿 await
    // 链传到 handleProductionNodeAction 的整体 catch。
    startAgentRun: vi.fn(() => {
      throw new Error("startAgentRun 模拟失败");
    }),
  });
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  delete (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog;
  useProjectStore.setState(initialProjectState, true);
  useStudioStore.setState(initialStudioState, true);
});

function renderPlanningActions() {
  return renderHook(() => useProductionPlanningActions({
    activeProjectId: "project-1",
    manualCatalog: {},
    productionEpisodeId: "chapter-002",
    handleStageChange: vi.fn(),
    saveAgentWorkData: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["saveAgentWorkData"],
    saveScriptPlan: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["saveScriptPlan"],
    saveSeriesBible: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["saveSeriesBible"],
  }));
}

function collectFailedDiagnostics(write: ReturnType<typeof vi.fn>) {
  return write.mock.calls
    .map(([entry]) => entry as { message?: string; context?: { actionId?: string } })
    .filter((entry) => entry.message === "productionNodeAction.failed");
}

describe("useProductionPlanningActions.handleProductionNodeAction 吞异常防线", () => {
  it("generate-director-plan 链 throw:toast 含 action.id+错误 message,console.error 指纹,diagnostics 落盘,且不上抛", async () => {
    const diagnostics = vi.fn();
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write: diagnostics };
    const { result } = renderPlanningActions();

    await act(async () => {
      // 防线若上抛,此 await 直接 reject,用例即红
      await result.current.handleProductionNodeAction({
        id: "generate-director-plan",
        targetStage: "scriptPlan",
      });
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/环节动作失败\(generate-director-plan\):.*startAgentRun 模拟失败/),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[handleProductionNodeAction]",
      "generate-director-plan",
      expect.objectContaining({ message: "startAgentRun 模拟失败" }),
    );
    const failed = collectFailedDiagnostics(diagnostics);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.context?.actionId).toBe("generate-director-plan");
  });

  it("generate-storyboard-table 链 throw:同款防线(toast+console.error+diagnostics,不上抛)", async () => {
    const diagnostics = vi.fn();
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write: diagnostics };
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleProductionNodeAction({
        id: "generate-storyboard-table",
        targetStage: "storyboardTable",
      });
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/环节动作失败\(generate-storyboard-table\):.*startAgentRun 模拟失败/),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[handleProductionNodeAction]",
      "generate-storyboard-table",
      expect.objectContaining({ message: "startAgentRun 模拟失败" }),
    );
    const failed = collectFailedDiagnostics(diagnostics);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.context?.actionId).toBe("generate-storyboard-table");
  });
});
