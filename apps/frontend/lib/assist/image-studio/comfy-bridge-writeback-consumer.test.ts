// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeComfyBridgeWritebacks,
  parseShotTarget,
  resetComfyBridgeCursorForTests,
  type ComfyBridgeWritebackConsumerClient,
  type ConsumeComfyBridgeWritebacksDeps,
} from "@/lib/assist/image-studio/comfy-bridge-writeback-consumer";
import type { StoryboardItem } from "@/types/studio";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function storyboard(id: string, index: number, episodeId = "ep-1"): StoryboardItem {
  return {
    id,
    episodeId,
    index,
    duration: 2,
    videoDesc: "",
    trackKey: "track-1",
    trackId: "track-1",
    prompt: "test",
    // 其余字段消费器不读,测试桩省略由 as 收口
  } as StoryboardItem;
}

const STORYBOARDS = [storyboard("sb-a", 1), storyboard("sb-b", 2), storyboard("sb-c", 2, "ep-2")];

describe("parseShotTarget", () => {
  it("精确 id 命中(大小写不敏感)", () => {
    expect(parseShotTarget("SB-A", STORYBOARDS)).toBe("sb-a");
  });

  it("S{index} 在全局唯一时命中", () => {
    expect(parseShotTarget("S01", STORYBOARDS)).toBe("sb-a");
    expect(parseShotTarget("1", STORYBOARDS)).toBe("sb-a");
  });

  it("index 跨章歧义或未知目标=不解析", () => {
    expect(parseShotTarget("S02", STORYBOARDS)).toBeNull(); // ep-1/ep-2 各有 index 2
    expect(parseShotTarget("S99", STORYBOARDS)).toBeNull();
    expect(parseShotTarget("", STORYBOARDS)).toBeNull();
    expect(parseShotTarget(undefined, STORYBOARDS)).toBeNull();
  });
});

function makeClient(items: Array<{ id: number; imageB64?: string; videoB64?: string; shotTarget?: string; meta?: Record<string, unknown>; ts?: number }>) {
  const ownedItems = items.map((item) => ({ ...item, meta: { originProjectId: "project-1", ...item.meta } }));
  const calls: { cursor: number; acks: number[]; exactAcks: number[][] } = { cursor: -1, acks: [], exactAcks: [] };
  const acknowledged = new Set<number>();
  const client: ComfyBridgeWritebackConsumerClient = {
    async getBridgeWritebacks(cursor) {
      calls.cursor = cursor;
      const visible = ownedItems.filter((item) => item.id > cursor && !acknowledged.has(item.id));
      return { cursor: items.length ? Math.max(...items.map((item) => item.id)) : cursor, items: visible };
    },
    async ackBridgeWritebacks(upTo, ids) {
      calls.acks.push(upTo);
      calls.exactAcks.push(ids ?? []);
      for (const id of ids ?? []) acknowledged.add(id);
      return upTo;
    },
  };
  return { client, calls };
}

function makeDeps(overrides: Partial<ConsumeComfyBridgeWritebacksDeps> = {}): {
  deps: ConsumeComfyBridgeWritebacksDeps;
  applied: Array<{ storyboardId: string; url: string; itemId: number }>;
  appliedVideos: Array<{ storyboardId: string; url: string; itemId: number; policy: string }>;
  persisted: Array<{ b64: string; title: string; source: string; prompt: string }>;
  notified: Array<{ kind: string; detail: string }>;
} {
  const applied: Array<{ storyboardId: string; url: string; itemId: number }> = [];
  const appliedVideos: Array<{ storyboardId: string; url: string; itemId: number; policy: string; h3DurationUs?: number }> = [];
  const persisted: Array<{ b64: string; title: string; source: string; prompt: string }> = [];
  const notified: Array<{ kind: string; detail: string }> = [];
  const deps: ConsumeComfyBridgeWritebacksDeps = {
    client: { getBridgeWritebacks: async () => null, ackBridgeWritebacks: async () => 0 },
    storyboards: () => STORYBOARDS,
    applyToStoryboard: (storyboardId, url, item) => applied.push({ storyboardId, url, itemId: item.id }),
    applyVideoToStoryboard: (storyboardId, url, item, policy, h3DurationUs) => appliedVideos.push({ storyboardId, url, itemId: item.id, policy, h3DurationUs }),
    probeVideoDuration: async () => null,
    projectId: () => "project-1",
    writeProjectBinary: async () => ({ success: true, url: "project-file://project-1/remotion/video.mp4" }),
    persist: async (b64, title, options) => {
      persisted.push({ b64, title, ...options });
      return { url: `project-file://project-1/media/ai-image/x-${persisted.length}.png` };
    },
    notify: (kind, detail) => notified.push({ kind, detail }),
    ...overrides,
  };
  return { deps, applied, appliedVideos, persisted, notified };
}

