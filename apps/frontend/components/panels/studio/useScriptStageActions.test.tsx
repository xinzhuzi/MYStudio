// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { textStreamMock, saveAgentWorkDataMock, loadWorkspaceMock } = vi.hoisted(() => ({
  textStreamMock: vi.fn(),
  saveAgentWorkDataMock: vi.fn(),
  loadWorkspaceMock: vi.fn(),
}));

vi.mock("@/lib/storage/project-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/project-storage")>();
  return {
    ...actual,
    loadStudioChapterWorkspace: loadWorkspaceMock,
  };
});

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

import { SCRIPT_STAGE_STREAM_TIMEOUT_MS, STORYBOARD_TABLE_STREAM_TIMEOUT_MS, useScriptStageActions } from "./useScriptStageActions";
import { ScriptTab } from "./ScriptTab";
import { buildStudioManualContext } from "@/lib/studio/manuals";
import { readSourceMemoryActionContext } from "@/lib/studio/source-memory";
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
    // S7 载荷缓解(10-14 livefire17):分镜表流式预算常量锁(ch002 定谳 1200s=判定性预算)
    expect(STORYBOARD_TABLE_STREAM_TIMEOUT_MS).toBe(1_200_000);
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

// ── 批2/批3 + riders RED(10-13-audit4-gen-chain,10-14;只写测试,不改生产码)──────────
// 红因钉板(读码坐标,10-14 现值):
// G2:互斥槽置位在 runScriptStage 体内(useScriptStageActions.ts:137),晚于 buildStageMessagesFull
//    的 await(handleScriptStage :292 / handleStageReview :325 的 readBibleContext)——组装期第二击
//    不受阻,两路都进 textStream。
// G4:runScriptStage 只看 result.text 原文(:175)判空,<think> 未闭合截断时 parseStageOutput
//    返回空串(script-planning.ts:219-227)照样落库,上一版被空串遮蔽。
// G5:userOverride 直通 messages.user(:304),字面占位串「（正在组装提示词…）」可被固化为实发内容。
// rider1(H9 集序):scriptStyleSummary 仅 episodeCount 设置时注「集数」(:75-77),本集序号(k/N)
//    恒缺位;而 method_story_development.md:13 要求「按总集数 N 确定本集坐标」。
const renderActionsWithWorkData = (agentWorkData: unknown[]) =>
  renderHook(() =>
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

const lastUserMessage = () => {
  const request = textStreamMock.mock.calls[0]?.[0] as {
    messages: { role: string; content: string }[];
  };
  return request.messages.find((m) => m.role === "user")?.content ?? "";
};

describe("useScriptStageActions 组装期并发锁(G2)", () => {
  const sourceMemoryMock = () => vi.mocked(readSourceMemoryActionContext);

  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "剧本产出" });
    sourceMemoryMock().mockReset();
    // archiveStatus 为真类型必填字段(source-memory.ts:357-360),mock 值与出厂 mock(:37)对齐补齐
    sourceMemoryMock().mockResolvedValue({ success: true, context: "BIBLE", archiveStatus: "available" });
  });

  it("组装期连点两击生成只发一路请求,锁在点击当下同步置位(早于任何 await)", async () => {
    // 慢速组装:档案检索挂起 → 首击停在 buildStageMessagesFull 的 await,未到 runScriptStage
    let releaseAssembly: (() => void) | undefined;
    sourceMemoryMock().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAssembly = () => resolve({ success: true, context: "BIBLE", archiveStatus: "available" });
        }),
    );
    const { result } = renderActions();

    let firstRun: Promise<unknown> = Promise.resolve();
    let secondRun: Promise<unknown> = Promise.resolve();
    act(() => {
      firstRun = result.current.handleScriptStage("scriptDraft", chapter);
      // 第二击落在首击组装期(档案检索挂起中)
      secondRun = result.current.handleScriptStage("scriptDraft", chapter);
    });

    // 锁位置(裁定:点击当下同步置位,早于任何 await):首击发起后流槽必须已被占位——
    // 现实现要等组装完成才在 runScriptStage 里置位(:137),此处先红
    expect(result.current.scriptStreaming).not.toBeNull();

    releaseAssembly?.();
    await act(async () => {
      await Promise.allSettled([firstRun, secondRun]);
    });
    // 单路:组装期第二击必须被拒,全程只 1 路 AI 请求(现实现两路都放行 → 红)
    expect(textStreamMock).toHaveBeenCalledTimes(1);
  });

  it("组装期生成+审核交叉同锁互斥:审核不得并发第二路", async () => {
    let releaseAssembly: (() => void) | undefined;
    sourceMemoryMock().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseAssembly = () => resolve({ success: true, context: "BIBLE", archiveStatus: "available" });
        }),
    );
    // 审核前置:须有既有剧本,否则审核入口早退(「请先生成」),测不到并发面
    const { result } = renderActionsWithWorkData([
      { id: "w1", key: "scriptDraft", episodeId: "ch1", data: "# v1 剧本", createdAt: 100, updatedAt: 100 },
    ]);

    let generateRun: Promise<unknown> = Promise.resolve();
    let reviewRun: Promise<unknown> = Promise.resolve();
    act(() => {
      generateRun = result.current.handleScriptStage("scriptDraft", chapter);
      // 交叉:生成仍在组装期(挂起),审核同步发起
      reviewRun = result.current.handleStageReview("scriptDraft", chapter);
    });

    // 同一把锁:交叉发起后流槽已被生成占位(审核须被拒)
    expect(result.current.scriptStreaming).not.toBeNull();

    releaseAssembly?.();
    await act(async () => {
      await Promise.allSettled([generateRun, reviewRun]);
    });
    // 生成+审核交叉同锁:全程只 1 路 AI 请求(现实现两路都放行 → 红)
    expect(textStreamMock).toHaveBeenCalledTimes(1);
  });

  // R4(10-14-audit4-residuals A批,保绿锁:8d280bdc finally 必释放已落=缺覆盖非缺行为,
  // 直绿+突变验证):组装失败(档案检索失败)早退路径——不发 AI 请求、失败明示、
  // 锁必释放(第二击立即可发起),防「组装失败把互斥锁带进坟墓」。
  it("组装失败(档案检索失败)早退:不发请求+失败明示+锁必释放可立即再发起(R4)", async () => {
    const { toast } = await import("sonner");
    // toast mock 为模块级单例(G4 同款):清零后「无互斥拒绝 toast」断言只看本用例调用
    vi.mocked(toast.error).mockClear();
    // 组装失败:档案检索返回失败 → buildStageMessagesFull ok:false → 早退(不进 textStream)
    vi.mocked(readSourceMemoryActionContext).mockResolvedValue({
      success: false,
      code: "resident-memory-too-large",
      error: "档案检索失败",
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", chapter);
    });

    // 早退不发 AI 请求 + 失败 toast 明示
    expect(textStreamMock).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith("档案检索失败");

    // 锁必释放实证:修复档案后第二击立即放行(锁未被首击早退带进坟墓)
    vi.mocked(readSourceMemoryActionContext).mockResolvedValue({
      success: true,
      context: "BIBLE",
      archiveStatus: "available",
    });
    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", chapter);
    });
    expect(textStreamMock).toHaveBeenCalledTimes(1);
    // 无互斥拒绝 toast(锁若未释放,第二击会加弹「正在生成/审核中，请等待完成后再试」)
    expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith(
      expect.stringContaining("正在生成/审核中"),
    );
  });
});

