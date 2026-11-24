// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createHttpStoryboardBatchEngineQueueChannel,
  createStoryboardBatchPromptIdTracker,
  diffNewPendingPromptIds,
  parseStoryboardBatchEngineQueueReply,
  stopStoryboardBatchQueuedJobs,
  type StoryboardBatchEngineQueueChannel,
  type StoryboardBatchEngineQueueSnapshot,
} from "./storyboard-batch-engine-queue";

function snapshot(pending: string[], running: string[] = []): StoryboardBatchEngineQueueSnapshot {
  return { pendingPromptIds: pending, runningPromptIds: running };
}

function queueChannelMock(overrides?: {
  getQueue?: () => Promise<StoryboardBatchEngineQueueSnapshot>;
  deleteQueueItems?: (ids: string[]) => Promise<void>;
}) {
  const deleteCalls: string[][] = [];
  const channel: StoryboardBatchEngineQueueChannel & { deleteCalls: string[][] } = {
    deleteCalls,
    async getQueue() {
      return overrides?.getQueue ? overrides.getQueue() : snapshot([]);
    },
    async deleteQueueItems(ids) {
      deleteCalls.push([...ids]);
      return overrides?.deleteQueueItems?.(ids);
    },
  };
  return channel;
}

describe("parseStoryboardBatchEngineQueueReply(引擎 /queue 归一)", () => {
  it("解析 queue_running/queue_pending 的 prompt_id(去重保序)", () => {
    const parsed = parseStoryboardBatchEngineQueueReply({
      queue_running: [[0, "run-1", { a: 1 }, {}, []]],
      queue_pending: [[1, "p-1"], [2, "p-2"], [3, "p-1"]],
    });
    expect(parsed).toEqual({
      runningPromptIds: ["run-1"],
      pendingPromptIds: ["p-1", "p-2"],
    });
  });

  it("畸形输入一律落空快照不抛错(null/数组/缺字段/坏条目)", () => {
    for (const raw of [null, undefined, [], "x", {}, { queue_running: "no" }, { queue_pending: [[1, 42]] }]) {
      expect(() => parseStoryboardBatchEngineQueueReply(raw)).not.toThrow();
      expect(parseStoryboardBatchEngineQueueReply(raw)).toEqual({
        runningPromptIds: [],
        pendingPromptIds: [],
      });
    }
  });
});

