// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { textStreamMock, saveAgentWorkDataMock } = vi.hoisted(() => ({
  textStreamMock: vi.fn(),
  saveAgentWorkDataMock: vi.fn(),
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { textStream: textStreamMock },
}));

// ScriptTab 挂 harness 用:md-editor-rt 在 jsdom 里不可靠,最小替身(script-tab.test 同款)
vi.mock("md-editor-rt", () => ({
  MdPreview: ({ modelValue }: { modelValue: string }) => (
    <div data-testid="md-preview">{modelValue}</div>
  ),
  MdEditor: ({ modelValue }: { modelValue: string }) => (
    <div data-testid="md-editor">{modelValue}</div>
  ),
}));

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

vi.mock("@/lib/studio/source-memory", () => ({
  readSourceMemoryActionContext: vi.fn(async () => ({ success: true, context: "BIBLE" })),
}));

vi.mock("@/lib/studio/manuals", () => ({
  buildStudioManualContext: vi.fn(() => "MANUAL"),
  getAgentSkillPreset: vi.fn(() => ({ content: "SKILL" })),
}));

vi.mock("@/lib/studio/project-memory", () => ({
  buildProjectMemoryRecords: vi.fn(() => []),
  retrieveProjectMemory: vi.fn(() => []),
  formatProjectMemoryContext: vi.fn(() => ""),
}));

vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => ({ novelChapters: [], entityExtractions: {}, seriesBible: null }) },
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: "p1" }) },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SCRIPT_STAGE_STREAM_TIMEOUT_MS, useScriptStageActions } from "./useScriptStageActions";
import { ScriptTab } from "./ScriptTab";
import type { NovelChapter } from "@/types/studio";

const chapter = {
  id: "ch1",
  index: 0,
  title: "第一章",
  sourceText: "本章正文内容。",
  eventSummary: "",
  eventState: "",
  sourceId: "src1",
  revision: 1,
  importedAt: 1,
} as unknown as NovelChapter;

function renderActions() {
  return renderHook(() =>
    useScriptStageActions({
      workflowConfig: {} as never,
      manualCatalog: {} as never,
      projectName: "测试项目",
      novelChapterCount: 1,
      novelChapters: [chapter],
      agentWorkData: [],
      saveAgentWorkData: saveAgentWorkDataMock as never,
    }),
  );
}

describe("useScriptStageActions runScriptStage timeout", () => {
  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "剧本产出" });
  });

  it("passes the B+ long-output streaming budget through aiManager.textStream", async () => {
    // 10-11 GLM 超时根因锁：runScriptStage 链不传 timeoutMs 时流式 IPC 缺省 300s，
    // 39k 级 prompt 的 HTTP 回退一次性腿会被掐死在 AbortError。
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", chapter);
    });

    expect(textStreamMock).toHaveBeenCalledTimes(1);
    expect(textStreamMock.mock.calls[0]?.[0]).toMatchObject({
      binding: { agent: "scriptDraft" },
      maxTokens: 32000,
      timeoutMs: SCRIPT_STAGE_STREAM_TIMEOUT_MS,
    });
    expect(SCRIPT_STAGE_STREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
    expect(saveAgentWorkDataMock).toHaveBeenCalledTimes(1);
  });

  it("accumulates thinking increments separately and never persists them (1011 thinking 进流)", async () => {
    // 思考增量单独累积进 scriptStreaming.thinking,不混入 text;完成后状态清零,
    // saveAgentWorkData 只落正文——思考零持久化。
    let capturedOnChunk: ((delta: string, kind: "text" | "thinking") => void) | undefined;
    let resolveStream: ((value: { success: boolean; text: string }) => void) | undefined;
    textStreamMock.mockImplementation(
      (_req: unknown, onChunk: (delta: string, kind: "text" | "thinking") => void) => {
        capturedOnChunk = onChunk;
        return new Promise((resolve) => {
          resolveStream = resolve;
        });
      },
    );
    const { result } = renderActions();

    let stagePromise: Promise<unknown> = Promise.resolve();
    await act(async () => {
      stagePromise = result.current.handleScriptStage("scriptDraft", chapter);
    });

    // 流进行中:思考增量进 thinking 位,正文增量进 text 位,互不混入
    act(() => {
      capturedOnChunk?.("先想清楚主线。", "thinking");
      capturedOnChunk?.("# 剧本\n\n正文增量", "text");
    });
    expect(result.current.scriptStreaming).toMatchObject({
      key: "scriptDraft",
      scopeId: "ch1",
      text: "# 剧本\n\n正文增量",
      thinking: "先想清楚主线。",
    });

    await act(async () => {
      resolveStream?.({ success: true, text: "# 剧本\n\n正文增量" });
      await stagePromise;
    });

    // 完成后流状态整体清零(思考随态丢弃)
    expect(result.current.scriptStreaming).toBeNull();
    expect(saveAgentWorkDataMock).toHaveBeenCalledTimes(1);
    const savedData = saveAgentWorkDataMock.mock.calls[0]?.[1] as unknown as string;
    expect(savedData).toContain("正文增量");
    expect(savedData).not.toContain("先想清楚主线");
  });
});