beforeEach(() => {
  resetComfyBridgeCursorForTests();
  vi.clearAllMocks();
  useStudioStore.setState({ mediaTasks: [], videoCandidates: [] });
});

describe("consumeComfyBridgeWritebacks", () => {
  it("旧条目和其他项目不会阻塞当前项目,只精确确认已落账 ID", async () => {
    let active = "project-1";
    const { client, calls } = makeClient([
      { id: 1, imageB64: "aGk=", meta: { originProjectId: undefined } },
      { id: 2, imageB64: "aGk=", meta: { originProjectId: "project-2" } },
      { id: 3, imageB64: "aGk=", meta: { originProjectId: "project-1" } },
    ]);
    const persist = vi.fn(async () => ({ url: `project-file://${active}/media/image.png` }));
    const { deps, notified } = makeDeps({ client, projectId: () => active, persist });
    await consumeComfyBridgeWritebacks(deps);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(calls.exactAcks).toEqual([[3]]);
    const errors = notified.filter((entry) => entry.kind === "error").length;
    await consumeComfyBridgeWritebacks(deps);
    expect(notified.filter((entry) => entry.kind === "error")).toHaveLength(errors);
    active = "project-2";
    await consumeComfyBridgeWritebacks(deps);
    expect(calls.cursor).toBe(0);
    expect(calls.exactAcks).toEqual([[3], [2]]);
    expect(persist).toHaveBeenCalledTimes(2);
    expect((await client.getBridgeWritebacks(0))?.items.map((item) => item.id)).toEqual([1]);
  });

  it("分镜目标:落盘→回写分镜→ack,台账口径=source comfy-bridge", async () => {
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
    const { deps, applied, persisted, notified } = makeDeps({ client });

    const result = await consumeComfyBridgeWritebacks(deps);

    expect(result).toEqual({ processed: 1, landed: 1 });
    expect(persisted[0]).toMatchObject({ b64: "aGk=", source: "comfy-bridge", prompt: "" });
    expect(applied[0]).toMatchObject({ storyboardId: "sb-a", itemId: 1 });
    expect(notified[0]?.kind).toBe("storyboard");
    expect(calls.acks).toEqual([1]);
  });

  it("无目标:只落项目媒体,不碰分镜", async () => {
    const { client } = makeClient([{ id: 2, imageB64: "aGk=" }]);
    const { deps, applied, notified } = makeDeps({ client });

    const result = await consumeComfyBridgeWritebacks(deps);

    expect(result.landed).toBe(0);
    expect(applied).toHaveLength(0);
    expect(notified[0]?.kind).toBe("media");
  });

  it("精确确认后从零拉取:同批二次消费不再处理", async () => {
    const { client, calls } = makeClient([{ id: 5, imageB64: "aGk=", shotTarget: "S01" }]);
    const { deps, applied } = makeDeps({ client });

    await consumeComfyBridgeWritebacks(deps);
    await consumeComfyBridgeWritebacks(deps);

    expect(applied).toHaveLength(1);
    expect(calls.cursor).toBe(0); // 保留较早的其他项目项仍可被后续项目消费。
  });

  it("落盘失败:报错即停,不 ack(下轮重试)", async () => {
    const { client, calls } = makeClient([
      { id: 3, imageB64: "aGk=" },
      { id: 4, imageB64: "aGk=" },
    ]);
    const { deps, notified } = makeDeps({
      client,
      persist: async () => {
        throw new Error("磁盘满");
      },
    });

    const result = await consumeComfyBridgeWritebacks(deps);

    expect(result.processed).toBe(2);
    expect(result.landed).toBe(0);
    expect(notified[0]).toMatchObject({ kind: "error", detail: "磁盘满" });
    expect(calls.acks).toHaveLength(0);
  });

  it("持久化返回空地址:保留当前项和后续项,下轮从原游标重试", async () => {
    const { client, calls } = makeClient([
      { id: 3, imageB64: "aGk=" },
      { id: 4, imageB64: "aGk=" },
    ]);
    const persist = vi.fn().mockResolvedValue({ url: null });
    const { deps } = makeDeps({ client, persist });

    await consumeComfyBridgeWritebacks(deps);
    expect(calls.acks).toEqual([]);
    expect(persist).toHaveBeenCalledTimes(1);
    persist.mockResolvedValue({ url: "project-file://project-1/media/ai-image/retry.png" });
    await consumeComfyBridgeWritebacks(deps);
    expect(calls.cursor).toBe(0);
    expect(calls.acks).toEqual([4]);
  });

  it("重叠消费只持久化和回写一次", async () => {
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
    const entered = deferred<void>();
    const saved = deferred<{ url: string }>();
    const persist = vi.fn(() => { entered.resolve(); return saved.promise; });
    const { deps, applied } = makeDeps({ client, persist });
    const first = consumeComfyBridgeWritebacks(deps);
    await entered.promise;
    const second = consumeComfyBridgeWritebacks(deps);
    saved.resolve({ url: "project-file://project-1/media/ai-image/one.png" });
    await Promise.all([first, second]);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(applied).toHaveLength(1);
    expect(calls.acks).toEqual([1]);
  });

  it.each(["null", "reject"])("ack %s 失败:下一轮重试确认,不重复持久化", async (failure) => {
    const { client } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
    const confirm = client.ackBridgeWritebacks;
    const ack = vi.fn<Parameters<typeof client.ackBridgeWritebacks>, ReturnType<typeof client.ackBridgeWritebacks>>()
      .mockImplementationOnce(async (...args) => {
        await confirm(...args); // 服务端已删除,首次应答丢失。
        return failure === "null" ? Promise.resolve(null) : Promise.reject(new Error("offline"));
      })
      .mockResolvedValue(0); // 已删除但回包丢失时,重试 0 也是成功。
    client.ackBridgeWritebacks = ack;
    const { deps, persisted, applied } = makeDeps({ client });
    await consumeComfyBridgeWritebacks(deps);
    await consumeComfyBridgeWritebacks(deps);
    expect(ack.mock.calls).toEqual([[1, [1]], [1, [1]]]);
    expect(persisted).toHaveLength(1);
    expect(applied).toHaveLength(1);
  });

  it("ack 等待期间仍持有消费锁", async () => {
    const { client } = makeClient([{ id: 1, imageB64: "aGk=" }]);
    const entered = deferred<void>();
    const ack = deferred<number>();
    client.ackBridgeWritebacks = () => { entered.resolve(); return ack.promise; };
    const get = vi.spyOn(client, "getBridgeWritebacks");
    const { deps } = makeDeps({ client });
    let completed = false;
    const first = consumeComfyBridgeWritebacks(deps).then(() => { completed = true; });
    await entered.promise;
    const second = consumeComfyBridgeWritebacks(deps);
    const completedBeforeAck = completed;
    ack.resolve(1);
    await Promise.all([first, second]);
    expect(completedBeforeAck).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("精确 ack 请求失败时重试相同 ID,保留较早的其他项目项且不重复落账", async () => {
    const { client, calls } = makeClient([
      { id: 1, imageB64: "aGk=", meta: { originProjectId: "project-2" } },
      { id: 2, imageB64: "aGk=", shotTarget: "S01" },
    ]);
    const confirm = client.ackBridgeWritebacks;
    client.ackBridgeWritebacks = vi.fn()
      .mockResolvedValueOnce(null)
      .mockImplementation(confirm);
    const { deps, persisted, applied } = makeDeps({ client });
    await consumeComfyBridgeWritebacks(deps);
    await consumeComfyBridgeWritebacks(deps);
    expect(client.ackBridgeWritebacks).toHaveBeenNthCalledWith(1, 2, [2]);
    expect(client.ackBridgeWritebacks).toHaveBeenNthCalledWith(2, 2, [2]);
    expect(calls.exactAcks).toEqual([[2]]);
    expect(persisted).toHaveLength(1);
    expect(applied).toHaveLength(1);
    expect((await client.getBridgeWritebacks(0))?.items.map((item) => item.id)).toEqual([1]);
  });

  it("拉取期间切换项目:当前批绑定原项目,新项目轮询不可接收", async () => {
    let active = "project-1";
    const items = [{ id: 1, imageB64: "aGk=", shotTarget: "S01" }];
    const { client, calls } = makeClient(items);
    const get = client.getBridgeWritebacks;
    client.getBridgeWritebacks = async (cursor) => {
      const reply = await get(cursor);
      active = "project-2";
      return reply;
    };
    const { deps, persisted, applied } = makeDeps({ client, projectId: () => active });
    await consumeComfyBridgeWritebacks(deps);
    client.getBridgeWritebacks = get;
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(0);
    expect(applied).toHaveLength(0);
    expect(calls.acks).toEqual([]);
    active = "project-1";
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(1);
    expect(calls.acks).toEqual([1]);
  });

  it("图片写盘期间切换项目:不写新项目同 id 分镜且不 ack", async () => {
    let active = "project-1";
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
    const { deps, applied } = makeDeps({
      client,
      projectId: () => active,
      persist: async () => {
        active = "project-2";
        return { url: "project-file://project-1/media/ai-image/one.png" };
      },
    });
    await consumeComfyBridgeWritebacks(deps);
    expect(applied).toHaveLength(0);
    expect(calls.acks).toEqual([]);
  });

  it("拉取期间 A→B→A:旧世代不回写,下一轮原项目可重试", async () => {
    useProjectStore.setState({ activeProjectId: "project-1" });
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=" }]);
    const get = client.getBridgeWritebacks;
    client.getBridgeWritebacks = async (cursor) => {
      const reply = await get(cursor);
      useProjectStore.setState({ activeProjectId: "project-2" });
      useProjectStore.setState({ activeProjectId: "project-1" });
      return reply;
    };
    const { deps, persisted } = makeDeps({ client, projectId: undefined });
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(0);
    expect(calls.acks).toEqual([]);
    client.getBridgeWritebacks = get;
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(1);
  });

  it.each(["write", "probe"])("视频 %s 等待期间切换项目:不回写新项目且不 ack", async (stage) => {
    let active = "project-1";
    const { client, calls } = makeClient([{
      id: 1, videoB64: "aGk=", shotTarget: "S01",
      meta: { subfolder: "video/漫影/ep-1/sb-a", policy: "ambient" },
    }]);
    const { deps, appliedVideos } = makeDeps({
      client,
      projectId: () => active,
      writeProjectBinary: async () => {
        if (stage === "write") active = "project-2";
        return { success: true, url: "project-file://project-1/remotion/video.mp4" };
      },
      probeVideoDuration: async () => {
        if (stage === "probe") active = "project-2";
        return 1_000_000;
      },
    });
    await consumeComfyBridgeWritebacks(deps);
    expect(appliedVideos).toHaveLength(0);
    expect(calls.acks).toEqual([]);
  });

  it.each(["old-project-shot", "S02"])("明确目标无法解析:不降级到当前项目媒体库 (%s)", async (shotTarget) => {
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget }]);
    const { deps, persisted, applied } = makeDeps({ client });
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(0);
    expect(applied).toHaveLength(0);
    expect(calls.acks).toEqual([]);
  });

  it.each(["data:image/png;base64,aGk=", "blob:preview", "project-file://project-2/media/image.png"])(
    "图片地址不是本项目持久文件:不回写不 ack (%s)", async (url) => {
      const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
      const { deps, applied } = makeDeps({ client, persist: async () => ({ url }) });
      await consumeComfyBridgeWritebacks(deps);
      expect(applied).toHaveLength(0);
      expect(calls.acks).toEqual([]);
    },
  );

  it("没有图片/视频载荷:保留收件项而不是静默确认", async () => {
    const { client, calls } = makeClient([{ id: 1 }]);
    const { deps } = makeDeps({ client });
    await consumeComfyBridgeWritebacks(deps);
    expect(calls.acks).toEqual([]);
  });

  it.each([undefined, "", " ", 17, "project-2"])(
    "首次消费缺少或不匹配来源项目:不持久化且不 ack (%s)", async (originProjectId) => {
      const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", meta: { originProjectId } }]);
      const { deps, persisted, notified } = makeDeps({ client });
      await consumeComfyBridgeWritebacks(deps);
      expect(persisted).toHaveLength(0);
      expect(calls.acks).toEqual([]);
      expect(notified[0]?.kind).toBe("error");
    },
  );

  it("renderer 重载后按持久来源拒绝其他项目,切回原项目再处理", async () => {
    let active = "project-2";
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=" }]);
    const { deps, persisted } = makeDeps({ client, projectId: () => active });
    resetComfyBridgeCursorForTests();
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(0);
    expect(calls.acks).toEqual([]);
    active = "project-1";
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(1);
    expect(calls.acks).toEqual([1]);
  });

  it("部分成功后失败:只精确确认已成功项,失败项仍重试", async () => {
    const { client, calls } = makeClient([
      { id: 1, imageB64: "aGk=" },
      { id: 2, imageB64: "aGk=" },
      { id: 3, imageB64: "aGk=" },
    ]);
    const persist = vi.fn()
      .mockResolvedValueOnce({ url: "project-file://project-1/media/one.png" })
      .mockResolvedValueOnce({ url: null })
      .mockResolvedValue({ url: "project-file://project-1/media/retry.png" });
    const { deps } = makeDeps({ client, persist });
    await consumeComfyBridgeWritebacks(deps);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(calls.acks).toEqual([1]);
    await consumeComfyBridgeWritebacks(deps);
    expect(calls.cursor).toBe(0);
    expect(calls.acks).toEqual([1, 3]);
    expect(calls.exactAcks).toEqual([[1], [2, 3]]);
  });

  it("无活动项目时不消费收件箱", async () => {
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=" }]);
    const { deps, persisted } = makeDeps({ client, projectId: () => null });
    expect(await consumeComfyBridgeWritebacks(deps)).toEqual({ processed: 0, landed: 0 });
    expect(persisted).toHaveLength(0);
    expect(calls.acks).toEqual([]);
    expect(calls.cursor).toBe(-1);
  });

  it("图片写盘后目标已移除:不回写也不 ack", async () => {
    let shots = STORYBOARDS;
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
    const { deps, applied } = makeDeps({
      client,
      storyboards: () => shots,
      persist: async () => {
        shots = [];
        return { url: "project-file://project-1/media/one.png" };
      },
    });
    await consumeComfyBridgeWritebacks(deps);
    expect(applied).toHaveLength(0);
    expect(calls.acks).toEqual([]);
  });

  it("图片写盘期间同 id 分镜换章:保留旧章输出且不覆盖新章", async () => {
    let shots = [storyboard("sb-a", 1, "ep-1")];
    const { client, calls } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "sb-a" }]);
    const { deps, applied } = makeDeps({
      client,
      storyboards: () => shots,
      persist: async () => {
        shots = [storyboard("sb-a", 1, "ep-2")];
        return { url: "project-file://project-1/media/one.png" };
      },
    });
    await consumeComfyBridgeWritebacks(deps);
    expect(applied).toHaveLength(0);
    expect(calls.acks).toEqual([]);
    expect((await client.getBridgeWritebacks(0))?.items).toHaveLength(1);
  });

  it.each(["blob:preview", "project-file://project-2/media/video.mp4"])(
    "视频写桥返回非本项目持久地址:不回写不 ack (%s)", async (url) => {
      const { client, calls } = makeClient([{
        id: 1, videoB64: "aGk=", shotTarget: "S01", meta: { subfolder: "video/漫影/ep-1/sb-a" },
      }]);
      const { deps, appliedVideos } = makeDeps({ client, writeProjectBinary: async () => ({ success: true, url }) });
      await consumeComfyBridgeWritebacks(deps);
      expect(appliedVideos).toHaveLength(0);
      expect(calls.acks).toEqual([]);
    },
  );

  it("视频探测期间目标已移除:保留回写项", async () => {
    let shots = STORYBOARDS;
    const { client, calls } = makeClient([{
      id: 1, videoB64: "aGk=", shotTarget: "S01", meta: { subfolder: "video/漫影/ep-1/sb-a" },
    }]);
    const { deps, appliedVideos } = makeDeps({
      client,
      storyboards: () => shots,
      probeVideoDuration: async () => { shots = []; return null; },
    });
    await consumeComfyBridgeWritebacks(deps);
    expect(appliedVideos).toHaveLength(0);
    expect(calls.acks).toEqual([]);
  });

  it("图片已完成落账但 ack 失败:重载消费模块后只确认不重复写盘", async () => {
    const { client } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
    client.ackBridgeWritebacks = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(1);
    useStudioStore.setState({ storyboards: [...STORYBOARDS] });
    const { deps, persisted, notified } = makeDeps({ client, applyToStoryboard: undefined });
    await consumeComfyBridgeWritebacks(deps);
    expect(notified.filter((item) => item.kind === "error")).toEqual([{ kind: "error", detail: "回写确认失败,下轮重试" }]);
    expect(useStudioStore.getState().mediaTasks[0]).toMatchObject({ checkpointRef: "comfy-bridge:1", status: "success" });
    const originalStore = useStudioStore;
    vi.doMock("@/stores/studio/studio-store", () => ({ useStudioStore: originalStore }));
    vi.resetModules();
    try {
      const reloaded = await import("@/lib/assist/image-studio/comfy-bridge-writeback-consumer");
      await reloaded.consumeComfyBridgeWritebacks(deps);
      expect(persisted).toHaveLength(1);
      expect(useStudioStore.getState().mediaTasks).toHaveLength(1);
      expect(client.ackBridgeWritebacks).toHaveBeenCalledTimes(2);
    } finally {
      vi.doUnmock("@/stores/studio/studio-store");
      vi.resetModules();
    }
  });

  it("视频完整落账后 ack 失败:重置全部消费状态仍不重复保存或加版本", async () => {
    const { client } = makeClient([{
      id: 1, videoB64: "aGk=", shotTarget: "S01", meta: { subfolder: "video/漫影/ep-1/sb-a" },
    }]);
    client.ackBridgeWritebacks = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(1);
    useStudioStore.setState({ storyboards: [...STORYBOARDS] });
    const writeProjectBinary = vi.fn(async () => ({ success: true, url: "project-file://project-1/remotion/video.mp4" }));
    const { deps } = makeDeps({ client, applyVideoToStoryboard: undefined, writeProjectBinary });
    await consumeComfyBridgeWritebacks(deps);
    resetComfyBridgeCursorForTests();
    await consumeComfyBridgeWritebacks(deps);
    expect(writeProjectBinary).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().videoCandidates).toHaveLength(1);
    expect(useStudioStore.getState().storyboards[0].outputVersion).toBe(1);
  });

  it("未完成的图片媒体任务不充当落账回执", async () => {
    const { client } = makeClient([{ id: 1, imageB64: "aGk=", shotTarget: "S01" }]);
    useStudioStore.setState({ mediaTasks: [{
      id: "incomplete", kind: "storyboardImage", targetId: "sb-a", status: "running",
      checkpointRef: "comfy-bridge:1", outputRef: "project-file://project-1/media/one.png", createdAt: 1, updatedAt: 1,
    }] });
    const { deps, persisted, applied } = makeDeps({ client });
    await consumeComfyBridgeWritebacks(deps);
    expect(persisted).toHaveLength(1);
    expect(applied).toHaveLength(1);
  });

  it("视频:按章镜策略落项目并回写分镜,随后 ack", async () => {
    const { client, calls } = makeClient([{
      id: 6,
      videoB64: "aGk=",
      shotTarget: "S01",
      meta: { kind: "video", subfolder: "video/漫影/ep-1/sb-a", policy: "ambient" },
      ts: 123,
    }]);
    const written: Array<{ projectId: string; relativePath: string; bytes: ArrayBuffer }> = [];
    const { deps, appliedVideos, notified } = makeDeps({
      client,
      writeProjectBinary: async (projectId, relativePath, bytes) => {
        written.push({ projectId, relativePath, bytes });
        return { success: true, url: "project-file://project-1/remotion/outputs/shots/ep-1/sb-a/h3/ambient_v1_123.mp4" };
      },
    });

    const result = await consumeComfyBridgeWritebacks(deps);

    expect(result).toEqual({ processed: 1, landed: 1 });
    expect(written[0]).toMatchObject({
      projectId: "project-1",
      relativePath: "remotion/outputs/shots/ep-1/sb-a/h3/ambient_v1_123.mp4",
    });
    expect(new Uint8Array(written[0].bytes)).toEqual(new Uint8Array([104, 105]));
    expect(appliedVideos[0]).toMatchObject({ storyboardId: "sb-a", policy: "ambient", itemId: 6 });
    expect(notified[0]?.kind).toBe("storyboard");
    expect(calls.acks).toEqual([6]);
  });

  it("视频落盘成功后用主进程 probe 时长并写入分镜", async () => {
    const { client } = makeClient([{
      id: 61,
      videoB64: "aGk=",
      shotTarget: "S01",
      meta: { kind: "video", subfolder: "video/漫影/ep-1/sb-a", policy: "ambient" },
    }]);
    const { deps, appliedVideos } = makeDeps({
      client,
      probeVideoDuration: async (url) => {
        expect(url).toContain("project-file://project-1/");
        return 5_166_666;
      },
    });

    await consumeComfyBridgeWritebacks(deps);

    expect(appliedVideos[0]).toMatchObject({ h3DurationUs: 5_166_666 });
  });

  it("视频落盘失败:不回写分镜且不 ack", async () => {
    const { client, calls } = makeClient([{
      id: 7,
      videoB64: "aGk=",
      shotTarget: "S01",
      meta: { kind: "video", subfolder: "video/漫影/ep-1/sb-a", policy: "ambient" },
    }]);
    const { deps, appliedVideos, notified } = makeDeps({
      client,
      writeProjectBinary: async () => ({ success: false, error: "磁盘满" }),
    });

    const result = await consumeComfyBridgeWritebacks(deps);

    expect(result.landed).toBe(0);
    expect(appliedVideos).toHaveLength(0);
    expect(notified[0]).toMatchObject({ kind: "error", detail: "磁盘满" });
    expect(calls.acks).toHaveLength(0);
  });

  it.each(["video/漫影_S01", "video/ComfyUI/chapter-001/sb-a"]) (
    "视频旧前缀或用户目录:拒收且不落盘不 ack (%s)",
    async (subfolder) => {
      const { client, calls } = makeClient([
        { id: 8, videoB64: "aGk=", shotTarget: "S01", meta: { kind: "video", subfolder, policy: "ambient" } },
      ]);
      const written: string[] = [];
      const { deps, appliedVideos, notified } = makeDeps({
        client,
        writeProjectBinary: async (_projectId, relativePath) => {
          written.push(relativePath);
          return { success: true, url: "project-file://unexpected" };
        },
      });

      await consumeComfyBridgeWritebacks(deps);

      expect(written).toHaveLength(0);
      expect(appliedVideos).toHaveLength(0);
      expect(notified[0]).toMatchObject({ kind: "error", detail: "视频回写产物路径不在白名单" });
      expect(calls.acks).toHaveLength(0);
    },
  );

  it("client 失联:静默零处理(轮询面)", async () => {
    const { deps } = makeDeps({
      client: {
        getBridgeWritebacks: async () => {
          throw new Error("sidecar 未起");
        },
        ackBridgeWritebacks: async () => 0,
      },
    });
    const result = await consumeComfyBridgeWritebacks(deps);
    expect(result).toEqual({ processed: 0, landed: 0 });
  });
});