describe("diffNewPendingPromptIds(差分归因)", () => {
  it("提交后新增的 pending 归本会话;原有与他人项不算新增", () => {
    const before = snapshot(["foreign-1", "mine-old"], ["running-1"]);
    const after = snapshot(["foreign-1", "mine-old", "mine-new"], ["running-1"]);
    expect(diffNewPendingPromptIds(before, after)).toEqual(["mine-new"]);
  });

  it("提交前快照缺省(观测失败)时退化为 after 全量 pending", () => {
    expect(diffNewPendingPromptIds(null, snapshot(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("createStoryboardBatchPromptIdTracker(会话集合)", () => {
  it("记录去重、只增、可查可清", () => {
    const tracker = createStoryboardBatchPromptIdTracker();
    tracker.record(["a", "b", "a", ""]);
    tracker.record(["c"]);
    expect(tracker.recordedIds()).toEqual(["a", "b", "c"]);
    expect(tracker.has("b")).toBe(true);
    expect(tracker.has("x")).toBe(false);
    tracker.clear();
    expect(tracker.recordedIds()).toEqual([]);
  });
});

describe("stopStoryboardBatchQueuedJobs(精确停队)", () => {
  it("只删本会话记录过的 pending 项——他人任务零触碰(必测)", async () => {
    const tracker = createStoryboardBatchPromptIdTracker();
    tracker.record(["mine-1", "mine-2", "mine-running"]);
    // 队列里混着他人任务(foreign-pending/foreign-running)与本会话执行中项
    const channel = queueChannelMock({
      getQueue: () => Promise.resolve(snapshot(["foreign-pending", "mine-1", "mine-2"], ["foreign-running", "mine-running"])),
    });

    const outcome = await stopStoryboardBatchQueuedJobs(tracker, channel);

    expect(outcome.deletedPromptIds).toEqual(["mine-1", "mine-2"]);
    expect(outcome.runningPromptIds).toEqual(["mine-running"]);
    expect(channel.deleteCalls).toHaveLength(1);
    // 硬保证:DELETE 载荷里没有任何他人编号
    expect(channel.deleteCalls[0]).not.toContain("foreign-pending");
    expect(channel.deleteCalls[0]).not.toContain("foreign-running");
    expect(channel.deleteCalls[0]).not.toContain("mine-running");
    expect(new Set(channel.deleteCalls[0]).size).toBe(channel.deleteCalls[0]!.length);
  });

  it("会话无记录或队列无本会话 pending 时不发 DELETE", async () => {
    const emptyTracker = createStoryboardBatchPromptIdTracker();
    const channelA = queueChannelMock({ getQueue: () => Promise.resolve(snapshot(["foreign-1"])) });
    expect((await stopStoryboardBatchQueuedJobs(emptyTracker, channelA)).deletedPromptIds).toEqual([]);
    expect(channelA.deleteCalls).toHaveLength(0);

    const mineTracker = createStoryboardBatchPromptIdTracker();
    mineTracker.record(["mine-done"]);
    const channelB = queueChannelMock({ getQueue: () => Promise.resolve(snapshot(["foreign-1"])) });
    const outcomeB = await stopStoryboardBatchQueuedJobs(mineTracker, channelB);
    expect(outcomeB.deletedPromptIds).toEqual([]);
    expect(channelB.deleteCalls).toHaveLength(0);
  });

  it("通道缺席=fail-soft 空结果;队列查询/删除失败不抛错只留 error", async () => {
    const tracker = createStoryboardBatchPromptIdTracker();
    tracker.record(["mine-1"]);
    expect(await stopStoryboardBatchQueuedJobs(tracker, undefined)).toEqual({
      deletedPromptIds: [],
      runningPromptIds: [],
    });

    const failChannel = queueChannelMock({
      getQueue: () => Promise.reject(new Error("engine down")),
    });
    const outcome = await stopStoryboardBatchQueuedJobs(tracker, failChannel);
    expect(outcome.deletedPromptIds).toEqual([]);
    expect(outcome.error).toContain("engine down");

    const deleteFailChannel = queueChannelMock({
      getQueue: () => Promise.resolve(snapshot(["mine-1"])),
      deleteQueueItems: () => Promise.reject(new Error("403")),
    });
    const outcome2 = await stopStoryboardBatchQueuedJobs(tracker, deleteFailChannel);
    expect(outcome2.error).toContain("403");
  });
});

describe("createHttpStoryboardBatchEngineQueueChannel(HTTP 通道)", () => {
  it("GET /queue 归一快照;DELETE /queue 发 {delete:[ids]} 载荷", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith("/queue") && init?.method === "DELETE") {
        expect(JSON.parse(String(init.body))).toEqual({ delete: ["a", "b"] });
        return new Response("{}", { status: 200 });
      }
      return new Response(
        JSON.stringify({ queue_running: [], queue_pending: [[1, "a"], [2, "b"]] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const channel = createHttpStoryboardBatchEngineQueueChannel("http://127.0.0.1:18999/");
      expect(await channel.getQueue()).toEqual(snapshot(["a", "b"]));
      await channel.deleteQueueItems(["a", "b"]);
      await channel.deleteQueueItems([]);
      // 空载荷不发请求
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("非 2xx 抛大白话错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    try {
      const channel = createHttpStoryboardBatchEngineQueueChannel("http://127.0.0.1:18999");
      await expect(channel.getQueue()).rejects.toThrow("HTTP 500");
      await expect(channel.deleteQueueItems(["a"])).rejects.toThrow("HTTP 500");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
