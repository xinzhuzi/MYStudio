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

function storyboard(id: string, index: number, episodeId = "ep-1"): StoryboardItem {
  return {
    id,
    episodeId,
    index,
    duration: 2,
    videoDesc: "",
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

function makeClient(items: Array<{ id: number; imageB64?: string; shotTarget?: string }>) {
  const calls: { cursor: number; acks: number[] } = { cursor: -1, acks: [] };
  const client: ComfyBridgeWritebackConsumerClient = {
    async getBridgeWritebacks(cursor) {
      calls.cursor = cursor;
      const visible = items.filter((item) => item.id > cursor);
      return { cursor: items.length ? Math.max(...items.map((item) => item.id)) : cursor, items: visible };
    },
    async ackBridgeWritebacks(upTo) {
      calls.acks.push(upTo);
      return upTo;
    },
  };
  return { client, calls };
}

function makeDeps(overrides: Partial<ConsumeComfyBridgeWritebacksDeps> = {}): {
  deps: ConsumeComfyBridgeWritebacksDeps;
  applied: Array<{ storyboardId: string; url: string; itemId: number }>;
  persisted: Array<{ b64: string; title: string; source: string; prompt: string }>;
  notified: Array<{ kind: string; detail: string }>;
} {
  const applied: Array<{ storyboardId: string; url: string; itemId: number }> = [];
  const persisted: Array<{ b64: string; title: string; source: string; prompt: string }> = [];
  const notified: Array<{ kind: string; detail: string }> = [];
  const deps: ConsumeComfyBridgeWritebacksDeps = {
    client: { getBridgeWritebacks: async () => null, ackBridgeWritebacks: async () => 0 },
    storyboards: () => STORYBOARDS,
    applyToStoryboard: (storyboardId, url, item) => applied.push({ storyboardId, url, itemId: item.id }),
    persist: async (b64, title, options) => {
      persisted.push({ b64, title, ...options });
      return { url: `project-file://media/ai-image/x-${persisted.length}.png` };
    },
    notify: (kind, detail) => notified.push({ kind, detail }),
    ...overrides,
  };
  return { deps, applied, persisted, notified };
}

beforeEach(() => {
  resetComfyBridgeCursorForTests();
  vi.clearAllMocks();
});

describe("consumeComfyBridgeWritebacks", () => {
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

  it("cursor 前进:同批二次消费不再处理", async () => {
    const { client, calls } = makeClient([{ id: 5, imageB64: "aGk=", shotTarget: "S01" }]);
    const { deps, applied } = makeDeps({ client });

    await consumeComfyBridgeWritebacks(deps);
    await consumeComfyBridgeWritebacks(deps);

    expect(applied).toHaveLength(1);
    expect(calls.cursor).toBe(5); // 第二轮以已消费游标拉取
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
