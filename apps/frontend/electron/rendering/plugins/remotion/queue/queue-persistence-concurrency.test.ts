// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRemotionQueueFilePersistence } from "./remotion-render-queue";

// 08-20 真机修复回归：enqueue 连发/队列 pump 并发 append 曾因无锁读改写+同名
// tmp 互抢 rename，产生 ENOENT 与交错损坏行（load 逐行 parse 崩→项目切换永挂）。
describe("createRemotionQueueFilePersistence 并发写", () => {
  it("50 路并发 append 全部落盘且零损坏行（互斥+随机 tmp）", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-persist-"));
    const persistence = createRemotionQueueFilePersistence(root);
    const events = Array.from({ length: 50 }, (_, i) => ({
      kind: "job-added" as const,
      jobId: `job-${i}`,
      at: i,
    }));
    await Promise.all(events.map((event) => persistence.append(event as never)));
    const raw = fs.readFileSync(path.join(root, "queue-events.jsonl"), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(50);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    const ids = new Set(lines.map((line) => JSON.parse(line).jobId));
    expect(ids.size).toBe(50); // 读改写并发不得丢事件
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("append 与 writeSnapshot 并发也各自完整落盘", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-persist-"));
    const persistence = createRemotionQueueFilePersistence(root);
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) => persistence.append({ kind: "state-changed", jobId: `j${i}` } as never)),
      persistence.writeSnapshot({ schemaVersion: 1, jobs: [] } as never),
      persistence.writeSnapshot({ schemaVersion: 1, jobs: [] } as never),
    ]);
    const lines = fs.readFileSync(path.join(root, "queue-events.jsonl"), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(20);
    expect(() => JSON.parse(fs.readFileSync(path.join(root, "queue-state.json"), "utf8"))).not.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
