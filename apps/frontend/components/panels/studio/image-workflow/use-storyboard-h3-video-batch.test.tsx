// @vitest-environment jsdom
// 10-27 分镜H3双通道 P2a 批量器测试+二期硬取消(PRD §13.1/§14.2.5):
// 候选筛选/缺帧摘要/超15s截断列示/串行推进/失败二分类(引擎失败不重掷)/
// 硬取消停止(stop→cancel 端点被调/组装段无 jobId 不发/job error 失败带
// 停止前缀且循环退出/complete 后 terminal 无副作用镜照常 done/双击仅一次
// cancel/回收窗不被打断)/断点续跑跳过 failedShotIds/防休眠起止/MPS 退化
// 告警/收尾 toast 文案。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";

const comfyJsonMock = vi.hoisted(() => vi.fn());
const consumeMock = vi.hoisted(() => vi.fn());
const readB64Mock = vi.hoisted(() => vi.fn());
const persistVideosMock = vi.hoisted(() => vi.fn());
const getRemoteEngineMock = vi.hoisted(() => vi.fn());
const powerSave = vi.hoisted(() => ({
  start: vi.fn(async () => ({ started: true, id: 1 })),
  stop: vi.fn(async () => ({ started: false })),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/assist/image-studio/comfy-execute", () => ({
  comfySidecarJson: comfyJsonMock,
  persistComfyVideosFromResult: persistVideosMock,
}));
vi.mock("@/lib/assist/image-studio/comfy-sidecar-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assist/image-studio/comfy-sidecar-bridge")>();
  return { ...actual, getRemoteEngine: getRemoteEngineMock };
});
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
  // T16 远端回流门控默认值:本地托管引擎(零入库调用);入库 mock 默认空摘要
  getRemoteEngineMock.mockReset();
  getRemoteEngineMock.mockResolvedValue({ url: null, effective: "http://127.0.0.1:17598", source: "managed" });
  persistVideosMock.mockReset();
  persistVideosMock.mockResolvedValue({ persisted: 0, failed: 0 });
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

  // ── 10-27 windows-fasth3-mainline 接线:recipeId 通道 ──────────────────────
  it("start({recipeId:\"my-fasth3-i2v-27\"}) 派发 FastH3 模板对;会话在档同配方", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    const bodies: Array<Record<string, unknown>> = [];
    let posted = 0;
    comfyJsonMock.mockImplementation(async (method: string, path: string, init?: { body?: Record<string, unknown> }) => {
      if (method === "POST" && path === "/comfy/execute") {
        posted += 1;
        bodies.push(init?.body ?? {});
        return { jobId: `job-${posted}` };
      }
      return { status: "complete" };
    });
    programLanding(["a"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p", recipeId: "my-fasth3-i2v-27" }); });
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(1);
    expect(posted).toBe(1);
    const graph = (bodies[0]!.graph ?? {}) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(graph["29"].inputs.sampler_name).toBe("res_multistep");          // FastH3 换芯件真到场
    expect(graph["40"].inputs.attention).toBe("comfy kitchen attention");
    expect(graph["43"].class_type).toBe("BlockSparseAttention");
    expect(graph["21"].class_type).toBe("CLIPLoader");                       // 旧线 GGUF 退役
    // 附件透传(extraPngInfo=FastH3 画布档,D1 回写归属链)
    const extra = (bodies[0]!.extraPngInfo ?? {}) as { nodes?: Array<{ id: number; type: string }> };
    const types = (extra.nodes ?? []).map((node) => node.type);
    expect(types).toContain("BlockSparseAttention");
    expect(types).not.toContain("SolAttnPatch");
    expect(useStoryboardH3VideoSessionStore.getState().session).toBeNull(); // 完成即清(在档期间配方已生效)
  });

  it("续跑复用在档配方:中断会话 recipeId=my-fasth3-i2v-27 不带参 start 不静默切回旧线", async () => {
    seedShots([shot({ id: "c", index: 3, mediaRef: { kind: "image", path: "p3" } })]);
    useStoryboardH3VideoSessionStore.setState({
      session: {
        sessionId: "s1", projectId: "proj-1", episodeId: "chapter-001",
        cursorShotIndex: 3, totalShots: 3, doneShotIds: ["a", "b"], failedShotIds: [],
        recipeId: "my-fasth3-i2v-27", tier: "480p", status: "interrupted", updatedAt: 1,
      },
    });
    const bodies: Array<Record<string, unknown>> = [];
    comfyJsonMock.mockImplementation(async (method: string, path: string, init?: { body?: Record<string, unknown> }) => {
      if (method === "POST" && path === "/comfy/execute") {
        bodies.push(init?.body ?? {});
        return { jobId: "job-1" };
      }
      return { status: "complete" };
    });
    programLanding(["c"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start(); }); // 不带 recipeId
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(1);
    const graph = (bodies[0]!.graph ?? {}) as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph["29"].inputs.sampler_name).toBe("res_multistep");
  });

  it("画布登记配方(无 API 模板)禁发车:toast 报错且零派发", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    programEngine(["complete"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ recipeId: "my-fasth3-t2v-26" }); });
    expect(result.current.state.running).toBe(false);
    expect(comfyJsonMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("没有 API 模板"));
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

