// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 生效引擎 base 真源 mock(1102 S3 队列通道跟随):默认 sidecar 未跑=本机回落
// (与 jsdom 真实门禁行为等价),远端用例按需覆写。
const getRemoteEngineMock = vi.hoisted(() => vi.fn(async (): Promise<{
  url: string | null;
  effective: string;
  source: "settings" | "env" | "managed" | "fallback";
}> => {
  throw new Error("本地生图服务未运行");
}));
vi.mock("@/lib/assist/image-studio/comfy-sidecar-bridge", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getRemoteEngine: getRemoteEngineMock };
});

import {
  STORYBOARD_BATCH_DEGRADED_RESOLUTION,
  STORYBOARD_BATCH_SHOT_INTERVAL_MS,
  createStoryboardBatchInterruptibleDelay,
  resolveStoryboardBatchQueueChannel,
  runStoryboardBatchLadder,
  type StoryboardBatchLadderStage,
} from "./storyboard-batch-protocols";
import type { ComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

describe("批量四协议常量", () => {
  it("间隔默认值保守(≥1s)且降载档为最低分辨率 1K", () => {
    expect(STORYBOARD_BATCH_SHOT_INTERVAL_MS).toBeGreaterThanOrEqual(1_000);
    expect(STORYBOARD_BATCH_DEGRADED_RESOLUTION).toBe("1K");
  });
});

describe("createStoryboardBatchInterruptibleDelay(间隔节流)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("到点后 resolve true", async () => {
    const delay = createStoryboardBatchInterruptibleDelay();
    let resolved: boolean | undefined;
    delay.wait(1_000).then((value) => { resolved = value; });
    expect(delay.isPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).toBe(true);
    expect(delay.isPending()).toBe(false);
  });

  it("cancel 立即 resolve false 且零残留 timer(必测:停止不残留定时器)", async () => {
    const delay = createStoryboardBatchInterruptibleDelay();
    let resolved: boolean | undefined;
    delay.wait(60_000).then((value) => { resolved = value; });
    expect(vi.getTimerCount()).toBe(1);

    delay.cancel();
    await Promise.resolve(); // cancel 的 resolve 走微任务,泵一拍再断言

    expect(resolved).toBe(false);
    expect(delay.isPending()).toBe(false);
    // 定时器已被清理:计时器池空,残留等待时间再长也不会再有回调
    expect(vi.getTimerCount()).toBe(0);
    // 已取消的 delay 再等任意时长也不再产生副作用
    await vi.advanceTimersByTimeAsync(120_000);
    expect(resolved).toBe(false);
  });

  it("shouldAbort 已置位时 wait 直接 false(不排定时器)", async () => {
    let aborted = true;
    const delay = createStoryboardBatchInterruptibleDelay(() => aborted);
    expect(await delay.wait(1_000)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    aborted = false;
    let resolved: boolean | undefined;
    delay.wait(50).then((value) => { resolved = value; });
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(true);
  });
});

