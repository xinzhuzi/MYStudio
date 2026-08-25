// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRemotionQueueFilePersistence,
  migrateQueueEventsFileIfNeeded,
} from "./remotion-render-queue";

// 08-20 真机修复回归：enqueue 连发/队列 pump 并发 append 曾因无锁读改写+同名
// tmp 互抢 rename，产生 ENOENT 与交错损坏行（load 逐行 parse 崩→项目切换永挂）。
describe("createRemotionQueueFilePersistence 并发写", () => {
  it("50 路并发 append 全部落盘且零损坏行（互斥+随机 tmp）", async () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-persist-state-"));
    const eventsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-persist-events-"));
    const persistence = createRemotionQueueFilePersistence({ stateRoot, eventsRoot });
    const events = Array.from({ length: 50 }, (_, i) => ({
      kind: "job-added" as const,
      jobId: `job-${i}`,
      at: i,
    }));
    await Promise.all(events.map((event) => persistence.append(event as never)));
    const raw = fs.readFileSync(path.join(eventsRoot, "queue-events.jsonl"), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(50);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    const ids = new Set(lines.map((line) => JSON.parse(line).jobId));
    expect(ids.size).toBe(50); // 读改写并发不得丢事件
    expect(fs.existsSync(path.join(stateRoot, "queue-events.jsonl"))).toBe(false); // 事件不落状态根
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(eventsRoot, { recursive: true, force: true });
  });

  it("append 与 writeSnapshot 并发也各自完整落盘", async () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-persist-state-"));
    const eventsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-persist-events-"));
    const persistence = createRemotionQueueFilePersistence({ stateRoot, eventsRoot });
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) => persistence.append({ kind: "state-changed", jobId: `j${i}` } as never)),
      persistence.writeSnapshot({ schemaVersion: 1, jobs: [] } as never),
      persistence.writeSnapshot({ schemaVersion: 1, jobs: [] } as never),
    ]);
    const lines = fs.readFileSync(path.join(eventsRoot, "queue-events.jsonl"), "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(20);
    expect(() => JSON.parse(fs.readFileSync(path.join(stateRoot, "queue-state.json"), "utf8"))).not.toThrow();
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(eventsRoot, { recursive: true, force: true });
  });
});

describe("migrateQueueEventsFileIfNeeded 一次性迁移", () => {
  it("旧事件文件搬到目标目录,来源消失", () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-mig-state-"));
    const eventsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-mig-events-"));
    fs.writeFileSync(path.join(stateRoot, "queue-events.jsonl"), '{"kind":"job-added"}\n', "utf8");
    const result = migrateQueueEventsFileIfNeeded(
      path.join(stateRoot, "queue-events.jsonl"),
      path.join(eventsRoot, "queue-events.jsonl"),
    );
    expect(result).toBe("moved");
    expect(fs.existsSync(path.join(stateRoot, "queue-events.jsonl"))).toBe(false);
    expect(fs.readFileSync(path.join(eventsRoot, "queue-events.jsonl"), "utf8")).toContain("job-added");
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(eventsRoot, { recursive: true, force: true });
  });

  it("目标已存在或来源不存在时 no-op", () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-mig-state-"));
    const eventsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "queue-mig-events-"));
    // 目标已存在:来源保留原位
    fs.writeFileSync(path.join(stateRoot, "queue-events.jsonl"), "old\n", "utf8");
    fs.writeFileSync(path.join(eventsRoot, "queue-events.jsonl"), "new\n", "utf8");
    expect(
      migrateQueueEventsFileIfNeeded(
        path.join(stateRoot, "queue-events.jsonl"),
        path.join(eventsRoot, "queue-events.jsonl"),
      ),
    ).toBe("skipped");
    expect(fs.readFileSync(path.join(eventsRoot, "queue-events.jsonl"), "utf8")).toBe("new\n");
    // 来源不存在:无事发生
    fs.rmSync(path.join(eventsRoot, "queue-events.jsonl"));
    expect(
      migrateQueueEventsFileIfNeeded(
        path.join(stateRoot, "missing.jsonl"),
        path.join(eventsRoot, "queue-events.jsonl"),
      ),
    ).toBe("skipped");
    expect(fs.existsSync(path.join(eventsRoot, "queue-events.jsonl"))).toBe(false);
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.rmSync(eventsRoot, { recursive: true, force: true });
  });
});
