// @vitest-environment jsdom
// 10-27 分镜H3双通道 P2a 批量器测试(PRD §13.1 批量器行):
// 候选筛选/缺帧摘要/超15s截断列示/串行推进/失败二分类(引擎失败不重掷)/软停/
// 断点续跑跳过 failedShotIds/防休眠起止/MPS 退化告警/收尾 toast 文案。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";

const comfyJsonMock = vi.hoisted(() => vi.fn());
const consumeMock = vi.hoisted(() => vi.fn());
const readB64Mock = vi.hoisted(() => vi.fn());
const powerSave = vi.hoisted(() => ({
  start: vi.fn(async () => ({ started: true, id: 1 })),
  stop: vi.fn(async () => ({ started: false })),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/assist/image-studio/comfy-execute", () => ({ comfySidecarJson: comfyJsonMock }));
vi.mock("@/lib/assist/image-studio/comfy-bridge-writeback-consumer", () => ({ consumeComfyBridgeWritebacks: consumeMock }));
vi.mock("@/lib/assist/image-studio/storyboard-overview-sync", () => ({ readStoryboardImageB64: readB64Mock }));
vi.mock("@/components/panels/settings/comfy-engine/comfy-engine-contract", () => ({ getComfyEngineClient: () => ({}) }));
vi.mock("sonner", () => ({ toast }));

import { useStoryboardH3VideoBatch, planStoryboardH3VideoBatch, runStoryboardH3ShotVideo } from "./use-storyboard-h3-video-batch";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStoryboardH3VideoSessionStore } from "@/stores/studio/storyboard-h3-video-session-store";

const initialStudioState = useStudioStore.getState();
const initialProjectState = useProjectStore.getState();

function shot(partial: Partial<StoryboardItem>): StoryboardItem {
  return {
    id: partial.id ?? "sb-1",
    episodeId: "chapter-001",
    index: partial.index ?? 1,
    duration: 6,
    prompt: partial.prompt ?? "剑修立于竹林。",
    videoDesc: partial.videoDesc ?? partial.prompt ?? "剑修立于竹林。",
    lines: partial.lines ?? "",
    state: "idle",
    ...partial,
  } as StoryboardItem;
}

/** 引擎 job 状态机编程:POST execute→jobId;GET jobs→依次耗尽 states 后停最后态。 */
function programEngine(states: Array<"running" | "complete" | "error">, errorMsg = "ComfyUI 执行失败: 模型缺失"): void {
  let getCalled = 0;
  comfyJsonMock.mockImplementation(async (method: string, path: string) => {
    if (method === "POST" && path === "/comfy/execute") return { jobId: "job-1" };
    if (method === "GET" && path.startsWith("/comfy/jobs/")) {
      const status = states[Math.min(getCalled, states.length - 1)] ?? "complete";
      getCalled += 1;
      return status === "error" ? { status: "error", error: errorMsg } : { status };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

/** 消费器模拟:第 n 次调用落第 n 个指定镜(逐镜序贯,与批量时序一致)。 */
function programLanding(shotIds: string[]): void {
  let calls = 0;
  consumeMock.mockImplementation(async () => {
    const id = shotIds[Math.min(calls, shotIds.length - 1)] ?? shotIds[0];
    calls += 1;
    useStudioStore.setState((prev) => ({
      videoCandidates: [
        ...prev.videoCandidates,
        {
          id: `h3-${id}-v${calls}`,
          trackId: "",
          provider: "h3-comfyui",
          filePath: "project-file://h3/x.mp4",
          meta: { policy: "ambient", bridgeItemId: calls, originProjectId: "proj-1", storyboardId: id },
          state: "ready",
          createdAt: 1,
        },
      ],
    }));
    return { processed: 1, landed: 1 };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useStudioStore.setState(initialStudioState, true);
  useProjectStore.setState(initialProjectState, true);
  useProjectStore.setState({ activeProjectId: "proj-1" } as never, false);
  useStoryboardH3VideoSessionStore.setState({ session: null });
  toast.error.mockClear(); toast.success.mockClear(); toast.info.mockClear(); toast.warning.mockClear();
  powerSave.start.mockClear(); powerSave.stop.mockClear();
  readB64Mock.mockReset();
  readB64Mock.mockResolvedValue("ZmFrZQ==");
  comfyJsonMock.mockReset();
  consumeMock.mockReset();
  consumeMock.mockResolvedValue({ processed: 0, landed: 0 });
  vi.stubGlobal("h3BatchPowerSave", powerSave);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function seedShots(items: StoryboardItem[]): void {
  useStudioStore.setState({ storyboards: items } as never, false);
  useStudioStore.setState({ novelChapters: [{ id: "chapter-001", title: "第一章" }] } as never, false);
}

/** 假时钟泵:推进时间让批量闭包的 sleep/轮询走完,直到 running=false(封顶防挂)。 */
async function pumpUntilDone(hook: { current: { state: { running: boolean } } }, maxMs = 120_000): Promise<void> {
  let waited = 0;
  while (hook.current.state.running && waited < maxMs) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    waited += 1_000;
  }
  expect(hook.current.state.running).toBe(false);
}

describe("planStoryboardH3VideoBatch(发车计划纯函数)", () => {
  it("候选=有首帧 image 镜;缺帧/已是 video 分开计数;超 15s 列截断", () => {
    const plan = planStoryboardH3VideoBatch([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "video", path: "v" } }),
      shot({ id: "c", index: 3 }),
      shot({ id: "d", index: 4, mediaRef: { kind: "image", path: "p4" }, durationTarget: 18 }),
    ]);
    expect(plan.candidates.map((item) => item.id)).toEqual(["a", "d"]);
    expect(plan.alreadyVideoCount).toBe(1);
    expect(plan.missingFrameCount).toBe(1);
    expect(plan.truncatedShotIndexes).toEqual([4]);
  });
});

describe("useStoryboardH3VideoBatch(串行批量)", () => {
  it("串行推进两镜全落地:防休眠起止+会话清空+收尾 toast 指路预看", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    programEngine(["complete"]);
    programLanding(["a", "b"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    expect(result.current.state.running).toBe(true);
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(2);
    expect(result.current.state.failed).toBe(0);
    expect(powerSave.start).toHaveBeenCalled();
    expect(powerSave.stop).toHaveBeenCalled();
    expect(useStoryboardH3VideoSessionStore.getState().session).toBeNull();
    const successArg = toast.success.mock.calls[0]?.[0] ?? "";
    expect(successArg).toContain("2 镜已出片");
    expect(successArg).toContain("预看成片");
    expect(comfyJsonMock).toHaveBeenCalledTimes(4); // 2 镜 × (POST+GET)
  });

  it("引擎失败镜记失败不重掷,继续下一镜;收尾含失败镜号", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    let posted = 0;
    comfyJsonMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/comfy/execute") { posted += 1; return { jobId: `job-${posted}` }; }
      // 第一镜(a)错;第二镜(b)成
      return posted === 1 ? { status: "error", error: "ComfyUI 执行失败: MPS 崩" } : { status: "complete" };
    });
    programLanding(["b"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start(); });
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(1);
    expect(result.current.state.failed).toBe(1);
    expect(posted).toBe(2); // 失败镜只 POST 一次=不重掷
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("S01 出片失败"));
    const successArg = toast.success.mock.calls[0]?.[0] ?? "";
    expect(successArg).toContain("失败 1 镜:S02".replace("S02", "S01"));
    // 会话保留失败清单(interrupted 之外的自然完成也清——失败镜走镜级 force,清单在收尾 toast 已示)
    expect(useStoryboardH3VideoSessionStore.getState().session).toBeNull();
  });

  it("断点续跑:上轮 failedShotIds 与 doneShotIds 均跳过", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
      shot({ id: "c", index: 3, mediaRef: { kind: "image", path: "p3" } }),
    ]);
    useStoryboardH3VideoSessionStore.setState({
      session: {
        sessionId: "s1", projectId: "proj-1", episodeId: "chapter-001",
        cursorShotIndex: 3, totalShots: 3, doneShotIds: ["a"], failedShotIds: ["b"],
        recipeId: "my-h3-i2v-31", tier: "960p", status: "interrupted", updatedAt: 1,
      },
    });
    programEngine(["complete"]);
    programLanding(["c"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start(); });
    await pumpUntilDone(result);
    expect(result.current.state.total).toBe(1);
    expect(result.current.state.done).toBe(1);
    expect(comfyJsonMock).toHaveBeenCalledTimes(2); // 只发 c 镜
    const infoArg = toast.info.mock.calls[0]?.[0] ?? "";
    expect(infoArg).toContain("跳过上轮失败镜 1 个");
  });

  it("缺帧镜禁静默:发车摘要 toast 明示缺帧数与截断镜", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "c", index: 3 }),
      shot({ id: "d", index: 4, mediaRef: { kind: "image", path: "p4" }, durationTarget: 20 }),
    ]);
    programEngine(["complete"]);
    programLanding(["a", "d"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start(); });
    const infoArg = toast.info.mock.calls[0]?.[0] ?? "";
    expect(infoArg).toContain("2 镜可出片");
    expect(infoArg).toContain("1 镜缺首帧已跳过");
    expect(infoArg).toContain("S04");
    await pumpUntilDone(result);
  });

  it("MPS 退化告警:第二镜耗时超首镜 2 倍触发一次 warning", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    let posted = 0;
    comfyJsonMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/comfy/execute") { posted += 1; return { jobId: `job-${posted}` }; }
      // 逐镜只挪系统钟(不触发定时器):首镜 1s 基线,第二镜 +61s > 2 倍 → 触发退化告警
      if (posted === 1) vi.setSystemTime(Date.now() + 1_000);
      if (posted === 2) vi.setSystemTime(Date.now() + 61_000);
      return { status: "complete" };
    });
    programLanding(["a", "b"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start(); });
    await pumpUntilDone(result);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("MPS 退化"));
  });
});

describe("runStoryboardH3ShotVideo(镜级重生成 force 路径)", () => {
  it("单镜执行+回收成功;防休眠边界开停", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    programEngine(["complete"]);
    programLanding(["a"]);
    await runStoryboardH3ShotVideo(useStudioStore.getState().storyboards[0]!, { tier: "480p" });
    expect(powerSave.start).toHaveBeenCalled();
    expect(powerSave.stop).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("已出片并回收"));
  });

  it("缺首帧直接拒绝(禁入引擎)", async () => {
    seedShots([shot({ id: "a", index: 1 })]);
    await expect(runStoryboardH3ShotVideo(useStudioStore.getState().storyboards[0]!)).rejects.toThrow("缺少首帧");
    expect(comfyJsonMock).not.toHaveBeenCalled();
  });
});