describe("useScriptStageActions 空输出不落库(G4)", () => {
  beforeEach(async () => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    // toast mock 为模块级单例,调用记录跨用例累积——清零后本用例的「不再弹成功 toast」才可断言
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  it("<think> 未闭合截断致解析为空 → 不落库、最新版仍上一版、提示截断+原文诊断", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      textStreamMock.mockResolvedValue({ success: true, text: "<think>推理未闭合直到输出戛然而止" });
      const { result } = renderActionsWithWorkData([
        { id: "w1", key: "scriptDraft", episodeId: "ch1", data: "# 上一版剧本v1", createdAt: 100, updatedAt: 100 },
      ]);

      await act(async () => {
        await result.current.handleScriptStage("scriptDraft", chapter);
      });

      // 空解析不落库:saveAgentWorkData 零调用 → w1 仍是最新版(不被空串遮蔽)
      // (现实现 :175 只看原文非空,parseStageOutput 空串照样落库 → 红)
      expect(saveAgentWorkDataMock).not.toHaveBeenCalled();
      // 原始文本留诊断位(console.error)
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("<think>");
      // 提示截断(PRD G4 口径「输出被截断/为空」),且不再弹成功 toast
      const { toast } = await import("sonner");
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(expect.stringContaining("输出被截断"));
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      // G2 联动(设计 §2:先解锁再提示,防锁死)——空输出路径结束后流槽必须已释放
      expect(result.current.scriptStreaming).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("useScriptStageActions 占位串守卫(G5)", () => {
  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "剧本产出" });
  });

  it("字面占位串「（正在组装提示词…）」不得作为 userOverride 实发,须回落完整组装产物", async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", chapter, "（正在组装提示词…）");
    });

    expect(textStreamMock).toHaveBeenCalledTimes(1);
    const userMessage = lastUserMessage();
    // 现实现 userOverride 直通(:304 userOverride || built.user)→ 实发即占位串 → 红;
    // 守卫后回落 built.user(完整组装产物,含本集信息节)
    expect(userMessage).not.toContain("（正在组装提示词…）");
    expect(userMessage).toContain("## 本集信息（1 章 = 1 集）");
  });
});

