import { describe, expect, it } from "vitest";
import {
  BATCH_PUBLISH_INTERVAL_MS,
  MAX_BATCH_TASKS,
  PLATFORM_ABBREVIATION,
  buildBatchDrafts,
  buildBatchProgressFromTasks,
  buildDifferentiatedTitle,
  buildSummaryReport,
  buildTopicsFromProductDefaultTags,
  checkBatchTaskLimit,
  checkDailyLimit,
  filterHistoryByProduct,
  getNextDayQueuedAt,
  isBatchComplete,
  planBatchSchedule,
  trimDescriptionForPlatform,
  validateBatchAccounts,
} from "./batch-publish";
import type { SelfMediaAccount, SelfMediaDraft, SelfMediaPlatform, SelfMediaTask } from "@/types/self-media";

function account(overrides: Partial<SelfMediaAccount> & Pick<SelfMediaAccount, "id" | "platform">): SelfMediaAccount {
  return {
    providerId: "aitoearn-local",
    displayName: `账号-${overrides.id}`,
    status: "online",
    capabilities: {
      providerId: "aitoearn-local",
      platform: overrides.platform,
      displayName: "演示平台",
      supportsVideo: true,
      supportsImageText: true,
      supportsScheduling: true,
      supportsCancellation: false,
      optionKeys: [],
    },
    ...overrides,
  };
}

function baseDraft(overrides: Partial<SelfMediaDraft> = {}): SelfMediaDraft {
  return {
    id: "draft-1",
    projectId: "project-1",
    contentType: "video",
    title: "新剧上线",
    description: "今日推荐",
    topics: [],
    assets: [],
    accountIds: ["account-1"],
    visibility: "public",
    platformOptions: { platform: "xhs" },
    updatedAt: "2026-11-25T00:00:00.000Z",
    ...overrides,
  };
}

function ledgerTask(overrides: Partial<SelfMediaTask> & Pick<SelfMediaTask, "id" | "accountId" | "status">): SelfMediaTask {
  return {
    attemptId: `attempt-${overrides.id}`,
    projectId: "project-1",
    providerId: "aitoearn-local",
    sourceAssetIds: ["asset-1"],
    progress: 0,
    createdAt: "2026-11-25T01:00:00.000Z",
    updatedAt: "2026-11-25T02:00:00.000Z",
    ...overrides,
  };
}

describe("checkBatchTaskLimit (MAX_BATCH_TASKS 风控)", () => {
  it("anchors the per-batch limit at 10 tasks", () => {
    expect(MAX_BATCH_TASKS).toBe(10);
  });

  it("marks a batch as exceeded only above the limit", () => {
    expect(checkBatchTaskLimit(10)).toEqual({ exceeded: false, count: 10, limit: 10 });
    expect(checkBatchTaskLimit(1)).toEqual({ exceeded: false, count: 1, limit: 10 });
    expect(checkBatchTaskLimit(11)).toEqual({ exceeded: true, count: 11, limit: 10 });
  });

  it("honors a custom limit", () => {
    expect(checkBatchTaskLimit(3, 2)).toEqual({ exceeded: true, count: 3, limit: 2 });
    expect(checkBatchTaskLimit(2, 2)).toEqual({ exceeded: false, count: 2, limit: 2 });
  });
});