describe("runStoryboardBatchLadder(失败回退阶梯)", () => {
  it("三段各走一次:initial→retry→degraded(必测),成功即停", async () => {
    const stages: StoryboardBatchLadderStage[] = [];
    const outcome = await runStoryboardBatchLadder({
      attempt: async (stage) => {
        stages.push(stage);
        if (stage !== "degraded") throw new Error("fail");
      },
    });
    expect(stages).toEqual(["initial", "retry", "degraded"]);
    expect(outcome).toMatchObject({ ok: true, stagesRun: ["initial", "retry", "degraded"] });
  });

  it("初次成功只走一段;第二次原样重试成功共两段", async () => {
    const first = await runStoryboardBatchLadder({ attempt: async () => undefined });
    expect(first).toMatchObject({ ok: true, stagesRun: ["initial"] });

    let calls = 0;
    const second = await runStoryboardBatchLadder({
      attempt: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
      },
    });
    expect(second).toMatchObject({ ok: true, stagesRun: ["initial", "retry"] });
  });

  it("三败放弃:exhausted 语义 + 保留最后一次错误", async () => {
    const outcome = await runStoryboardBatchLadder({
      attempt: async () => { throw new Error("provider down"); },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.aborted).toBeUndefined();
    expect(outcome.stagesRun).toEqual(["initial", "retry", "degraded"]);
    expect(outcome.error).toEqual(new Error("provider down"));
  });

  it("段间检查 shouldAbort:停止后不再烧重试,标 aborted", async () => {
    const stages: StoryboardBatchLadderStage[] = [];
    let stopRequested = false;
    const outcome = await runStoryboardBatchLadder({
      shouldAbort: () => stopRequested,
      attempt: async (stage) => {
        stages.push(stage);
        if (stage === "initial") {
          stopRequested = true; // 初段失败后用户按下停止
          throw new Error("fail");
        }
      },
    });
    expect(stages).toEqual(["initial"]);
    expect(outcome).toMatchObject({ ok: false, aborted: true, stagesRun: ["initial"] });
  });

  it("停止发生在首段之前:零尝试纯退出", async () => {
    const attempt = vi.fn(async () => undefined);
    const outcome = await runStoryboardBatchLadder({
      shouldAbort: () => true,
      attempt,
    });
    expect(attempt).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, aborted: true, stagesRun: [] });
  });
});

describe("resolveStoryboardBatchQueueChannel(队列通道构造 1102 S3:跟随生效引擎 base)", () => {
  const fetchCalls: string[] = [];
  beforeEach(() => {
    getRemoteEngineMock.mockImplementation(async () => {
      throw new Error("本地生图服务未运行");
    });
    fetchCalls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = undefined;
    vi.clearAllMocks();
  });

  function stubLocalEnginePort(port: number | null) {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = {
      getEngineStatus: async () => ({ port }),
    } as unknown as ComfyEngineClient;
  }

  it("远端生效(source=settings)→ 通道 baseUrl=远端 url(直连 Windows 引擎 /queue)", async () => {
    getRemoteEngineMock.mockResolvedValue({
      url: "http://192.168.0.101:17000",
      effective: "http://192.168.0.101:17000",
      source: "settings",
    });
    stubLocalEnginePort(17001);
    const channel = await resolveStoryboardBatchQueueChannel();
    expect(channel).toBeTruthy();
    await channel!.getQueue();
    expect(fetchCalls).toEqual(["http://192.168.0.101:17000/queue"]);
  });

  it("无远端配置 → 127.0.0.1:port(现行为回归)", async () => {
    getRemoteEngineMock.mockResolvedValue({ url: null, effective: "http://127.0.0.1:17001", source: "managed" });
    stubLocalEnginePort(17001);
    const channel = await resolveStoryboardBatchQueueChannel();
    expect(channel).toBeTruthy();
    await channel!.getQueue();
    expect(fetchCalls).toEqual(["http://127.0.0.1:17001/queue"]);
  });

  it("sidecar 未跑(getRemoteEngine 抛错)→ 本机回落", async () => {
    stubLocalEnginePort(17002);
    const channel = await resolveStoryboardBatchQueueChannel();
    await channel!.getQueue();
    expect(fetchCalls).toEqual(["http://127.0.0.1:17002/queue"]);
  });

  it("port 无效且无远端 → undefined(静默降级不阻断批量)", async () => {
    stubLocalEnginePort(null);
    await expect(resolveStoryboardBatchQueueChannel()).resolves.toBeUndefined();
  });

  it("引擎状态查询失败 → undefined", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = {
      getEngineStatus: async () => {
        throw new Error("本地生图服务未运行");
      },
    } as unknown as ComfyEngineClient;
    await expect(resolveStoryboardBatchQueueChannel()).resolves.toBeUndefined();
  });
});