describe("useStoryboardH3VideoBatch(硬取消停止,PRD §14.2 Q2 兑现)", () => {
  /** 取消端点被调的 POST 路径清单(mock comfySidecarJson 断言用)。 */
  function cancelCallPaths(): string[] {
    return comfyJsonMock.mock.calls
      .filter(([method, path]) => method === "POST" && String(path).includes("/cancel"))
      .map(([, path]) => String(path));
  }

  it("stop 后 cancel 端点被调;job error 后当前镜记失败(带停止前缀)且循环退出", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    let cancelRequested = false;
    let executePosts = 0;
    comfyJsonMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/comfy/execute") {
        executePosts += 1;
        return { jobId: "job-1" };
      }
      if (method === "POST" && path === "/comfy/jobs/job-1/cancel") {
        cancelRequested = true;
        return { cancelled: true, reason: "forwarded" };
      }
      if (method === "GET" && path === "/comfy/jobs/job-1") {
        // 引擎打断收尾链:cancel 后 job 转 error(前端轮询≤5s 见错抛出)
        return cancelRequested
          ? { status: "error", error: "ComfyUI 执行失败: Prompt was cancelled" }
          : { status: "running" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    consumeMock.mockResolvedValue({ processed: 0, landed: 0 });
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    // 泵一步让 POST 落定+onJobId 记上(此时 job=running,轮询睡 5s)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    act(() => { result.current.stop(); });
    await pumpUntilDone(result);
    expect(cancelCallPaths()).toEqual(["/comfy/jobs/job-1/cancel"]);
    expect(toast.info).toHaveBeenCalledWith("已请求取消当前镜(引擎打断通常数秒内生效)");
    expect(result.current.state.done).toBe(0);
    expect(result.current.state.failed).toBe(1);
    expect(executePosts).toBe(1); // 循环退出:第二镜未派发
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("已按停止请求取消"));
    // 断点续跑语义不变:被取消镜入 failedShotIds,会话 interrupted(修复走镜级 force)
    const session = useStoryboardH3VideoSessionStore.getState().session;
    expect(session?.status).toBe("interrupted");
    expect(session?.failedShotIds).toEqual(["a"]);
  });

  it("组装段(jobId 未记)stop 不发 cancel:当前镜照常跑完,批在下一镜顶退出", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    let executePosts = 0;
    comfyJsonMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/comfy/execute") {
        executePosts += 1;
        return { jobId: `job-${executePosts}` };
      }
      if (method === "GET" && path.startsWith("/comfy/jobs/")) return { status: "complete" };
      throw new Error(`unexpected ${method} ${path}`);
    });
    programLanding(["a"]);
    // 组装段闸门:读首帧挂起——链停在当前镜组装段(POST 未发,jobId 未记)
    let releaseB64: ((value: string) => void) | null = null;
    readB64Mock.mockImplementation(() => new Promise<string>((resolve) => { releaseB64 = resolve; }));
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(releaseB64).toBeTruthy(); // 已进入组装段
    act(() => { result.current.stop(); }); // jobId 未记 → 不发 cancel(降级软停)
    await act(async () => { releaseB64!("ZmFrZQ=="); });
    await pumpUntilDone(result);
    expect(cancelCallPaths()).toEqual([]);
    expect(result.current.state.done).toBe(1); // 当前镜照常落地(已提交生成不浪费)
    expect(result.current.state.failed).toBe(0);
    expect(executePosts).toBe(1); // 下一镜顶退出
  });

  it("complete 后 stop:cancel 返 terminal 无副作用,回收窗不被打断,镜照常 done 不记失败", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    let cancelRequested = false;
    let executePosts = 0;
    comfyJsonMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/comfy/execute") {
        executePosts += 1;
        return { jobId: "job-1" };
      }
      if (method === "POST" && path === "/comfy/jobs/job-1/cancel") {
        cancelRequested = true;
        return { cancelled: false, reason: "terminal" }; // job 已 complete,幂等应答
      }
      if (method === "GET" && path === "/comfy/jobs/job-1") return { status: "complete" };
      throw new Error(`unexpected ${method} ${path}`);
    });
    // 回收窗门闸:cancel 请求过之后才让片落账——证明停止不硬断回收轮询(片已生成不丢弃)
    consumeMock.mockImplementation(async () => {
      if (!cancelRequested) return { processed: 0, landed: 0 };
      useStudioStore.setState((prev) => ({
        videoCandidates: [
          ...prev.videoCandidates,
          {
            id: "h3-a-v1",
            trackId: "",
            provider: "h3-comfyui",
            filePath: "project-file://h3/a.mp4",
            meta: { policy: "ambient", bridgeItemId: 1, originProjectId: "proj-1", storyboardId: "a" },
            state: "ready",
            createdAt: 1,
          },
        ],
      }));
      return { processed: 1, landed: 1 };
    });
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    // 泵到 job complete+进入回收窗(第一次 consume 未落账,回收睡 5s)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    act(() => { result.current.stop(); });
    await pumpUntilDone(result);
    expect(cancelCallPaths()).toEqual(["/comfy/jobs/job-1/cancel"]);
    expect(result.current.state.done).toBe(1); // 镜 a 照常 done
    expect(result.current.state.failed).toBe(0); // 不记失败
    expect(executePosts).toBe(1); // 下一镜顶退出
  });

  it("双击 stop 仅发一次 cancel(jobId 读后即清,幂等)", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    let cancelRequested = false;
    comfyJsonMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/comfy/execute") return { jobId: "job-1" };
      if (method === "POST" && path === "/comfy/jobs/job-1/cancel") {
        cancelRequested = true;
        return { cancelled: true, reason: "forwarded" };
      }
      if (method === "GET" && path === "/comfy/jobs/job-1") {
        return cancelRequested
          ? { status: "error", error: "ComfyUI 执行失败: Prompt was cancelled" }
          : { status: "running" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    consumeMock.mockResolvedValue({ processed: 0, landed: 0 });
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    act(() => { result.current.stop(); });
    act(() => { result.current.stop(); }); // 双击:jobId 已被首次 stop 读走 → 不再发
    await pumpUntilDone(result);
    expect(cancelCallPaths()).toEqual(["/comfy/jobs/job-1/cancel"]);
    expect(result.current.state.failed).toBe(1);
  });
});