describe("checkDailyLimit / validateBatchAccounts (注入计数)", () => {
  it("reads the injected count instead of localStorage", () => {
    expect(checkDailyLimit("a-limited", { "a-limited": 3 })).toEqual({ exceeded: true, count: 3, limit: 3 });
    expect(checkDailyLimit("a-fresh", { "a-limited": 3 })).toEqual({ exceeded: false, count: 0, limit: 3 });
    // 缺省(未知环境)按 0 处理:不超限不排队
    expect(checkDailyLimit("a-unknown").exceeded).toBe(false);
  });

  it("rejects offline accounts with an explicit reason", () => {
    const [result] = validateBatchAccounts([account({ id: "a1", platform: "xhs", status: "offline" })], "video");
    expect(result).toMatchObject({ accountId: "a1", eligible: false, reason: "账号不在线" });
    expect(result.queuedNextDay).toBeUndefined();
  });

  it("rejects accounts whose platform cannot carry the content type", () => {
    // wxSph 不支持图文(capabilities.test.ts 锚定的四平台事实)
    const [result] = validateBatchAccounts(
      [account({ id: "a1", platform: "wxSph", capabilities: { ...account({ id: "x", platform: "wxSph" }).capabilities, supportsImageText: false } })],
      "image-text",
    );
    expect(result).toMatchObject({ accountId: "a1", eligible: false, reason: "不支持图文内容" });
  });

  it("passes a healthy account without queueing", () => {
    const [result] = validateBatchAccounts([account({ id: "a1", platform: "xhs" })], "video", { "a1": 2 });
    expect(result).toEqual({ accountId: "a1", platform: "xhs", displayName: "账号-a1", eligible: true });
  });

  it("queues next-day instead of rejecting when the injected daily count hits the limit", () => {
    const [limited, fresh] = validateBatchAccounts(
      [account({ id: "a-limited", platform: "douyin" }), account({ id: "a-fresh", platform: "douyin" })],
      "video",
      { "a-limited": 3, "a-fresh": 2 },
    );
    expect(limited).toMatchObject({
      accountId: "a-limited",
      eligible: true,
      queuedNextDay: true,
      reason: "今日已发布 3/3 条,将排队到次日发布",
    });
    expect(fresh).toEqual({ accountId: "a-fresh", platform: "douyin", displayName: "账号-a-fresh", eligible: true });
  });
});

describe("buildDifferentiatedTitle (B1a 最小差异化)", () => {
  it("appends the platform abbreviation when the title has no marker", () => {
    expect(buildDifferentiatedTitle("新剧上线", "xhs")).toBe("新剧上线 [小红书]");
    expect(buildDifferentiatedTitle("新剧上线", "twitter")).toBe("新剧上线 [X]");
  });

  it("keeps the title as-is only when it carries this platform's bracket marker", () => {
    expect(buildDifferentiatedTitle("新剧上线 [小红书]", "xhs")).toBe("新剧上线 [小红书]");
  });

  it("appends for every other platform even when one platform's marker is present", () => {
    expect(buildDifferentiatedTitle("新剧上线 [小红书]", "douyin")).toBe("新剧上线 [小红书] [抖音]");
  });

  it("appends the abbreviation for bare platform-name mentions (裸提及不再抑制)", () => {
    expect(buildDifferentiatedTitle("新剧上线（抖音同步）", "xhs")).toBe("新剧上线（抖音同步） [小红书]");
    expect(buildDifferentiatedTitle("新剧上线｜小红书独家", "xhs")).toBe("新剧上线｜小红书独家 [小红书]");
  });

  it("appends the abbreviation when the title merely contains an abbreviation substring (MAX 含 X)", () => {
    expect(buildDifferentiatedTitle("MAX 新品", "twitter")).toBe("MAX 新品 [X]");
    expect(buildDifferentiatedTitle("BIG SALE", "instagram")).toBe("BIG SALE [IG]");
  });

  it("appends when a foreign bracket marker is present (双标识不原样,防两平台同题)", () => {
    const title = "首发 [小红书] [X]";
    expect(buildDifferentiatedTitle(title, "xhs")).toBe(`${title} [小红书]`);
    expect(buildDifferentiatedTitle(title, "twitter")).toBe(`${title} [X]`);
  });

  it("keeps final titles pairwise distinct across all platforms (不变量)", () => {
    const platforms = Object.keys(PLATFORM_ABBREVIATION) as SelfMediaPlatform[];
    const titles = platforms.map((platform) => buildDifferentiatedTitle("新剧上线", platform));
    expect(titles).toHaveLength(platforms.length);
    expect(new Set(titles).size).toBe(platforms.length);
  });
});

describe("trimDescriptionForPlatform", () => {
  it("returns short descriptions untouched", () => {
    expect(trimDescriptionForPlatform("短描述", "xhs")).toBe("短描述");
  });

  it("truncates to the platform limit with an ellipsis (twitter=280)", () => {
    const long = "好".repeat(300);
    const trimmed = trimDescriptionForPlatform(long, "twitter");
    expect(trimmed.length).toBe(280);
    expect(trimmed.endsWith("…")).toBe(true);
    expect(trimmed.slice(0, -1)).toBe(long.slice(0, 279));
  });
});

