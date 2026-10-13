// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
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
  // R2:剧本阶段改用 buildScriptManualContext(只注 script_narrative,父 I3 标题)
  buildScriptManualContext: vi.fn(() => "## 题材剧本规则（测试道劫）\nSCRIPT-NARRATIVE"),
  getAgentSkillPreset: vi.fn(() => ({ content: "SKILL" })),
}));

vi.mock("@/lib/studio/project-memory", () => ({
  buildProjectMemoryRecords: vi.fn(() => []),
  retrieveProjectMemory: vi.fn(() => []),
  formatProjectMemoryContext: vi.fn(() => ""),
}));

vi.mock("@/stores/studio/studio-store", () => {
  // G1:ScriptTab 渲染期以选择器形态订阅 activeChapterId——mock 须可调用(getState 之外
  // 补 hook 调用形态,纯对象会在渲染期炸「useStudioStore is not a function」);
  // mockState 无 activeChapterId → ScriptTab 回退首章,与该文件既有断言口径一致
  const mockState = { novelChapters: [], entityExtractions: {}, seriesBible: null };
  return {
    useStudioStore: Object.assign(
      (selector?: (state: typeof mockState) => unknown) => (selector ? selector(mockState) : mockState),
      { getState: () => mockState },
    ),
  };
});

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: "p1" }) },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SCRIPT_STAGE_STREAM_TIMEOUT_MS, useScriptStageActions } from "./useScriptStageActions";
import { ScriptTab } from "./ScriptTab";
import { buildStudioManualContext } from "@/lib/studio/manuals";
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
    vi.mocked(buildStudioManualContext).mockClear();
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
      timeoutMs: SCRIPT_STAGE_STREAM_TIMEOUT_MS,
    });
    // R2/父 I3 行为锁:题材剧本规则节(script_narrative)必须送达 AI 请求——mock 的
    // buildScriptManualContext 产物经 hook memo(:scriptDirectorContext)→ buildStageMessages
    // 接线;若丢线(如误用 buildStudioManualContext/漏传 directorContext)此处必红
    const request = textStreamMock.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    const userMessage = request.messages.find((m) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("## 题材剧本规则（测试道劫）");
    expect(userMessage).toContain("SCRIPT-NARRATIVE");
    // R2 真锁:旧全量上下文函数在生成路径被调=回归(会带回「# 视觉手册/# 导演手册」
    // 全量注入)——直接锁 mock 缺席,替代旧 not.toContain 标题串的恒真负向断言
    expect(vi.mocked(buildStudioManualContext)).not.toHaveBeenCalled();
    // styleSummary 生产格式行为锁:hook 的 scriptStyleSummary memo(:74/:78)经
    // manualContext 注入 user 段,画幅/单集时长格式行必须送达生成请求
    expect(userMessage).toContain("目标画幅：");
    expect(userMessage).toContain("单集参考时长：");
    expect(SCRIPT_STAGE_STREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
    expect(saveAgentWorkDataMock).toHaveBeenCalledTimes(1);
  });

  it("accumulates thinking increments separately and never persists them (1011 thinking 进流)", async () => {
    // 思考增量单独累积进 scriptStreaming.thinking,不混入 text;完成后状态清零,
    // saveAgentWorkData 只落正文——思考零持久化。
    // 任务四选一:采「增强」——resolve 值带 thinking 字段,额外锁住「即便 result 对象
    // 携带思考,落库也只取 result.text」;若实现改读 result.thinking/整体序列化落库必红。
    let capturedOnChunk: ((delta: string, kind: "text" | "thinking") => void) | undefined;
    let resolveStream: ((value: { success: boolean; text: string; thinking?: string }) => void) | undefined;
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
      // 增强:result 本体也带 thinking 字段——落库侧不得取它(只落 result.text)
      resolveStream?.({ success: true, text: "# 剧本\n\n正文增量", thinking: "先想清楚主线。" });
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

describe("useScriptStageActions stage review self-check metrics", () => {
  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "审核报告" });
  });

  // R4/G9 回归锁:审核 prompt 必带确定性自检指标节(父 I5)——审核以其数值为准,不自行计数
  it("injects the self-check metrics section into the review user message", async () => {
    const scriptData = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：3分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "△动作。",
      "甲：好。",
    ].join("\n");
    const { result } = renderHook(() =>
      useScriptStageActions({
        workflowConfig: {} as never,
        manualCatalog: {} as never,
        projectName: "测试项目",
        novelChapterCount: 1,
        novelChapters: [chapter],
        agentWorkData: [
          {
            id: "w1",
            key: "scriptDraft",
            episodeId: "ch1",
            data: scriptData,
            createdAt: 1,
            updatedAt: 1,
          } as never,
        ],
        saveAgentWorkData: saveAgentWorkDataMock as never,
      }),
    );

    await act(async () => {
      await result.current.handleStageReview("scriptDraft", chapter);
    });

    expect(textStreamMock).toHaveBeenCalledTimes(1);
    const request = textStreamMock.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    const userMessage = request.messages.find((m) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("## 自检指标（代码计算，以此为准）");
    // 锚存在性:indexOf 落空返回 -1 会使 toBeGreaterThan(-1) 恒真——先锁锚串确实存在
    expect(userMessage).toContain("剧本（审核主体）");
    expect(userMessage.indexOf("## 自检指标（代码计算，以此为准）")).toBeGreaterThan(
      userMessage.indexOf("剧本（审核主体）"),
    );
    expect(userMessage).toContain("场秒合计：30s");
    // G33 行为锁:审核 user 同注题材剧本规则节——mock 的 buildScriptManualContext 产物经
    // hook memo(scriptDirectorContext)→ handleStageReview directorNarrative 接线;若丢线此处必红。
    // 次序:审核主体 < 题材剧本规则节 < 自检指标
    expect(userMessage).toContain("## 题材剧本规则（测试道劫）");
    expect(userMessage).toContain("SCRIPT-NARRATIVE");
    expect(userMessage.indexOf("## 题材剧本规则（测试道劫）")).toBeGreaterThan(
      userMessage.indexOf("剧本（审核主体）"),
    );
    expect(userMessage.indexOf("## 题材剧本规则（测试道劫）")).toBeLessThan(
      userMessage.indexOf("## 自检指标（代码计算，以此为准）"),
    );
  });
});