describe("useStoryboardH3VideoBatch(发车前孤儿对拍 skipShotIds,PRD §14.3 件三)", () => {
  it("start({skipShotIds}) 排除该镜不派发;发车摘要孤儿行如实播报", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
      shot({ id: "c", index: 3, mediaRef: { kind: "image", path: "p3" } }),
    ]);
    programEngine(["complete"]);
    programLanding(["b"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ skipShotIds: ["a", "c"] }); });
    const infoArg = toast.info.mock.calls[0]?.[0] ?? "";
    expect(infoArg).toContain("1 镜可出片");
    expect(infoArg).toContain("盘上已有片跳过 2 镜");
    await pumpUntilDone(result);
    expect(result.current.state.total).toBe(1);
    expect(result.current.state.done).toBe(1);
    expect(comfyJsonMock).toHaveBeenCalledTimes(2); // 只发 b 镜 × (POST+GET)
  });

  it("候选全被孤儿跳过:零派发+如实摘要(不误报「均已齐备」)", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ skipShotIds: ["a"] }); });
    const infoArg = toast.info.mock.calls[0]?.[0] ?? "";
    expect(infoArg).toContain("本轮无可出片镜");
    expect(infoArg).toContain("1 镜已按盘上既有片跳过");
    expect(comfyJsonMock).not.toHaveBeenCalled();
    expect(result.current.state.running).toBe(false);
  });

  it("skipShotIds 含不在册 id 不影响全量派发(「仍直接出片」路径=不传即全量)", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    programEngine(["complete"]);
    programLanding(["a", "b"]);
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ skipShotIds: ["not-a-shot"] }); });
    const infoArg = toast.info.mock.calls[0]?.[0] ?? "";
    expect(infoArg).toContain("2 镜可出片");
    expect(infoArg).not.toContain("盘上已有片跳过");
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(2);
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

