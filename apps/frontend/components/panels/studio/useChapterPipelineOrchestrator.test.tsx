// @vitest-environment jsdom
/**
 * 批5 编排 hook 测试(10-11 pipeline-human-node-automation,design §2.6):
 * 触发=事件分析完成(本章 running→success 迁移;首帧只记录不发射;别章不触发)
 * 或手动;挂载即重启重算(僵尸收口+聚合卡,不重发)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useChapterPipelineOrchestrator } from "./useChapterPipelineOrchestrator";
import { useChapterPipelineStore } from "./chapter-pipeline";
import {
  computeChapterScriptFingerprint,
  currentScriptFingerprintSnapshot,
  useChapterUpstreamStore,
} from "./chapter-pipeline-stale";
import { useScriptAssetBatchStore } from "./script-asset-batch";
import { useDerivedChainStore } from "./derived-asset-chain";
import { useStoryboardBindingStore } from "./storyboard-asset-binding";

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const CHAPTER_ID = "chapter-001";

function setChapterEventState(state: "idle" | "running" | "success" | "failed" | undefined, id = CHAPTER_ID) {
  useStudioStore.setState({
    novelChapters: [
      { id, index: 1, title: "第一章", eventTaskState: state },
    ] as never,
  });
}

beforeEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
  useChapterPipelineStore.setState({ runsByChapter: {}, zombieReconciled: false });
  useChapterUpstreamStore.setState({ byChapter: {} });
  useScriptAssetBatchStore.setState({ runsByChapter: {} });
  useDerivedChainStore.setState({ runsByChapter: {} });
  useStoryboardBindingStore.setState({ runsByChapter: {} });
});

afterEach(() => {
  cleanup();
});

function renderOrchestrator(chapterId = CHAPTER_ID) {
  return renderHook(() =>
    useChapterPipelineOrchestrator({
      chapterId,
      projectId: "proj-1",
      visualManualId: undefined,
    }),
  );
}

describe("useChapterPipelineOrchestrator(触发与重启重算)", () => {
  it("挂载即重启重算:僵尸任务收口+聚合卡重建,不重发(无新任务入账)", () => {
    useStudioStore.setState({
      mediaTasks: [
        {
          id: "zombie", kind: "scriptAsset", status: "running", targetId: "character:x",
          episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1,
        },
        {
          id: "done", kind: "scriptAsset", status: "success", targetId: "character:y",
          episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1,
        },
      ] as never,
    });
    const before = useStudioStore.getState().mediaTasks.length;

    const { result } = renderOrchestrator();

    expect(useStudioStore.getState().mediaTasks.length).toBe(before);
    expect(useStudioStore.getState().mediaTasks.find((task) => task.id === "zombie")?.status).toBe("failed");
    expect(result.current.run).toMatchObject({ status: "done", recomputed: true });
    expect(result.current.card?.recomputed).toBe(true);
    expect(result.current.running).toBe(false);
  });

  it("触发=事件分析完成:本章 running→success 迁移即发车;首帧已有 success 不补发", async () => {
    setChapterEventState("running");
    const { result, rerender } = renderOrchestrator();
    // 首帧只记录不发射
    expect(result.current.run?.status).not.toBe("running");

    await act(async () => {
      setChapterEventState("success");
      rerender();
    });

    // 编排发车(前置不满足步自行 skipped;聚合卡收口=done)
    expect(useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]).toBeTruthy();
    expect(result.current.run?.status).toBe("done");

    // 首帧即 success(历史终态)不触发——重新挂载不补发
    useChapterPipelineStore.setState({ runsByChapter: {}, zombieReconciled: false });
    setChapterEventState("success");
    renderOrchestrator();
    expect(useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID]?.recomputed).toBe(true);
  });

  it("别章事件分析完成不触发本章编排(章隔离)", async () => {
    setChapterEventState("running");
    const { rerender } = renderOrchestrator(CHAPTER_ID);
    await act(async () => {
      setChapterEventState("success", "chapter-002");
      rerender();
    });
    // 只有重算卡,没有发车(发车的标志=startRun 置 running→done 的非 recompute 卡)
    const run = useChapterPipelineStore.getState().runsByChapter[CHAPTER_ID];
    expect(run?.recomputed).toBe(true);
  });

  it("staleTasks 实况派生:剧本变更后本 hook 即时给出黄标数据面", async () => {
    // 发车盖戳(现势空剧本的真实指纹,非编造串)
    useStudioStore.setState({ agentWorkData: [], novelChapters: [] } as never);
    useChapterUpstreamStore
      .getState()
      .recordDispatch(
        CHAPTER_ID,
        computeChapterScriptFingerprint(CHAPTER_ID, currentScriptFingerprintSnapshot()),
      );
    useStudioStore.setState({
      mediaTasks: [
        {
          id: "t1", kind: "scriptAsset", status: "success", targetId: "character:x",
          episodeId: CHAPTER_ID, createdAt: 1, updatedAt: 1,
        },
      ] as never,
    });
    const { result, rerender } = renderOrchestrator();
    expect(result.current.staleTasks).toEqual([]);

    await act(async () => {
      useStudioStore.setState({
        agentWorkData: [
          { key: "scriptDraft", episodeId: CHAPTER_ID, data: "重生成的新剧本", updatedAt: 1 },
        ] as never,
      });
      rerender();
    });
    expect(result.current.staleTasks.map((item) => item.taskId)).toEqual(["t1"]);
  });
});
