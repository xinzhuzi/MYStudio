// @vitest-environment jsdom
/**
 * 项目级存储写锁测试(D41):获取/互斥/心跳/陈旧接管/竞速验主/释放/桥缺席放行。
 * 桥用内存 Map 模拟;时钟注入做确定性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageWriteLock, type StorageLockBridge } from "./storage-write-lock";

function makeBridge() {
  const files = new Map<string, string>();
  const bridge: StorageLockBridge = {
    readText: async ({ relativePath: p }: { projectId: string; relativePath: string }) => {
      const text = files.get(p);
      return text === undefined ? { success: false, error: "not found" } : { success: true, text };
    },
    writeText: async (p, v) => {
      files.set(p, v);
      return { success: true };
    },
    deleteText: async (p) => {
      files.delete(p);
      return { success: true };
    },
  };
  return { files, bridge };
}

function lockContent(files: Map<string, string>) {
  const raw = files.get("store/.storage-write-lock.json");
  return raw ? (JSON.parse(raw) as { id?: string; ts?: number }) : null;
}

let clock: number;
const now = () => clock;

beforeEach(() => {
  clock = 100_000;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("租约获取与互斥", () => {
  it("空锁位→获取成功并落锁文件(id+ts)", async () => {
    const { files, bridge } = makeBridge();
    const lock = createStorageWriteLock(() => bridge, { now });
    const v = await lock.ensure("proj-a");
    expect(v.ok).toBe(true);
    const c = lockContent(files);
    expect(c?.id).toBeTruthy();
    expect(typeof c?.ts).toBe("number");
    await lock.release("proj-a");
  });

  it("他人新鲜持锁→拒写并给出持锁者取证", async () => {
    const { files, bridge } = makeBridge();
    files.set("store/.storage-write-lock.json", JSON.stringify({ id: "other-instance", ts: now() - 1000 }));
    const lock = createStorageWriteLock(() => bridge, { now });
    const v = await lock.ensure("proj-a");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("other-in");
    // 锁未被覆盖(仍是他人)
    expect(lockContent(files)?.id).toBe("other-instance");
  });

  it("陈旧锁(>staleMs)→接管", async () => {
    const { files, bridge } = makeBridge();
    files.set("store/.storage-write-lock.json", JSON.stringify({ id: "dead-instance", ts: now() - 60_000 }));
    const lock = createStorageWriteLock(() => bridge, { now, staleMs: 15_000 });
    const v = await lock.ensure("proj-a");
    expect(v.ok).toBe(true);
    expect(lockContent(files)?.id).not.toBe("dead-instance");
    await lock.release("proj-a");
  });

  it("ts=0(已释放标记)→立即获取", async () => {
    const { files, bridge } = makeBridge();
    files.set("store/.storage-write-lock.json", JSON.stringify({ id: "gone", ts: 0 }));
    const lock = createStorageWriteLock(() => bridge, { now });
    expect((await lock.ensure("proj-a")).ok).toBe(true);
    await lock.release("proj-a");
  });
});

describe("心跳与竞速", () => {
  it("已持锁时 ensure 快路径通过;跨心跳窗补刷 ts", async () => {
    const { files, bridge } = makeBridge();
    const lock = createStorageWriteLock(() => bridge, { now, beatMs: 5000 });
    await lock.ensure("proj-a");
    const ts1 = lockContent(files)?.ts;
    clock += 1000;
    expect((await lock.ensure("proj-a")).ok).toBe(true);
    expect(lockContent(files)?.ts).toBe(ts1); // 窗内不刷
    clock += 6000;
    expect((await lock.ensure("proj-a")).ok).toBe(true);
    expect(lockContent(files)?.ts).toBeGreaterThan(ts1!); // 跨窗补刷
    await lock.release("proj-a");
  });

  it("锁写入失败(桥异常)→拒写不持有", async () => {
    const broken: StorageLockBridge = {
      readText: async () => null,
      writeText: async () => { throw new Error("disk full"); },
      deleteText: async () => ({ success: true }),
    };
    const lock = createStorageWriteLock(() => broken, { now });
    const v = await lock.ensure("proj-a");
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("写入失败");
  });
});

describe("释放与降级", () => {
  it("release 删除锁文件(善退即删)", async () => {
    const { files, bridge } = makeBridge();
    const lock = createStorageWriteLock(() => bridge, { now });
    await lock.ensure("proj-a");
    await lock.release("proj-a");
    expect(files.has("store/.storage-write-lock.json")).toBe(false);
  });

  it("桥缺席→fail-open(单测/无桥环境旧行为不变)", async () => {
    const lock = createStorageWriteLock(() => undefined, { now });
    const v = await lock.ensure("proj-a");
    expect(v.ok).toBe(true);
    expect(v.reason).toContain("no-bridge");
  });

  it("多项目分键:各持各锁互不误释放", async () => {
    const { files, bridge } = makeBridge();
    const lock = createStorageWriteLock(() => bridge, { now });
    await lock.ensure("proj-a");
    const idA = lockContent(files)?.id;
    await lock.release("proj-b"); // 未持有的项目释放=no-op
    expect(lockContent(files)?.id).toBe(idA); // proj-a 的锁还在
    await lock.release("proj-a");
  });
});