describe("buildBatchDrafts", () => {
  it("builds one per-account draft with differentiated title and per-platform options", () => {
    const items = buildBatchDrafts({
      baseDraft: baseDraft(),
      selectedAccounts: [account({ id: "a1", platform: "xhs" }), account({ id: "a2", platform: "twitter" })],
    });

    expect(items).toHaveLength(2);
    const [xhsItem, twitterItem] = items;
    expect(xhsItem.differentiatedTitle).toBe("新剧上线 [小红书]");
    expect(twitterItem.differentiatedTitle).toBe("新剧上线 [X]");

    expect(xhsItem.draft.id).toBe("draft-1-batch-xhs-a1");
    expect(xhsItem.draft.title).toBe("新剧上线 [小红书]");
    expect(xhsItem.draft.accountIds).toEqual(["a1"]);
    expect(xhsItem.draft.platformOptions.platform).toBe("xhs");
    expect(twitterItem.draft.platformOptions.platform).toBe("twitter");
    // baseDraft 的其余字段原样带过去
    expect(xhsItem.draft.projectId).toBe("project-1");
    expect(xhsItem.draft.visibility).toBe("public");
  });

  it("trims the description per platform while keeping the original for roomier platforms", () => {
    const long = "趣".repeat(300);
    const items = buildBatchDrafts({
      baseDraft: baseDraft({ description: long }),
      selectedAccounts: [account({ id: "a1", platform: "xhs" }), account({ id: "a2", platform: "twitter" })],
    });

    const [xhsItem, twitterItem] = items;
    expect(xhsItem.trimmedDescription).toBe(long); // xhs 限额 1000,不裁
    expect(twitterItem.trimmedDescription.length).toBe(280); // twitter 限额 280
    expect(twitterItem.trimmedDescription.endsWith("…")).toBe(true);
    expect(twitterItem.draft.description).toBe(twitterItem.trimmedDescription);
  });

  it("flags only queued accounts as queuedNextDay", () => {
    const items = buildBatchDrafts({
      baseDraft: baseDraft(),
      selectedAccounts: [account({ id: "a1", platform: "xhs" }), account({ id: "a2", platform: "douyin" })],
      queuedAccountIds: new Set(["a2"]),
    });

    expect(items[0].queuedNextDay).toBe(false);
    expect(items[1].queuedNextDay).toBe(true);
  });
});

describe("getNextDayQueuedAt (排队次日 08:05)", () => {
  it("schedules to the next day at 08:05 local time", () => {
    const queued = getNextDayQueuedAt(new Date(2026, 10, 25, 23, 59));
    expect(queued.getFullYear()).toBe(2026);
    expect(queued.getMonth()).toBe(10); // 11 月(0 基)
    expect(queued.getDate()).toBe(26);
    expect(queued.getHours()).toBe(8);
    expect(queued.getMinutes()).toBe(5);
    expect(queued.getSeconds()).toBe(0);
  });

  it("rolls into the next month when triggered on the last day", () => {
    const queued = getNextDayQueuedAt(new Date(2026, 11, 31, 12, 0));
    expect(queued.getMonth()).toBe(0);
    expect(queued.getDate()).toBe(1);
    expect(queued.getFullYear()).toBe(2027);
  });
});

