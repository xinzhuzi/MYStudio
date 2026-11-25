import { describe, expect, it } from "vitest";
import {
  BATCH_FIRST_SLOT_DELAY_MS,
  BATCH_GATE_RETRY_MS,
  BATCH_PUBLISH_INTERVAL_MS,
  DEFAULT_DAILY_LIMIT_PER_ACCOUNT,
  MAX_BATCH_TASKS,
  countDailyPublishes,
  countsTowardDailyPublish,
  localDayKey,
  summarizeDailyPublishes,
} from "./batch-policy";
import type { SelfMediaTask } from "@/types/self-media";

function task(overrides: Partial<SelfMediaTask> & Pick<SelfMediaTask, "status">): SelfMediaTask {
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
    attemptId: "attempt-1",
    projectId: "project-1",
    providerId: "aitoearn-local",
    accountId: "account-1",
    sourceAssetIds: ["asset-1"],
    progress: 0,
    createdAt: "2026-11-25T01:00:00.000Z",
    updatedAt: "2026-11-25T02:00:00.000Z",
    ...overrides,
  };
}

describe("batch-policy 常量锚点", () => {
  it("keeps the risk-control constants at their anchored values", () => {
    expect(BATCH_PUBLISH_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(DEFAULT_DAILY_LIMIT_PER_ACCOUNT).toBe(3);
    expect(MAX_BATCH_TASKS).toBe(10);
    expect(BATCH_FIRST_SLOT_DELAY_MS).toBe(5_000);
    expect(BATCH_GATE_RETRY_MS).toBe(10_000);
  });
});

describe("localDayKey (按系统本地日期)", () => {
  it("formats the local calendar date, not the UTC date", () => {
    // 本地时区内 23:30 还在当天;UTC 可能已是次日
    const lateEvening = new Date(2026, 10, 25, 23, 30);
    expect(localDayKey(lateEvening)).toBe("2026-11-25");
  });

  it("pads month and day", () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("countsTowardDailyPublish (每日次数口径)", () => {
  const today = "2026-11-25";

  it("counts today's published statuses by updatedAt", () => {
    for (const status of ["success", "partial", "audit"] as const) {
      expect(countsTowardDailyPublish(task({ status }), today)).toBe(true);
    }
  });

  it("does not count yesterday's success", () => {
    const yesterday = task({ status: "success", updatedAt: "2026-11-24T09:00:00.000Z" });
    expect(countsTowardDailyPublish(yesterday, today)).toBe(false);
  });

  it("does not count failure, canceled, or expired-login regardless of date", () => {
    for (const status of ["failure", "canceled", "expired-login"] as const) {
      expect(countsTowardDailyPublish(task({ status }), today)).toBe(false);
    }
  });

  it("counts today's draft/running placeholders but not yesterday's zombies", () => {
    expect(countsTowardDailyPublish(task({ status: "draft" }), today)).toBe(true);
    expect(countsTowardDailyPublish(task({ status: "running" }), today)).toBe(true);
    // 僵尸用例:崩溃留下的 draft/running 到了次日不再占额
    expect(countsTowardDailyPublish(task({ status: "draft", updatedAt: "2026-11-24T09:00:00.000Z" }), today)).toBe(false);
    expect(countsTowardDailyPublish(task({ status: "running", updatedAt: "2026-11-24T09:00:00.000Z" }), today)).toBe(false);
  });

  it("counts a scheduled task by its scheduledAt day, regardless of batchRole", () => {
    const queued = task({ status: "scheduled", batchRole: "queued", scheduledAt: "2026-11-25T00:05:00.000Z", updatedAt: "2026-11-24T09:00:00.000Z" });
    expect(countsTowardDailyPublish(queued, today)).toBe(true);
  });

  it("does not count a scheduled task whose scheduledAt is another day", () => {
    const tomorrow = task({ status: "scheduled", scheduledAt: "2026-11-26T00:05:00.000Z" });
    expect(countsTowardDailyPublish(tomorrow, today)).toBe(false);
  });
});

describe("countDailyPublishes / summarizeDailyPublishes", () => {
  const today = "2026-11-25";

  it("sums only the counted tasks of the requested account", () => {
    const tasks = [
      task({ status: "success" }),
      task({ status: "scheduled", scheduledAt: "2026-11-25T08:05:00.000Z" }),
      task({ status: "failure" }),
      task({ status: "success", accountId: "account-2" }),
      task({ status: "success", updatedAt: "2026-11-24T09:00:00.000Z" }),
    ];
    expect(countDailyPublishes(tasks, "account-1", { dateKey: today })).toBe(2);
    expect(countDailyPublishes(tasks, "account-2", { dateKey: today })).toBe(1);
    expect(countDailyPublishes(tasks, "account-missing", { dateKey: today })).toBe(0);
  });

  it("summarizes per-account counts with the default limit", () => {
    const tasks = [
      task({ accountId: "account-1", status: "success" }),
      task({ accountId: "account-1", status: "partial" }),
      task({ accountId: "account-2", status: "canceled" }),
      task({ accountId: "account-2", status: "scheduled", scheduledAt: "2026-11-25T08:05:00.000Z" }),
    ];
    expect(summarizeDailyPublishes(tasks, { dateKey: today })).toEqual({
      date: today,
      limit: DEFAULT_DAILY_LIMIT_PER_ACCOUNT,
      counts: { "account-1": 2, "account-2": 1 },
    });
  });

  it("rolls the window across midnight via the date key", () => {
    // 用本地正午构造,ISO 串反解回同一本地日,不受机器时区影响
    const publishedAt = new Date(2026, 10, 25, 12, 0);
    const tasks = [task({ status: "success", updatedAt: publishedAt.toISOString() })];
    expect(countDailyPublishes(tasks, "account-1", { dateKey: localDayKey(publishedAt) })).toBe(1);
    expect(countDailyPublishes(tasks, "account-1", { dateKey: "2026-11-26" })).toBe(0);
  });
});