describe("原创章集序注入(H9 rider1)", () => {
  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "剧本产出" });
  });

  it("原创章生成请求注入集序「本集序号：k/N」,不依赖 workflowConfig.episodeCount 设置", async () => {
    const originalCh1 = {
      id: "ch-ord-1",
      index: 1,
      title: "第一章",
      eventSummary: "",
      eventState: "",
      sourceId: "src1",
      revision: 1,
      importedAt: 1,
    } as unknown as NovelChapter;
    const originalCh2 = {
      id: "ch-ord-2",
      index: 2,
      title: "第二章",
      eventSummary: "",
      eventState: "",
      sourceId: "src2",
      revision: 1,
      importedAt: 2,
    } as unknown as NovelChapter;
    const { result } = renderHook(() =>
      useScriptStageActions({
        // workflowConfig 空形:episodeCount 不设——集序注入不得被该开关门控(H9 缺陷本体)
        workflowConfig: {} as never,
        manualCatalog: {} as never,
        projectName: "测试项目",
        novelChapterCount: 2,
        novelChapters: [originalCh1, originalCh2],
        agentWorkData: [],
        saveAgentWorkData: saveAgentWorkDataMock as never,
      }),
    );

    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", originalCh2);
    });

    expect(textStreamMock).toHaveBeenCalledTimes(1);
    // method_story_development.md:13「按总集数 N 确定本集坐标」——原创章方法文档运行所需的本集
    // 坐标(k/N)必须随请求注入;现实现恒缺位 → 红
    expect(lastUserMessage()).toContain("本集序号：2/2");
  });
});

// ── C批 R12 拷问补刀(10-15):prd :19 点名 useScriptStageActions.ts:105-111 的
// .reverse().find 未在 C 批落地(主代理 blocking 令本批补刀)——latestScriptStageEntry
// 委托 workflow-helpers latestAgentWorkEntry 单源后,消费点 :267(本章稿)/:300(上一集稿)/
// :405(审核主体)全部随之一口径;数组序≠updatedAt 序时不再拿旧稿。
describe("useScriptStageActions 章内最新稿按 updatedAt 单口径(C批 R12 拷问补刀)", () => {
  beforeEach(() => {
    textStreamMock.mockReset();
    saveAgentWorkDataMock.mockReset();
    textStreamMock.mockResolvedValue({ success: true, text: "剧本产出" });
  });

  it("上一集剧本取前章最新稿按 updatedAt,不按数组序(R12)", async () => {
    const prevChapter = { ...chapter, id: "ch0", index: 0 };
    const targetChapter = { ...chapter, index: 1 };
    // 数组序:新稿在前、旧稿在后——reverse().find 取旧稿(RED 本体)
    const newerPrevDraft = { id: "w-prev-new", key: "scriptDraft" as const, episodeId: "ch0", data: "# 新版上一集剧本", createdAt: 2, updatedAt: 200 };
    const olderPrevDraft = { id: "w-prev-old", key: "scriptDraft" as const, episodeId: "ch0", data: "# 旧版上一集剧本", createdAt: 1, updatedAt: 100 };
    const { result } = renderHook(() =>
      useScriptStageActions({
        workflowConfig: {} as never,
        manualCatalog: {} as never,
        projectName: "测试项目",
        novelChapterCount: 2,
        novelChapters: [prevChapter, targetChapter],
        agentWorkData: [newerPrevDraft, olderPrevDraft] as never,
        saveAgentWorkData: saveAgentWorkDataMock as never,
      }),
    );

    await act(async () => {
      await result.current.handleScriptStage("scriptDraft", targetChapter);
    });

    const userMessage = lastUserMessage();
    expect(userMessage).toContain("## 上一集剧本");
    expect(userMessage).toContain("# 新版上一集剧本");
    expect(userMessage).not.toContain("# 旧版上一集剧本");
  });

  it("审核主体取本章最新稿按 updatedAt,不按数组序(R12)", async () => {
    const newerDraft = { id: "w-new", key: "scriptDraft" as const, episodeId: "ch1", data: "# 新版本章剧本", createdAt: 2, updatedAt: 200 };
    const olderDraft = { id: "w-old", key: "scriptDraft" as const, episodeId: "ch1", data: "# 旧版本章剧本", createdAt: 1, updatedAt: 100 };
    const { result } = renderActionsWithWorkData([newerDraft, olderDraft]);

    await act(async () => {
      await result.current.handleStageReview("scriptDraft", chapter);
    });

    const userMessage = lastUserMessage();
    expect(userMessage).toContain("剧本（审核主体）：\n# 新版本章剧本");
    expect(userMessage).not.toContain("# 旧版本章剧本");
  });
});