describe("planBatchSchedule (L6 整批槽位)", () => {
  it("puts the verification account first at now+5s, then members 5 minutes apart", () => {
    const items = buildBatchDrafts({
      baseDraft: baseDraft(),
      selectedAccounts: [
        account({ id: "a1", platform: "xhs" }),
        account({ id: "a2", platform: "twitter" }),
        account({ id: "a3", platform: "douyin" }),
      ],
    });
    const now = new Date(2026, 10, 25, 12, 0, 0);
    const slots = planBatchSchedule({ items, now, batchId: "batch-1", verificationAccountId: "a2" });

    expect(slots.map((slot) => slot.role)).toEqual(["verification", "member", "member"]);
    const firstAt = new Date(slots[0].scheduledAt).getTime();
    expect(firstAt - now.getTime()).toBe(5_000);
    expect(new Date(slots[1].scheduledAt).getTime() - firstAt).toBe(BATCH_PUBLISH_INTERVAL_MS);
    expect(new Date(slots[2].scheduledAt).getTime() - firstAt).toBe(2 * BATCH_PUBLISH_INTERVAL_MS);
    // 同一 batchId 贯穿整批;角色写进草稿
    for (const slot of slots) {
      expect(slot.draft.batchId).toBe("batch-1");
      expect(slot.draft.batchRole).toBe(slot.role);
      expect(slot.draft.scheduledAt).toBe(slot.scheduledAt);
    }
    // 首发验证账号被挪到首位
    expect(slots[0].item.accountId).toBe("a2");
  });

  it("without verification the first slot is still now+5s and everyone is a member", () => {
    const items = buildBatchDrafts({
      baseDraft: baseDraft(),
      selectedAccounts: [account({ id: "a1", platform: "xhs" }), account({ id: "a2", platform: "douyin" })],
    });
    const now = new Date(2026, 10, 25, 12, 0, 0);
    const slots = planBatchSchedule({ items, now, batchId: "batch-2", verificationAccountId: null });

    expect(slots.map((slot) => slot.role)).toEqual(["member", "member"]);
    expect(new Date(slots[0].scheduledAt).getTime() - now.getTime()).toBe(5_000);
  });

  it("queues next-day accounts from 08:05 with in-batch 5-minute stagger", () => {
    const items = buildBatchDrafts({
      baseDraft: baseDraft(),
      selectedAccounts: [
        account({ id: "a1", platform: "xhs" }),
        account({ id: "q1", platform: "douyin" }),
        account({ id: "q2", platform: "twitter" }),
      ],
      queuedAccountIds: new Set(["q1", "q2"]),
    });
    const now = new Date(2026, 10, 25, 23, 58, 0);
    const slots = planBatchSchedule({ items, now, batchId: "batch-3", verificationAccountId: null });

    const queued = slots.filter((slot) => slot.role === "queued");
    expect(queued).toHaveLength(2);
    const firstQueued = new Date(queued[0].scheduledAt);
    expect(queued[0].draft.scheduledAt).toBe(queued[0].scheduledAt);
    expect(firstQueued.getDate()).toBe(26);
    expect(firstQueued.getHours()).toBe(8);
    expect(firstQueued.getMinutes()).toBe(5);
    expect(new Date(queued[1].scheduledAt).getTime() - firstQueued.getTime()).toBe(BATCH_PUBLISH_INTERVAL_MS);
    // 今天要发的槽位不受排队影响
    expect(slots.find((slot) => slot.role === "member")?.item.accountId).toBe("a1");
  });
});

describe("buildBatchProgressFromTasks (任务台账投影)", () => {
  it("projects batch tasks into items with the planned status mapping", () => {
    const tasks: SelfMediaTask[] = [
      ledgerTask({ id: "t-verify", accountId: "a2", status: "success", progress: 100, batchId: "batch-1", batchRole: "verification", platform: "twitter" }),
      ledgerTask({ id: "t-m1", accountId: "a1", status: "scheduled", batchId: "batch-1", batchRole: "member", platform: "xhs", scheduledAt: "2026-11-25T12:05:00.000Z" }),
      ledgerTask({ id: "t-m2", accountId: "a3", status: "failure", progress: 100, batchId: "batch-1", batchRole: "member", platform: "douyin", error: { code: "provider-request-failed", message: "上传失败", providerId: "aitoearn-local", retryable: true } }),
      ledgerTask({ id: "t-q1", accountId: "a4", status: "scheduled", batchId: "batch-1", batchRole: "queued", platform: "bilibili", scheduledAt: "2026-11-26T08:05:00.000Z" }),
      ledgerTask({ id: "t-other", accountId: "a5", status: "success", progress: 100 }), // 别的批次不进投影
    ];
    const progress = buildBatchProgressFromTasks({ batchId: "batch-1", tasks });
    expect(progress).not.toBeNull();
    if (!progress) return;
    expect(progress.total).toBe(4);
    expect(progress.items.map((item) => item.status)).toEqual(["success", "pending", "failure", "queued-next-day"]);
    expect(progress.items.map((item) => item.taskId)).toEqual(["t-verify", "t-m1", "t-m2", "t-q1"]);
    expect(progress.succeeded).toBe(1);
    expect(progress.failed).toBe(1);
    expect(progress.queued).toBe(1);
    expect(progress.completed).toBe(2);
    // 剩余估算只数今天要发的未完项(1 条 pending)
    expect(progress.estimatedRemainingMinutes).toBe(5);
    // 失败原因带进条目
    expect(progress.items[2].error).toBe("上传失败");
  });

  it("falls back the display name to 平台名 · 账号 ID 末 6 位 when the account list misses it", () => {
    const tasks: SelfMediaTask[] = [
      ledgerTask({ id: "t-1", accountId: "douyin:abcdef123456", status: "scheduled", batchId: "batch-9", batchRole: "member", platform: "douyin" }),
    ];
    const progress = buildBatchProgressFromTasks({ batchId: "batch-9", tasks, accounts: [] });
    expect(progress?.items[0].displayName).toBe("抖音 · 123456");
  });

  it("tolerates missing platform: no badge source, no crash, display name keeps account tail", () => {
    const tasks: SelfMediaTask[] = [
      ledgerTask({ id: "t-old", accountId: "account-x", status: "success", progress: 100, batchId: "batch-old" }),
    ];
    const progress = buildBatchProgressFromTasks({ batchId: "batch-old", tasks, accounts: [] });
    expect(progress).not.toBeNull();
    expect(progress?.items[0].platform).toBeUndefined();
    expect(progress?.items[0].displayName).toBe("账号 ount-x");
  });

  it("appends creation failures under the same batch and returns null for an unknown batch", () => {
    const tasks: SelfMediaTask[] = [
      ledgerTask({ id: "t-1", accountId: "a1", status: "scheduled", batchId: "batch-1", batchRole: "member", platform: "xhs" }),
    ];
    const progress = buildBatchProgressFromTasks({
      batchId: "batch-1",
      tasks,
      accounts: [account({ id: "a2", platform: "douyin" })],
      creationFailures: [{ accountId: "a2", platform: "douyin", error: "provider 无效" }],
    });
    expect(progress?.total).toBe(2);
    expect(progress?.items[1]).toMatchObject({ accountId: "a2", displayName: "账号-a2", status: "failure", error: "provider 无效" });

    expect(buildBatchProgressFromTasks({ batchId: "batch-none", tasks })).toBeNull();
  });
});