// ── T16(10-29 D1 复核 gap2):远端 settings 引擎产物 b64 回流入库门控 ───────────────────────────

describe("useStoryboardH3VideoBatch(远端 settings 产物回流,T16 复核 gap2)", () => {
  /** 引擎 job 应答带 result.videos(complete 即带 b64 产物,远端回流通形态)。 */
  function programEngineWithVideos(videos: Array<{ nodeId?: string; filename?: string; b64: string }>): void {
    comfyJsonMock.mockImplementation(async (method: string, path: string) => {
      if (method === "POST" && path === "/comfy/execute") return { jobId: "job-1" };
      if (method === "GET" && path.startsWith("/comfy/jobs/")) {
        return { status: "complete", result: { videos } };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
  }

  it("远端 settings 生效:complete 结果的 videos 经 persistComfyVideosFromResult 入库发起项目", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
    ]);
    programEngineWithVideos([{ nodeId: "21", filename: "H3_a.mp4", b64: "QUJD" }]);
    programLanding(["a", "b"]);
    getRemoteEngineMock.mockResolvedValue({ url: "http://192.168.0.101:17598", effective: "http://192.168.0.101:17598", source: "settings" });
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(2);
    expect(persistVideosMock).toHaveBeenCalledTimes(2); // 逐镜各入库一次
    expect(persistVideosMock).toHaveBeenCalledWith(
      expect.objectContaining({ videos: [expect.objectContaining({ nodeId: "21", filename: "H3_a.mp4", b64: "QUJD" })] }),
      "proj-1", // 发起项目快照(活动项目)
    );
  });

  it("本地模式(env/managed/fallback)零入库调用:收件箱已回收,再写=双写", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" } }),
      shot({ id: "c", index: 3, mediaRef: { kind: "image", path: "p3" } }),
    ]);
    programEngineWithVideos([{ nodeId: "21", filename: "H3.mp4", b64: "QUJD" }]);
    programLanding(["a", "b", "c"]);
    getRemoteEngineMock
      .mockResolvedValueOnce({ url: null, effective: "http://127.0.0.1:17598", source: "env" })
      .mockResolvedValueOnce({ url: null, effective: "http://127.0.0.1:17598", source: "managed" })
      .mockResolvedValueOnce({ url: null, effective: "http://127.0.0.1:17598", source: "fallback" });
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(3);
    expect(getRemoteEngineMock).toHaveBeenCalledTimes(3); // 判定被咨询(有 videos 才到这门)
    expect(persistVideosMock).not.toHaveBeenCalled();
  });

  it("判定失败(getRemoteEngine 网络错)保守跳过:零入库调用,批量照常推进", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    programEngineWithVideos([{ nodeId: "21", filename: "H3.mp4", b64: "QUJD" }]);
    programLanding(["a"]);
    getRemoteEngineMock.mockRejectedValue(new Error("sidecar 不可达"));
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(1); // 判定失败不炸镜(按非 settings 跳过)
    expect(persistVideosMock).not.toHaveBeenCalled();
  });

  it("result 无 videos 短路:远端判定免咨询(既有 complete-无-result 形态零多余 GET)", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    programEngine(["complete"]); // 既有测试形态:complete 不带 result
    programLanding(["a"]);
    getRemoteEngineMock.mockResolvedValue({ url: "http://192.168.0.101:17598", effective: "http://192.168.0.101:17598", source: "settings" });
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ tier: "480p" }); });
    await pumpUntilDone(result);
    expect(result.current.state.done).toBe(1);
    expect(getRemoteEngineMock).not.toHaveBeenCalled(); // 无产物不探活
    expect(persistVideosMock).not.toHaveBeenCalled();
  });
});

// ── multiseg 分派/超时/40s 顶拒(PRD 10-27 §14.1.4/§14.1.6 共享面)──────────────────────────────