describe("useScriptStageActions review freshness (F3)", () => {
  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "剧本产出" });
  });

  function renderWithWorkData(agentWorkData: unknown[]) {
    return renderHook(() =>
      useScriptStageActions({
        workflowConfig: {} as never,
        manualCatalog: {} as never,
        projectName: "测试项目",
        novelChapterCount: 1,
        novelChapters: [chapter],
        agentWorkData: agentWorkData as never,
        saveAgentWorkData: saveAgentWorkDataMock as never,
      }),
    );
  }

  const userMessageOf = () => {
    const request = textStreamMock.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    return request.messages.find((m) => m.role === "user")?.content ?? "";
  };

  // F3:审核早于最新剧本(针对上一版的旧审核)→ 即便 useReviewFeedback:true 也不注入审核意见,
  // 修订 toast 旗标同口径不成立——与 ScriptTab reviseMode 共用 isReviewFresh,不两处各写
  it("does not inject stale review feedback even when useReviewFeedback is true", async () => {
    const { result } = renderWithWorkData([
      { id: "w1", key: "scriptDraft", episodeId: "ch1", data: "# 新版剧本", createdAt: 200, updatedAt: 200 },
      { id: "w2", key: "scriptDraftReview", episodeId: "ch1", data: "🔴 台词超长", createdAt: 100, updatedAt: 100 },
    ]);

    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", chapter, undefined, { useReviewFeedback: true });
    });

    const userMessage = userMessageOf();
    expect(userMessage).not.toContain("🔴 台词超长");
    expect(userMessage).not.toContain("审核意见（逐条修复以下问题");
    expect(userMessage).not.toContain("在此基础上修订");
    const { toast } = await import("sonner");
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("剧本(含规划)已生成");
  });

  it("injects the fresh review with the previous script and flags the revision toast", async () => {
    const { result } = renderWithWorkData([
      { id: "w1", key: "scriptDraft", episodeId: "ch1", data: "# 当前剧本", createdAt: 200, updatedAt: 200 },
      { id: "w2", key: "scriptDraftReview", episodeId: "ch1", data: "🔴 台词超长", createdAt: 300, updatedAt: 300 },
    ]);

    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", chapter, undefined, { useReviewFeedback: true });
    });

    const userMessage = userMessageOf();
    expect(userMessage).toContain("🔴 台词超长");
    expect(userMessage).toContain("审核意见（逐条修复以下问题");
    expect(userMessage).toContain("在此基础上修订");
    expect(userMessage).toContain("# 当前剧本");
    const { toast } = await import("sonner");
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("已按审核修订「剧本(含规划)」，请重新审核确认");
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

    // 切进「一键生成」面板(控制页签),再点面板内同名运行按钮(第二个)。
    // G38 自释 aria-label 含可见文本「一键生成」(WCAG 2.5.3),故按正则匹配
    fireEvent.click(screen.getAllByRole("button", { name: /一键生成/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /一键生成/ })[1]);

    // 流挂起期间:按钮禁用且可访问名仍含「一键生成」(aria-label 恒定,scriptStreaming 非 null);
    // 流式态下控制入口可能卸载,取末位匹配(=生成按钮)。
    // 竞态消解:置流态前有微任务链(handleStageMessagesFull→readBibleContext 异步),
    // findAllByRole 只等元素存在不等禁用——高负载下立即断言会抢在 setScriptStreaming 前
    // 假红(10-12 门禁实发一次);改 waitFor 轮询到禁用,锁语义不变(挂起期必禁用)。
    const busyButton = () => {
      const buttons = screen.getAllByRole("button", { name: /一键生成/ });
      return buttons[buttons.length - 1] as HTMLButtonElement;
    };
    await waitFor(() => expect(busyButton().disabled).toBe(true));
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

    // 按钮恢复(可访问名恒含「一键生成」)且不再禁用——可再点(取末位匹配=生成按钮)
    const recoveredButtons = screen.getAllByRole("button", { name: /一键生成/ });
    const recoveredButton = recoveredButtons[recoveredButtons.length - 1];
    expect((recoveredButton as HTMLButtonElement).disabled).toBe(false);

    // 真再点一次:第二轮流正常发起并成功落库(第一轮 reject 不落库)
    textStreamMock.mockResolvedValueOnce({ success: true, text: "二次生成产出" });
    fireEvent.click(recoveredButton);
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