describe("useScriptStageActions stream failure recovery", () => {
  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "剧本产出" });
  });

  // 1011 欠账⑤回归锁:textStream 顶层 reject 时 scriptStreaming 必须回落 null——
  // 否则 ScriptTab 生成/审核按钮(scriptStreaming!==null 即禁用)永久禁用无恢复入口。
  // 直挂真 hook 的 harness:按钮禁用态由 hook 真实流态驱动,非手工喂 prop。
  it("falls back the streaming state and re-enables the run buttons after textStream rejects", async () => {
    type ScriptStageActions = ReturnType<typeof useScriptStageActions>;
    let rejectStream: ((error: Error) => void) | undefined;
    textStreamMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStream = reject;
        }),
    );
    let latestActions: ScriptStageActions | undefined;
    let capturedRun: Promise<unknown> = Promise.resolve();
    const Harness = () => {
      latestActions = useScriptStageActions({
        workflowConfig: {} as never,
        manualCatalog: {} as never,
        projectName: "测试项目",
        novelChapterCount: 1,
        novelChapters: [chapter],
        agentWorkData: [],
        saveAgentWorkData: saveAgentWorkDataMock as never,
      });
      return (
        <ScriptTab
          novelChapters={[chapter]}
          agentWorkData={[]}
          saveAgentWorkData={saveAgentWorkDataMock as never}
          runStage={(...args) => {
            capturedRun = latestActions!.handleScriptStage(
              ...(args as Parameters<ScriptStageActions["handleScriptStage"]>),
            );
            capturedRun.catch(() => {}); // 拒绝由断言侧消费,防未处理拒绝
          }}
          runReview={latestActions.handleStageReview}
          manualContext=""
          directorContext=""
          styleSummary=""
          scriptStreaming={latestActions.scriptStreaming}
        />
      );
    };
    render(<Harness />);

    // 切进「一键生成」面板(控制页签),再点面板内同名运行按钮(第二个)
    fireEvent.click(screen.getAllByRole("button", { name: "一键生成" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "一键生成" })[1]);

    // 流挂起期间:按钮转「生成中...」且禁用(scriptStreaming 非 null)
    const busyButton = await screen.findByRole("button", { name: "生成中..." });
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    expect(latestActions!.scriptStreaming).toMatchObject({ key: "scriptDraft", scopeId: "ch1" });

    // 顶层 reject:异常仍向上抛(不吞),但 finally 兜底把流态打回 null
    await act(async () => {
      rejectStream?.(new Error("流式 IPC 通道异常"));
      await capturedRun.catch(() => {});
    });
    await expect(capturedRun).rejects.toThrow("流式 IPC 通道异常");
    expect(latestActions!.scriptStreaming).toBeNull();
    // 1011「解决其他的问题」:顶层异常按既有失败口径弹 toast(UI 必得提示)
    const { toast } = await import("sonner");
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("流式 IPC 通道异常");

    // 按钮恢复「一键生成」且不再禁用——可再点
    const recoveredButtons = screen.getAllByRole("button", { name: "一键生成" });
    expect((recoveredButtons[1] as HTMLButtonElement).disabled).toBe(false);

    // 真再点一次:第二轮流正常发起并成功落库(第一轮 reject 不落库)
    textStreamMock.mockResolvedValueOnce({ success: true, text: "二次生成产出" });
    fireEvent.click(recoveredButtons[1]);
    await act(async () => {
      await capturedRun.catch(() => {});
    });
    expect(textStreamMock).toHaveBeenCalledTimes(2);
    expect(latestActions!.scriptStreaming).toBeNull();
    expect(saveAgentWorkDataMock).toHaveBeenCalledTimes(1);
    const savedData = saveAgentWorkDataMock.mock.calls[0]?.[1] as unknown as string;
    expect(savedData).toContain("二次生成产出");
  });
});