// ── 腿3②(LF14 §7.3,10-15 livefire18)────────────────────────────────────────
// 启动自动恢复态(持久化回放)不走 switchChapter→前章 agentWorkData 不在内存→
// 「上一集剧本」节缺失仍开(切章路径 G1 前章并入只盖切章)。登记为装载器 diagnostics:
// 持久化层有前章稿=真缺节(warn);持久化也无=前章从未生成剧本(合法缺节,debug 观察窗)。
describe("useScriptStageActions 上一集剧本缺节诊断(LF14 §7.3 腿3②)", () => {
  const prevCh = {
    id: "ch-prev",
    index: 1,
    title: "第一章",
    sourceText: "前章正文",
    eventSummary: "",
    eventState: "",
    importedAt: 1,
  } as unknown as NovelChapter;
  const activeCh = {
    id: "ch-active",
    index: 2,
    title: "第二章",
    sourceText: "本章正文",
    eventSummary: "",
    eventState: "",
    importedAt: 2,
  } as unknown as NovelChapter;
  const persistedPrevDraft = {
    id: "w-prev",
    key: "scriptDraft" as const,
    episodeId: "ch-prev",
    data: "前章盘上剧本",
    createdAt: 1,
    updatedAt: 1,
  };

  function installDiagnostics() {
    const write = vi.fn(async () => undefined);
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write };
    return write;
  }

  function previousEpisodeMissingWrites(write: ReturnType<typeof vi.fn>) {
    return (write.mock.calls as Array<[Record<string, unknown>]>)
      .map(([entry]) => entry)
      .filter((entry) => entry.level === "warn" && entry.operationId === "scriptStage.previousEpisodeMissing");
  }

  beforeEach(() => {
    loadWorkspaceMock.mockReset();
  });

  it("恢复态缺节且持久化层有前章稿 → warn(scriptStage.previousEpisodeMissing)", async () => {
    loadWorkspaceMock.mockImplementation(async (_pid: string, chapterId: string) =>
      chapterId === "ch-prev"
        ? { novelChapter: prevCh, domains: { agentWorkData: [persistedPrevDraft] } }
        : null,
    );
    const write = installDiagnostics();
    const { result } = renderHook(() =>
      useScriptStageActions({
        workflowConfig: {} as never,
        manualCatalog: {} as never,
        projectName: "测试项目",
        novelChapterCount: 2,
        novelChapters: [prevCh, activeCh],
        agentWorkData: [],
        saveAgentWorkData: saveAgentWorkDataMock as never,
      }),
    );
    try {
      await act(async () => {
        await result.current.previewStageUserMessage("scriptDraft", activeCh);
      });

      const warns = previousEpisodeMissingWrites(write);
      expect(warns).toHaveLength(1);
      expect((warns[0]!.context as Record<string, unknown>).previousChapterId).toBe("ch-prev");
    } finally {
      delete (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog;
    }
  });

  it("对照:前章从未生成剧本(持久化也无) → 不出 warn(合法缺节)", async () => {
    loadWorkspaceMock.mockResolvedValue(null);
    const write = installDiagnostics();
    const { result } = renderHook(() =>
      useScriptStageActions({
        workflowConfig: {} as never,
        manualCatalog: {} as never,
        projectName: "测试项目",
        novelChapterCount: 2,
        novelChapters: [prevCh, activeCh],
        agentWorkData: [],
        saveAgentWorkData: saveAgentWorkDataMock as never,
      }),
    );
    try {
      await act(async () => {
        await result.current.previewStageUserMessage("scriptDraft", activeCh);
      });

      expect(previousEpisodeMissingWrites(write)).toHaveLength(0);
    } finally {
      delete (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog;
    }
  });
});