describe("isBatchComplete / buildSummaryReport", () => {
  it("keeps the batch busy while today's tasks are outstanding, ignoring queued ones", () => {
    const tasks: SelfMediaTask[] = [
      ledgerTask({ id: "t-q", accountId: "a4", status: "scheduled", batchId: "batch-1", batchRole: "queued", platform: "bilibili", scheduledAt: "2026-11-26T08:05:00.000Z" }),
    ];
    let progress = buildBatchProgressFromTasks({ batchId: "batch-1", tasks });
    // 只剩排队次日的任务时,批次就算结束(防重复锁解除)
    expect(progress && isBatchComplete(progress)).toBe(true);

    progress = buildBatchProgressFromTasks({
      batchId: "batch-1",
      tasks: [...tasks, ledgerTask({ id: "t-m", accountId: "a1", status: "scheduled", batchId: "batch-1", batchRole: "member", platform: "xhs", scheduledAt: "2026-11-25T12:05:00.000Z" })],
    });
    expect(progress && isBatchComplete(progress)).toBe(false);
  });

  it("summarizes failures with optional platform labels", () => {
    const progress = buildBatchProgressFromTasks({
      batchId: "batch-1",
      tasks: [
        ledgerTask({ id: "t-1", accountId: "a1", status: "success", progress: 100, batchId: "batch-1", batchRole: "member", platform: "xhs", updatedAt: "2026-11-25T12:10:00.000Z" }),
        ledgerTask({ id: "t-2", accountId: "a2", status: "failure", progress: 100, batchId: "batch-1", batchRole: "member", error: { code: "x", message: "上传失败", providerId: "aitoearn-local", retryable: true } }),
      ],
      creationFailures: [{ accountId: "a3", error: "建单失败" }],
    });
    if (!progress) throw new Error("progress should exist");
    const report = buildSummaryReport(progress, new Date(2026, 10, 25, 12, 0, 0));
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(2);
    expect(report.failures).toEqual([
      { platform: undefined, displayName: "账号 a2", error: "上传失败" },
      { platform: undefined, displayName: "账号 a3", error: "建单失败" },
    ]);
  });
});

describe("B1b product helpers", () => {
  it("builds space-separated hashtag topics from product default tags", () => {
    expect(buildTopicsFromProductDefaultTags(["漫剧", "剧情解说"])).toBe("#漫剧 #剧情解说");
    expect(buildTopicsFromProductDefaultTags([])).toBe("");
  });

  it("filters history by productId and returns everything when no filter is given", () => {
    const records = [{ productId: "p1" }, { productId: "p2" }, {}];
    expect(filterHistoryByProduct(records, "p1")).toEqual([{ productId: "p1" }]);
    expect(filterHistoryByProduct(records, undefined)).toBe(records);
  });
});