describe("useStoryboardH3VideoBatch(multiseg 分派与超时,PRD §14.1.4)", () => {
  /** POST /comfy/execute 请求体捕捉器(分派与超时断言的数据源)。 */
  function captureExecuteBodies(): Array<{ graph: Record<string, { class_type: string }>; timeoutS: number }> {
    const bodies: Array<{ graph: Record<string, { class_type: string }>; timeoutS: number }> = [];
    comfyJsonMock.mockImplementation(async (method: string, path: string, options?: { body?: Record<string, unknown> }) => {
      if (method === "POST" && path === "/comfy/execute") {
        bodies.push(options?.body as { graph: Record<string, { class_type: string }>; timeoutS: number });
        return { jobId: `job-${bodies.length}` };
      }
      if (method === "GET" && path.startsWith("/comfy/jobs/")) return { status: "complete" };
      throw new Error(`unexpected ${method} ${path}`);
    });
    return bodies;
  }

  it("recipeId=my-h3-multiseg 分派分段组装器:POST 图 100=H3Parameter(无 14 节点),超时随 durationTarget 缩放", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" }, durationTarget: 6 }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" }, durationTarget: 20 }),
    ]);
    programLanding(["a", "b"]);
    const bodies = captureExecuteBodies();
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ recipeId: "my-h3-multiseg" }); });
    await pumpUntilDone(result);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.graph["100"].class_type).toBe("H3Parameter"); // 分段组装器路径
      expect(body.graph["14"]).toBeUndefined(); // 不走 i2v 单段模板
      expect(body.graph["103"].class_type).toBe("MyShot");
    }
    // 超时=600+ceil(report.seconds)×300:6s→141 帧(5.875s)→2400;20s→481 帧(20.042s)→6900
    expect(bodies[0]!.timeoutS).toBe(2400);
    expect(bodies[1]!.timeoutS).toBe(6900);
    // 发车摘要含 multiseg 预计时长(Σ镜秒×300s:(6+20)×300/60=130 分钟)
    const infoArg = toast.info.mock.calls[0]?.[0] ?? "";
    expect(infoArg).toContain("预计 130 分钟");
  });

  it("超 40s 镜硬顶拒派:不进执行+发车摘要列明(M1);i2v 口径截断清单不变", () => {
    const items = [
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" }, durationTarget: 5 }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" }, durationTarget: 45 }),
    ];
    // 纯函数:multiseg=顶拒清单;i2v(缺省)=15s 截断清单
    const multisegPlan = planStoryboardH3VideoBatch(items, "my-h3-multiseg");
    expect(multisegPlan.rejectedShotIndexes).toEqual([2]);
    expect(multisegPlan.truncatedShotIndexes).toEqual([]);
    const i2vPlan = planStoryboardH3VideoBatch(items);
    expect(i2vPlan.rejectedShotIndexes).toEqual([]);
    expect(i2vPlan.truncatedShotIndexes).toEqual([2]);
  });

  it("超 40s 镜不进执行:multiseg 批量只派 5s 镜,摘要含「超 40s 顶拒派」", async () => {
    seedShots([
      shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" }, durationTarget: 5 }),
      shot({ id: "b", index: 2, mediaRef: { kind: "image", path: "p2" }, durationTarget: 45 }),
    ]);
    programLanding(["a"]);
    const bodies = captureExecuteBodies();
    const { result } = renderHook(() => useStoryboardH3VideoBatch({
      storyboards: useStudioStore.getState().storyboards,
    }));
    act(() => { result.current.start({ recipeId: "my-h3-multiseg" }); });
    const infoArg = toast.info.mock.calls[0]?.[0] ?? "";
    expect(infoArg).toContain("1 镜可出片");
    expect(infoArg).toContain("超 40s 顶拒派:S02");
    await pumpUntilDone(result);
    expect(bodies).toHaveLength(1); // 45s 镜零派发
    expect(result.current.state.done).toBe(1);
  });

  it("单镜 force recipeId 缺省链:无会话=i2v-31;会话在档=上次配方(会话→i2v-31)", async () => {
    seedShots([shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" } })]);
    // 无会话 → i2v-31(POST 图含 14 节点单段模板)
    let bodies = captureExecuteBodies();
    programLanding(["a"]);
    await runStoryboardH3ShotVideo(useStudioStore.getState().storyboards[0]!, { tier: "480p" });
    expect(bodies[0]!.graph["14"].class_type).toBe("PrimitiveStringMultiline");
    expect(bodies[0]!.graph["100"].class_type).toBe("MyShot"); // i2v 模板的 100=MyShot(multiseg 的 100=H3Parameter)
    // 会话在档 my-h3-multiseg → force 复用上次配方(§14.1.4 D6 延伸)
    useStoryboardH3VideoSessionStore.setState({
      session: {
        sessionId: "s1", projectId: "proj-1", episodeId: "chapter-001",
        cursorShotIndex: 2, totalShots: 1, doneShotIds: [], failedShotIds: [],
        recipeId: "my-h3-multiseg", tier: "960p", status: "interrupted", updatedAt: 1,
      },
    });
    bodies = captureExecuteBodies();
    await runStoryboardH3ShotVideo(useStudioStore.getState().storyboards[0]!, { tier: "960p" });
    expect(bodies[0]!.graph["100"].class_type).toBe("H3Parameter"); // 缺省链吃到会话配方
    expect(bodies[0]!.graph["14"]).toBeUndefined();
  });

  it("分派经 buildShotH3ApiWorkflowForRecipe:mock 断言参数对(recipeId+首帧 b64+档位)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/assist/image-studio/h3-shot-video-workflow", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/assist/image-studio/h3-shot-video-workflow")>();
      return { ...actual, buildShotH3ApiWorkflowForRecipe: vi.fn(actual.buildShotH3ApiWorkflowForRecipe) };
    });
    try {
      // resetModules 后 store 亦为新实例:seed/断言全部走 fresh 绑定(top-level 绑定属旧实例)
      const { useStoryboardH3VideoBatch: useBatch } = await import("./use-storyboard-h3-video-batch");
      const { useStudioStore: freshStudio } = await import("@/stores/studio/studio-store");
      const { useProjectStore: freshProject } = await import("@/stores/project/project-store");
      const workflowModule = await import("@/lib/assist/image-studio/h3-shot-video-workflow");
      const forRecipe = workflowModule.buildShotH3ApiWorkflowForRecipe as unknown as ReturnType<typeof vi.fn>;
      const shotA = shot({ id: "a", index: 1, mediaRef: { kind: "image", path: "p1" }, durationTarget: 6 });
      freshStudio.setState({
        storyboards: [shotA],
        novelChapters: [{ id: "chapter-001", title: "第一章" }],
      } as never, false);
      freshProject.setState({ activeProjectId: "proj-1" } as never, false);
      let landedCalls = 0;
      consumeMock.mockImplementation(async () => {
        landedCalls += 1;
        const candidate = {
          id: `h3-a-v${landedCalls}`,
          trackId: "",
          provider: "h3-comfyui",
          filePath: "project-file://h3/x.mp4",
          meta: { policy: "ambient", bridgeItemId: landedCalls, originProjectId: "proj-1", storyboardId: "a" },
          state: "ready",
          createdAt: 1,
        };
        freshStudio.setState((prev: { videoCandidates: unknown[] }) => ({
          videoCandidates: [...prev.videoCandidates, candidate],
        }) as never, false);
        return { processed: 1, landed: 1 };
      });
      comfyJsonMock.mockImplementation(async (method: string, path: string) => {
        if (method === "POST" && path === "/comfy/execute") return { jobId: "job-1" };
        if (method === "GET" && path.startsWith("/comfy/jobs/")) return { status: "complete" };
        throw new Error(`unexpected ${method} ${path}`);
      });
      const { result } = renderHook(() => useBatch({ storyboards: freshStudio.getState().storyboards }));
      act(() => { result.current.start({ recipeId: "my-h3-multiseg" }); });
      await pumpUntilDone(result);
      expect(forRecipe).toHaveBeenCalledTimes(1);
      expect(forRecipe).toHaveBeenCalledWith("my-h3-multiseg", expect.objectContaining({
        firstFrameB64: "ZmFrZQ==",
        resolutionTier: "960p",
        originProjectId: "proj-1",
        policy: "ambient",
        shot: expect.objectContaining({ id: "a", durationTarget: 6 }),
      }));
      expect(result.current.state.done).toBe(1);
    } finally {
      vi.doUnmock("@/lib/assist/image-studio/h3-shot-video-workflow");
    }
  });
});
