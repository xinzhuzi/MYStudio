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
import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import { readSourceMemoryActionContext } from "@/lib/studio/source-memory";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useNovelPipelineActions } from "./useNovelPipelineActions";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// 注入点:readSourceMemoryActionContext 位于 handler 体内既有 try(模型调用段)
// 之前的前置装配段,此处 reject 会沿 await 链传到整体 catch(若防线缺席则直接
// 穿透 void 派发)。默认=抛错(首个 describe 锚定防线);D22/R4 用例按需覆写实现。
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
  delete (window as unknown as { projectFiles?: unknown }).projectFiles;
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

// ── 10-19 C1 Step 7/8:D22 输入统一 + R6/R4 失败日志真实文本 ────────────────

const AI_PROVIDER = {
  id: "p1",
  platform: "openai-compatible",
  name: "P1",
  baseUrl: "https://x/v1",
  apiKey: "k",
  model: ["m1"],
  apiProtocol: "openai-compatible",
};

function configureEntityExtractionBinding() {
  useAPIConfigStore.setState({
    providers: [AI_PROVIDER],
    featureBindings: {},
    agentUseMode: "advanced",
    agentDeployments: [
      {
        key: "entityExtraction",
        name: "",
        desc: "",
        modelId: "m1",
        vendorId: "p1",
        temperature: 0.7,
        maxOutputTokens: 1234,
      },
    ],
  } as never);
}

describe("useNovelPipelineActions.handleEntityExtraction · R6/R4 失败日志真实文本(throw 位深串化)", () => {
  beforeEach(() => {
    configureEntityExtractionBinding();
    vi.mocked(readSourceMemoryActionContext).mockResolvedValue({
      success: true,
      context: undefined,
    } as never);
  });

  afterEach(() => {
    // 还原模块级默认实现(抛错),保护首个 describe 的防线用例
    vi.mocked(readSourceMemoryActionContext).mockImplementation(async () => {
      throw new Error("源记忆桥模拟失败");
    });
    useAPIConfigStore.setState({
      providers: [],
      featureBindings: {},
      agentUseMode: "advanced",
      agentDeployments: [],
    } as never);
  });

  it("result.error 为对象 → toast/失败原因为可读 JSON,不再是 [object Object]", async () => {
    const electronAPI = (window as unknown as { electronAPI?: Record<string, unknown> })
      .electronAPI as { textCompletion: ReturnType<typeof vi.fn> };
    electronAPI.textCompletion.mockResolvedValueOnce({
      success: false,
      error: { code: 1308, message: "已达到 5 小时的使用上限" },
    });

    const { result } = renderPipelineActions();
    await act(async () => {
      await result.current.handleEntityExtraction("chapter-002");
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('"code":1308'),
    );
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain("[object Object]");
    // 体内既有 entityExtraction.failed 诊断事件照发(错误已可读)
    expect(consoleError).not.toHaveBeenCalled(); // 非穿越者,不触发外层防线
  });

  it("result.error 为字符串 → 原文透出", async () => {
    const electronAPI = (window as unknown as { electronAPI?: Record<string, unknown> })
      .electronAPI as { textCompletion: ReturnType<typeof vi.fn> };
    electronAPI.textCompletion.mockResolvedValueOnce({
      success: false,
      error: "模型服务字符串错误形态",
    });

    const { result } = renderPipelineActions();
    await act(async () => {
      await result.current.handleEntityExtraction("chapter-002");
    });

    expect(toast.error).toHaveBeenCalledWith("模型服务字符串错误形态");
  });

  it("result.error 为 Error 实例 → message 透出(不落 [object Object])", async () => {
    const electronAPI = (window as unknown as { electronAPI?: Record<string, unknown> })
      .electronAPI as { textCompletion: ReturnType<typeof vi.fn> };
    electronAPI.textCompletion.mockResolvedValueOnce({
      success: false,
      error: new Error("模型实例错误形态"),
    });

    const { result } = renderPipelineActions();
    await act(async () => {
      await result.current.handleEntityExtraction("chapter-002");
    });

    expect(toast.error).toHaveBeenCalledWith("模型实例错误形态");
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain("[object Object]");
  });
});

describe("useNovelPipelineActions.handleEntityExtraction · D22 输入统一(scriptDraft > drama,不回落小说原文)", () => {
  beforeEach(() => {
    configureEntityExtractionBinding();
    vi.mocked(readSourceMemoryActionContext).mockResolvedValue({
      success: true,
      context: undefined,
    } as never);
    // 无草稿章:仅小说正文在内存(旧口径会回落它),drama 走 projectFiles 桥
    useStudioStore.setState({
      ...initialStudioState,
      novelChapters: [
        {
          id: "chapter-002",
          index: 2,
          title: "第二章",
          importedAt: 1,
          sourceText: "小说原文正文(旧回落源,新口径不得使用)",
        },
      ],
      agentWorkData: [],
    });
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      textCompletion: vi.fn().mockResolvedValue({
        success: true,
        text: "| character | 林晚 |  |  | 青衫剑修 |",
      }),
    };
    // drama 读取走真源通道 window.projectFiles(lib/bridge/project-files.ts),
    // 不在 electronAPI 上
    (window as unknown as { projectFiles?: unknown }).projectFiles = {
      readText: vi.fn().mockResolvedValue({
        success: true,
        text: "第2章 漫剧正文:人物:林晚",
      }),
    };
  });

  afterEach(() => {
    vi.mocked(readSourceMemoryActionContext).mockImplementation(async () => {
      throw new Error("源记忆桥模拟失败");
    });
    useAPIConfigStore.setState({
      providers: [],
      featureBindings: {},
      agentUseMode: "advanced",
      agentDeployments: [],
    } as never);
  });

  it("无草稿 → 读 drama(补零路径),不回落小说原文;提取批落对章", async () => {
    const { result } = renderPipelineActions();
    await act(async () => {
      await result.current.handleEntityExtraction("chapter-002");
    });

    const electronAPI = (window as unknown as { electronAPI?: Record<string, unknown> })
      .electronAPI as { textCompletion: ReturnType<typeof vi.fn> };
    const projectFiles = (window as unknown as { projectFiles?: Record<string, unknown> })
      .projectFiles as { readText: ReturnType<typeof vi.fn> };
    expect(projectFiles.readText).toHaveBeenCalledWith({
      projectId: "project-1",
      relativePath: "novel/drama/chapter-002_漫剧.md",
    });
    // 模型输入用的是 drama 正文,不是小说原文
    const userContent = electronAPI.textCompletion.mock.calls[0]?.[0]?.messages?.[1]
      ?.content as string;
    expect(userContent).toContain("漫剧正文");
    expect(userContent).not.toContain("旧回落源");
    expect(toast.success).toHaveBeenCalled();
  });

  it("无草稿且 drama 不可得 → 明确报错(不再静默用小说原文)", async () => {
    const projectFiles = (window as unknown as { projectFiles?: Record<string, unknown> })
      .projectFiles as { readText: ReturnType<typeof vi.fn> };
    projectFiles.readText.mockResolvedValue({ success: false, error: "ENOENT" });

    const { result } = renderPipelineActions();
    await act(async () => {
      await result.current.handleEntityExtraction("chapter-002");
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("没有可提取的剧本"),
    );
    const electronApi = (window as unknown as { electronAPI?: Record<string, unknown> })
      .electronAPI as { textCompletion: ReturnType<typeof vi.fn> };
    expect(electronApi.textCompletion).not.toHaveBeenCalled();
  });
});
