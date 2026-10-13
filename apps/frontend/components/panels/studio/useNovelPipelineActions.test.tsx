// @vitest-environment jsdom

// 1013 备忘落地(仿 d7a74a51 防线模式):handleEntityExtraction 曾是最后一个
// 裸奔派发点——index.tsx:104 `void viewModel.handleEntityExtraction(...)`,
// 而 handler 体内既有 try/catch 只覆盖模型调用段,前置装配段(环境检查→store
// 读取→实体清单→源记忆桥→prompt 构造)零 catch,任何 throw 都会穿透 void
// 派发静默死亡。整体 try/catch 必须把穿越异常现形为:
//   1) toast.error,文案含 episodeId 与错误 message;
//   2) console.error 指纹([handleEntityExtraction] <episodeId> <error>);
//   3) diagnostics logEvent「entityExtraction.dispatchFailed」(App 日志留痕,
//      与体内既有「entityExtraction.failed」区分:本事件=穿越 handler 自身
//      兜底的异常);
// 且不得向上抛——void 派发下上抛=无人接收=静默死亡。

import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useNovelPipelineActions } from "./useNovelPipelineActions";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// 注入点:readSourceMemoryActionContext 位于 handler 体内既有 try(模型调用段)
// 之前的前置装配段,此处 reject 会沿 await 链传到整体 catch(若防线缺席则直接
// 穿透 void 派发)。
vi.mock("@/lib/studio/source-memory", () => ({
  readSourceMemoryActionContext: vi.fn(async () => {
    throw new Error("源记忆桥模拟失败");
  }),
}));

const initialStudioState = useStudioStore.getState();

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    textCompletion: vi.fn(),
  };
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  // 剧本草稿指向 chapter-002,让 handler 越过「没有可提取的剧本」早退,
  // 走到前置装配段的注入点(源记忆桥)。
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
  });
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  vi.clearAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  delete (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog;
  useStudioStore.setState(initialStudioState, true);
});

function renderPipelineActions() {
  return renderHook(() => useNovelPipelineActions({
    activeProjectId: "project-1",
    projectName: "测试项目",
    saveAgentWorkData: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["saveAgentWorkData"],
    saveEntityExtraction: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["saveEntityExtraction"],
    updateNovelChapter: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["updateNovelChapter"],
  }));
}

describe("useNovelPipelineActions.handleEntityExtraction 吞异常防线", () => {
  it("前置装配段 throw(源记忆桥):toast 含 episodeId+错误 message,console.error 指纹,diagnostics 落盘,且不上抛", async () => {
    const diagnostics = vi.fn();
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write: diagnostics };
    const { result } = renderPipelineActions();

    await act(async () => {
      // 防线若上抛,此 await 直接 reject,用例即红
      await result.current.handleEntityExtraction("chapter-002");
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/资产提取失败\(chapter-002\):.*源记忆桥模拟失败/),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[handleEntityExtraction]",
      "chapter-002",
      expect.objectContaining({ message: "源记忆桥模拟失败" }),
    );
    const failed = diagnostics.mock.calls
      .map(([entry]) => entry as { message?: string; context?: { episodeId?: string } })
      .filter((entry) => entry.message === "entityExtraction.dispatchFailed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.context?.episodeId).toBe("chapter-002");
  });

  it("环境检查段前置 toast 早退不受防线影响(回归:不吞既有正常错误提示)", async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const { result } = renderPipelineActions();

    await act(async () => {
      await result.current.handleEntityExtraction("chapter-002");
    });

    expect(toast.error).toHaveBeenCalledWith("当前环境不支持模型调用");
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/资产提取失败/),
    );
  });
});
