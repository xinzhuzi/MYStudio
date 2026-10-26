// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useScriptStageActions } from "./useScriptStageActions";
vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { textStream: vi.fn() } }));
vi.mock("@/lib/studio/source-memory", () => ({ readSourceMemoryActionContext: vi.fn(async () => ({ success: true, context: "设定" })) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const initialStudio = useStudioStore.getState();
const initialProject = useProjectStore.getState();
const chapter = { id: "c1", index: 1, title: "章", sourceText: "原话：等我问完，铃声才停。", importedAt: 1, revision: 1 };
const output = "# 道劫 EP1：问铃\n# 范围与目标：问铃 | 时长：0.5分钟\n# 已确定要求：未设\n\n## 剧情梗概\n问铃。\n\n1 山门 未定/外 ·约30秒\n人物：玄清子\n镜头1：铃声停了。\n\n## 改编追踪\n| 原文位置 | 是否采用 | 视听表达 | 待确认 |";
const pass = JSON.stringify({ stage: "script", passed: true, checks: { facts: true, chronology: true, dialogue: true, stageBoundary: true, visibleCharacters: true }, findings: [] });
const save = vi.fn<(...args: unknown[]) => string>(() => "work1");
function renderActions() {
  return renderHook(() => useScriptStageActions({ workflowConfig: useStudioStore.getState().workflowConfig, manualCatalog: {}, projectName: "测试", novelChapterCount: 1, novelChapters: [chapter], agentWorkData: [], saveAgentWorkData: save }));
}
beforeEach(() => {
  vi.mocked(aiManager.textStream).mockReset(); save.mockClear();
  useProjectStore.setState({ activeProjectId: "p1" });
  useStudioStore.setState({ ...initialStudio, novelChapters: [chapter], agentWorkData: [], workflowConfig: { ...initialStudio.workflowConfig, directorManualId: "Daojie_xianxia" } });
});
afterEach(() => { cleanup(); useStudioStore.setState(initialStudio, true); useProjectStore.setState(initialProject, true); });
describe("道劫剧本真实hook写回边界", () => {
  it.each(["{}", "审核通过", ""])('审核无效保持上一有效稿: %s', async (text) => {
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: output }).mockResolvedValueOnce({ success: true, text });
    const { result } = renderActions();
    await act(async () => { await result.current.handleScriptStage("scriptDraft", chapter); });
    expect(save.mock.calls.some(([key]) => key === "scriptDraft")).toBe(false);
    expect(save).toHaveBeenCalledWith("supervisionReport", expect.stringContaining(output), "c1", expect.anything());
  });
  it("审核期间占锁，通过才写回，第二次点击不增加调用", async () => {
    let resolveReview!: (value: { success: boolean; text: string }) => void;
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: output }).mockImplementationOnce(() => new Promise((resolve) => { resolveReview = resolve; }));
    const { result } = renderActions();
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.handleScriptStage("scriptDraft", chapter); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await result.current.handleScriptStage("scriptDraft", chapter); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2);
    await act(async () => { resolveReview({ success: true, text: pass }); await pending; });
    expect(save).toHaveBeenCalledWith("scriptDraft", output, "c1", expect.anything());
    expect(result.current.scriptStreaming).toBeNull();
  });
  it.each(["project", "source", "draft"])("审核期间%s变化，连报告都不跨项目/版本写回", async (change) => {
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: output }).mockImplementationOnce(async () => {
      if (change === "project") useProjectStore.setState({ activeProjectId: "p2" });
      if (change === "source") useStudioStore.setState({ novelChapters: [{ ...chapter, sourceText: "新原文" }] });
      if (change === "draft") useStudioStore.setState({ agentWorkData: [{ id: "new", key: "scriptDraft", episodeId: "c1", data: "人工新版", createdAt: 2, updatedAt: 2 }] });
      return { success: true, text: pass };
    });
    const { result } = renderActions();
    await act(async () => { await result.current.handleScriptStage("scriptDraft", chapter); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
  it("其他题材不增加审核请求", async () => {
    useStudioStore.setState({ workflowConfig: { ...initialStudio.workflowConfig, directorManualId: "other" } });
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: output });
    const { result } = renderActions();
    await act(async () => { await result.current.handleScriptStage("scriptDraft", chapter); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("scriptDraft", output, "c1", expect.anything());
  });
});
