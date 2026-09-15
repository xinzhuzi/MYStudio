// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORYBOARD_BATCH_DEGRADED_RESOLUTION,
  STORYBOARD_BATCH_SHOT_INTERVAL_MS,
  createStoryboardBatchInterruptibleDelay,
  runStoryboardBatchLadder,
  type StoryboardBatchLadderStage,
} from "./storyboard-batch-protocols";

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
