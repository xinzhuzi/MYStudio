import type { SelfMediaAccount, SelfMediaBatchRole, SelfMediaDraft, SelfMediaPlatform, SelfMediaTask } from "@/types/self-media";
import { SELF_MEDIA_CAPABILITY_MANIFEST, PLATFORM_CHAR_LIMITS } from "./capabilities";
import {
  BATCH_FIRST_SLOT_DELAY_MS,
  BATCH_GATE_RETRY_MS,
  BATCH_PUBLISH_INTERVAL_MS,
  DEFAULT_DAILY_LIMIT_PER_ACCOUNT,
  MAX_BATCH_TASKS,
  localDayKey,
} from "./batch-policy";

// L6: 风控常量与每日次数口径的真源在 batch-policy.ts(主进程与渲染进程共用),
// 这里保留再导出,既有调用方不受影响。
export {
  BATCH_FIRST_SLOT_DELAY_MS,
  BATCH_GATE_RETRY_MS,
  BATCH_PUBLISH_INTERVAL_MS,
  DEFAULT_DAILY_LIMIT_PER_ACCOUNT,
  MAX_BATCH_TASKS,
  localDayKey,
};
export { countDailyPublishes, countsTowardDailyPublish, summarizeDailyPublishes } from "./batch-policy";
export type { DailyPublishStats, DailyPublishStatsOptions } from "./batch-policy";

// ─── Platform abbreviations (D9 minimum differentiation) ────────────────────

/**
 * Fixed platform abbreviation mapping per design.md B1a spec.
 * Used to auto-append `[平台缩写]` to titles for minimum differentiation.
 */
export const PLATFORM_ABBREVIATION: Record<SelfMediaPlatform, string> = {
  xhs: "小红书",
  douyin: "抖音",
  wxSph: "视频号",
  KWAI: "快手",
  tiktok: "TikTok",
  youtube: "YouTube",
  bilibili: "B站",
  twitter: "X",
  wxGzh: "公众号",
  facebook: "FB",
  instagram: "IG",
  threads: "Threads",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  googleBusiness: "Google",
} as const;

/**
 * Build a differentiated title by appending `[平台缩写]` to the original title.
 * Per design.md B1a: "自动在标题末尾追加平台标识"
 *
 * A1(1125 补检)差异化规则:
 * - 仅当标题已带「本平台」的方括号标识 `[缩写]`、且没有携带其它平台的方括号标识时,
 *   才原样返回(两条件缺一不可:标题同时带两个平台标识时,原样返回会让两个平台落进
 *   同一个标题,违背「任意两平台最终标题必不相同」的不变量);
 * - 其余情形一律追加本平台 ` [缩写]`——裸提及任何平台名(含缩写子串,如「MAX」含 X)
 *   不再抑制追加;
 * - 缩写表互不相同,追加式输出两两不同,不变量成立。
 */
export function buildDifferentiatedTitle(baseTitle: string, platform: SelfMediaPlatform): string {
  const abbr = PLATFORM_ABBREVIATION[platform];
  const hasOwnMarker = baseTitle.includes(`[${abbr}]`);
  const hasForeignMarker = (Object.keys(PLATFORM_ABBREVIATION) as SelfMediaPlatform[])
    .some((other) => other !== platform && baseTitle.includes(`[${PLATFORM_ABBREVIATION[other]}]`));
  if (hasOwnMarker && !hasForeignMarker) return baseTitle;
  return `${baseTitle} [${abbr}]`;
}

// ─── Platform character limits ───────────────────────────────────────────────
// Re-exported from capabilities.ts (design.md: "capabilities.ts 已有各平台字数/媒体限制")
export { PLATFORM_CHAR_LIMITS } from "./capabilities";

/**
 * Trim description to fit platform character limit.
 * Appends "…" if content was truncated.
 */
export function trimDescriptionForPlatform(description: string, platform: SelfMediaPlatform): string {
  const limit = PLATFORM_CHAR_LIMITS[platform];
  if (description.length <= limit) return description;
  return `${description.slice(0, limit - 1)}…`;
}

// ─── Risk control constants (D4) ────────────────────────────────────────────
// BATCH_PUBLISH_INTERVAL_MS / DEFAULT_DAILY_LIMIT_PER_ACCOUNT / MAX_BATCH_TASKS
// 已上移 batch-policy.ts(文件头再导出)。

/** First-publish verification platform (design.md: "默认 X/Twitter"). */
export const FIRST_PUBLISH_PLATFORM: SelfMediaPlatform = "twitter";

/**
 * 校验单批次任务数是否超限(纯函数)。
 * `exceeded` 为 true 时调用方应在创建任何 task 前终止发布。
 */
export function checkBatchTaskLimit(
  count: number,
  limit: number = MAX_BATCH_TASKS,
): { exceeded: boolean; count: number; limit: number } {
  return { exceeded: count > limit, count, limit };
}

// ─── Queued-next-day scheduling ──────────────────────────────────────────────

/**
 * 排队次日的定时发布时刻:次日 08:05(本地时区)。
 * 分钟取 05 有意错开 08:00 整点,降低整点集中提交的风控特征。
 */
export const QUEUED_NEXT_DAY_HOUR = 8;
export const QUEUED_NEXT_DAY_MINUTE = 5;

/**
 * 计算排队次日任务的实际执行时间(次日 08:05,本地时区)。
 * 批量发布把超限账号的草稿填入 scheduledAt,走既有 createTask 定时任务链
 * (task-runtime 按 scheduledAt 调度,无需渲染进程驻留定时器)。
 */
export function getNextDayQueuedAt(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(QUEUED_NEXT_DAY_HOUR, QUEUED_NEXT_DAY_MINUTE, 0, 0);
  return next;
}

// ─── Risk control: daily limit tracking (L6: 计数改注入,不再读写 localStorage) ─

/**
 * L6(1125 二轮收尾): 每日次数的统计口径与真源在 batch-policy.ts
 * (countDailyPublishes / summarizeDailyPublishes),主进程按整本台账统计后
 * 经 dailyPublishStats IPC 提供给渲染进程。这里只保留注入式的判定纯函数。
 */

/**
 * Check if an account has exceeded the daily publish limit.
 * `counts` 由调用方注入(主进程 dailyPublishStats 回执的 counts 字段);
 * 缺省按 0 处理(测试与未知环境下的保守口径——不超限不排队)。
 */
export function checkDailyLimit(
  accountId: string,
  counts: Record<string, number> = {},
  limit = DEFAULT_DAILY_LIMIT_PER_ACCOUNT,
): { exceeded: boolean; count: number; limit: number } {
  const count = counts[accountId] ?? 0;
  return { exceeded: count >= limit, count, limit };
}

// ─── Risk control: pre-publish validation ────────────────────────────────────

export interface BatchAccountValidation {
  accountId: string;
  platform: SelfMediaPlatform;
  displayName: string;
  eligible: boolean;
  reason?: string;
  /** 超限时排队次日发布,而非直接拒绝 */
  queuedNextDay?: boolean;
}

/**
 * Validate a list of accounts for batch publishing eligibility.
 * Checks: online status, content-type support, daily limit.
 * 超限时标记为 queuedNextDay,而非直接拒绝(spec: "超限排队等待次日")。
 * `dailyCounts` 由调用方注入(主进程 dailyPublishStats 回执的 counts)。
 */
export function validateBatchAccounts(
  accounts: SelfMediaAccount[],
  contentType: "video" | "image-text",
  dailyCounts: Record<string, number> = {},
): BatchAccountValidation[] {
  return accounts.map((account) => {
    if (account.status !== "online") {
      return { accountId: account.id, platform: account.platform, displayName: account.displayName, eligible: false, reason: "账号不在线" };
    }
    const supports = contentType === "video" ? account.capabilities.supportsVideo : account.capabilities.supportsImageText;
    if (!supports) {
      return { accountId: account.id, platform: account.platform, displayName: account.displayName, eligible: false, reason: `不支持${contentType === "video" ? "视频" : "图文"}内容` };
    }
    const dailyCheck = checkDailyLimit(account.id, dailyCounts);
    if (dailyCheck.exceeded) {
      return {
        accountId: account.id,
        platform: account.platform,
        displayName: account.displayName,
        eligible: true,
        queuedNextDay: true,
        reason: `今日已发布 ${dailyCheck.count}/${dailyCheck.limit} 条,将排队到次日发布`,
      };
    }
    return { accountId: account.id, platform: account.platform, displayName: account.displayName, eligible: true };
  });
}

// ─── Group accounts by platform ──────────────────────────────────────────────

export interface PlatformAccountGroup {
  platform: SelfMediaPlatform;
  displayName: string;
  abbreviation: string;
  accounts: SelfMediaAccount[];
}

/**
 * Group accounts by platform, ordered by SELF_MEDIA_CAPABILITY_MANIFEST order.
 */
export function groupAccountsByPlatform(accounts: SelfMediaAccount[]): PlatformAccountGroup[] {
  const groups = new Map<SelfMediaPlatform, SelfMediaAccount[]>();
  for (const account of accounts) {
    const list = groups.get(account.platform) ?? [];
    list.push(account);
    groups.set(account.platform, list);
  }
  const orderedPlatforms = Object.keys(SELF_MEDIA_CAPABILITY_MANIFEST) as SelfMediaPlatform[];
  return orderedPlatforms
    .filter((platform) => groups.has(platform))
    .map((platform) => ({
      platform,
      displayName: SELF_MEDIA_CAPABILITY_MANIFEST[platform].displayName,
      abbreviation: PLATFORM_ABBREVIATION[platform],
      accounts: groups.get(platform) ?? [],
    }));
}

// ─── Batch draft builder ─────────────────────────────────────────────────────

export interface BatchDraftItem {
  platform: SelfMediaPlatform;
  accountId: string;
  displayName: string;
  draft: SelfMediaDraft;
  differentiatedTitle: string;
  trimmedDescription: string;
  /** 超限时排队次日,不立即发布 */
  queuedNextDay?: boolean;
}

/**
 * Build per-account drafts for batch publishing.
 * Each draft has:
 * - Title with platform abbreviation appended
 * - Description trimmed to platform character limit
 * - Platform options set for the specific platform
 *
 * @param queuedAccountIds 超限账号 ID 集合,这些账号将标记为 queuedNextDay
 */
export function buildBatchDrafts(params: {
  baseDraft: SelfMediaDraft;
  selectedAccounts: SelfMediaAccount[];
  queuedAccountIds?: Set<string>;
}): BatchDraftItem[] {
  const { baseDraft, selectedAccounts, queuedAccountIds } = params;
  const items: BatchDraftItem[] = [];

  for (const account of selectedAccounts) {
    const differentiatedTitle = buildDifferentiatedTitle(baseDraft.title, account.platform);
    const trimmedDescription = trimDescriptionForPlatform(baseDraft.description, account.platform);
    const isQueued = queuedAccountIds?.has(account.id) ?? false;

    const draft: SelfMediaDraft = {
      ...baseDraft,
      id: `${baseDraft.id}-batch-${account.platform}-${account.id}`,
      title: differentiatedTitle,
      description: trimmedDescription,
      accountIds: [account.id],
      platformOptions: {
        ...baseDraft.platformOptions,
        platform: account.platform,
      },
      updatedAt: new Date().toISOString(),
    };

    items.push({
      platform: account.platform,
      accountId: account.id,
      displayName: account.displayName,
      draft,
      differentiatedTitle,
      trimmedDescription,
      queuedNextDay: isQueued,
    });
  }

  return items;
}

// ─── Batch publish progress (L6: 由任务台账投影,不再有渲染进程循环的中间态) ──

export type BatchItemStatus = "pending" | "publishing" | "success" | "failure" | "skipped" | "queued-next-day";

export interface BatchProgressItem {
  /** 旧任务缺 platform;视图只在有值时显示平台徽标 */
  platform?: SelfMediaPlatform;
  accountId: string;
  displayName: string;
  status: BatchItemStatus;
  taskId?: string;
  error?: string;
}

export interface BatchProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** 排队次日项数(scheduled 且 batchRole=queued) */
  queued: number;
  items: BatchProgressItem[];
  estimatedRemainingMinutes: number;
}

/** 建单失败项:任务台账里不存在,视图挂在当前批次下显示为失败 */
export interface BatchCreationFailure {
  accountId: string;
  platform?: SelfMediaPlatform;
  displayName?: string;
  error: string;
}

/** 状态映射:任务记录 → 进度条目状态(implement.md L6 第 9 条) */
export function batchItemStatusOf(task: SelfMediaTask): BatchItemStatus {
  switch (task.status) {
    case "failure":
    case "expired-login":
      return "failure";
    case "canceled":
      return "skipped";
    case "success":
    case "partial":
    case "audit":
      return "success";
    case "running":
    case "draft":
      return "publishing";
    case "scheduled":
      return task.batchRole === "queued" ? "queued-next-day" : "pending";
    default:
      return "pending";
  }
}

/** 账号显示名:账号列表查得到用显示名,否则回落「平台名 · 账号 ID 末 6 位」 */
export function batchItemDisplayName(
  accountId: string,
  accounts: readonly SelfMediaAccount[],
  platform?: SelfMediaPlatform,
): string {
  const account = accounts.find((item) => item.id === accountId);
  if (account) return account.displayName;
  const platformName = platform ? SELF_MEDIA_CAPABILITY_MANIFEST[platform]?.displayName : undefined;
  return platformName ? `${platformName} · ${accountId.slice(-6)}` : `账号 ${accountId.slice(-6)}`;
}

/**
 * 把任务列表按 batchId 投影成进度面板。容忍缺 platform(旧任务/缺字段);
 * 建单失败项(台账里不存在)由 creationFailures 追加,复用同一套逐条状态行。
 */
export function buildBatchProgressFromTasks(params: {
  batchId: string;
  tasks: readonly SelfMediaTask[];
  accounts?: readonly SelfMediaAccount[];
  creationFailures?: readonly BatchCreationFailure[];
}): BatchProgress | null {
  const { batchId, tasks, accounts = [], creationFailures = [] } = params;
  const batchTasks = tasks
    .filter((task) => task.batchId === batchId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const failureItems: BatchProgressItem[] = creationFailures.map((failure) => ({
    platform: failure.platform,
    accountId: failure.accountId,
    displayName: failure.displayName ?? batchItemDisplayName(failure.accountId, accounts, failure.platform),
    status: "failure" as const,
    error: failure.error,
  }));
  if (batchTasks.length === 0 && failureItems.length === 0) return null;
  const items: BatchProgressItem[] = [
    ...batchTasks.map((task): BatchProgressItem => ({
      platform: task.platform,
      accountId: task.accountId,
      displayName: batchItemDisplayName(task.accountId, accounts, task.platform),
      status: batchItemStatusOf(task),
      taskId: task.id,
      error: task.error?.message,
    })),
    ...failureItems,
  ];
  return summarizeBatchItems(items);
}

/** 由条目直接生成计数(投影与视图共用) */
export function summarizeBatchItems(items: readonly BatchProgressItem[]): BatchProgress {
  const succeeded = items.filter((item) => item.status === "success").length;
  const failed = items.filter((item) => item.status === "failure").length;
  const skipped = items.filter((item) => item.status === "skipped").length;
  const queued = items.filter((item) => item.status === "queued-next-day").length;
  // 完成数不含排队次日(它们明天才发);剩余估算同样只数今天要发的未完项
  const outstandingToday = items.filter((item) => item.status === "pending" || item.status === "publishing").length;
  const completed = succeeded + failed + skipped;
  return {
    total: items.length,
    completed,
    succeeded,
    failed,
    skipped,
    queued,
    items: [...items],
    estimatedRemainingMinutes: Math.ceil((outstandingToday * BATCH_PUBLISH_INTERVAL_MS) / 60000),
  };
}

/** 本批今天要发的任务是否已全部结束(排队次日的不算)——防重复锁的解除条件 */
export function isBatchComplete(progress: BatchProgress): boolean {
  return progress.items.every((item) => item.status !== "pending" && item.status !== "publishing");
}

// ─── Batch slot planner (L6: 整批一次性建单,主进程闸门执行) ─────────────────

export interface BatchSlot {
  item: BatchDraftItem;
  /** 已带上 batchId/batchRole/scheduledAt 的最终草稿(经 validateSelfMediaDraft 后建单) */
  draft: SelfMediaDraft;
  role: SelfMediaBatchRole;
  scheduledAt: string;
}

/**
 * 排批次槽位(implement.md L6 第 2 条):
 * - 首发验证账号占第一槽,时刻是当前时间加 5 秒;
 * - 其余未排队账号依次加 5 分钟;
 * - 排队次日的账号从次日 08:05 起,在本批之内按 5 分钟错开。
 * 每条草稿带同一个 batchId 和对应的 batchRole。
 */
export function planBatchSchedule(params: {
  items: readonly BatchDraftItem[];
  now: Date;
  batchId: string;
  /** 首发验证账号 ID;null/缺省表示本批不做首发验证 */
  verificationAccountId?: string | null;
}): BatchSlot[] {
  const { items, now, batchId, verificationAccountId } = params;
  const slots: BatchSlot[] = [];
  const firstSlotAt = new Date(now.getTime() + BATCH_FIRST_SLOT_DELAY_MS);
  let todaySlotAt = firstSlotAt.getTime();

  const ordered = [...items];
  if (verificationAccountId) {
    const index = ordered.findIndex((item) => item.accountId === verificationAccountId);
    if (index > 0) {
      const [verification] = ordered.splice(index, 1);
      ordered.unshift(verification);
    }
  }

  for (const item of ordered) {
    const isVerification = Boolean(verificationAccountId) && item.accountId === verificationAccountId;
    if (item.queuedNextDay && !isVerification) {
      slots.push({
        item,
        role: "queued",
        scheduledAt: "",
        draft: { ...item.draft, batchId },
      });
      continue;
    }
    const scheduledAt = new Date(todaySlotAt).toISOString();
    todaySlotAt += BATCH_PUBLISH_INTERVAL_MS;
    slots.push({
      item,
      role: isVerification ? "verification" : "member",
      scheduledAt,
      draft: { ...item.draft, batchId },
    });
  }

  // 排队次日的槽位:次日 08:05 起,本批内按 5 分钟错开
  let queuedSlotAt = getNextDayQueuedAt(now).getTime();
  for (const slot of slots) {
    if (slot.role !== "queued") continue;
    slot.scheduledAt = new Date(queuedSlotAt).toISOString();
    slot.draft = { ...slot.draft, scheduledAt: slot.scheduledAt };
    queuedSlotAt += BATCH_PUBLISH_INTERVAL_MS;
  }

  return slots.map((slot) => ({
    ...slot,
    draft: {
      ...slot.draft,
      scheduledAt: slot.scheduledAt,
      batchRole: slot.role,
    },
  }));
}

// ─── Batch summary report ────────────────────────────────────────────────────

export interface BatchSummaryReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** 排队次日(已转定时任务,次日 08:05 实发)项数 */
  queued: number;
  failures: Array<{ platform?: SelfMediaPlatform; displayName: string; error: string }>;
  duration: string;
}

export function buildSummaryReport(progress: BatchProgress, startedAt: Date): BatchSummaryReport {
  const failures = progress.items
    .filter((item) => item.status === "failure")
    .map((item) => ({
      platform: item.platform,
      displayName: item.displayName,
      error: item.error ?? "未知错误",
    }));
  const elapsed = Date.now() - startedAt.getTime();
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  return {
    total: progress.total,
    succeeded: progress.succeeded,
    failed: progress.failed,
    skipped: progress.items.filter((item) => item.status === "skipped").length,
    queued: progress.items.filter((item) => item.status === "queued-next-day").length,
    failures,
    duration: minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`,
  };
}

// ─── First-publish verification ──────────────────────────────────────────────

/**
 * Check if any selected account is on the first-publish verification platform (X/Twitter).
 * 优先用 Twitter 验证;如果 Twitter 不在列表中,退回到第一个在线账号。
 */
export function findFirstPublishAccount(selectedAccounts: SelfMediaAccount[]): SelfMediaAccount | null {
  const twitterAccount = selectedAccounts.find((account) => account.platform === FIRST_PUBLISH_PLATFORM && account.status === "online");
  if (twitterAccount) return twitterAccount;
  // 退回到第一个在线账号
  return selectedAccounts.find((account) => account.status === "online") ?? null;
}

/**
 * L2(复审修复): 首发验证账号从「今日未超限」的账号中选。
 * findFirstPublishAccount 的 Twitter 优先/首个在线规则不变,但排除排队次日账号:
 * 它们今日已超限不应实发——若作为验证对象,要么违规实发、要么静默跳过验证
 * (与「批量前强制在低风险平台单发 1 条」规范冲突)。
 * 全部排队时返回 null:本轮无立即发布项,无需首发验证(全部转定时)。
 */
export function findEligibleFirstPublishAccount(
  selectedAccounts: SelfMediaAccount[],
  queuedAccountIds: Set<string>,
): SelfMediaAccount | null {
  return findFirstPublishAccount(
    selectedAccounts.filter((account) => !queuedAccountIds.has(account.id)),
  );
}

/**
 * Determine if first-publish verification should be performed.
 * 只要有多个平台就触发首发验证,不再要求 Twitter 必须在选中列表中(spec: "批量前强制在低风险平台单发 1 条")。
 * 如果 Twitter 在选中列表中,优先用 Twitter 验证;否则用第一个在线账号。
 */
export function shouldDoFirstPublishVerification(selectedAccounts: SelfMediaAccount[]): boolean {
  const platforms = new Set(selectedAccounts.map((a) => a.platform));
  return platforms.size > 1;
}

// ─── Task status check helper ─────────────────────────────────────────────────

export function isTerminalTaskStatus(status: SelfMediaTask["status"]): boolean {
  return ["success", "failure", "partial", "audit", "canceled", "expired-login"].includes(status);
}

// ─── Product association helpers (B1b) ────────────────────────────────────────

/**
 * Build topics string from product defaultTags.
 * Design: "自动填充产品的 defaultTags"
 * Format: space-separated hashtags (e.g., "#标签1 #标签2")
 */
export function buildTopicsFromProductDefaultTags(defaultTags: string[]): string {
  return defaultTags.map((tag) => `#${tag}`).join(" ");
}

/**
 * Filter history records by productId.
 * Design: "批量发布历史按产品筛选"
 */
export function filterHistoryByProduct<T extends { productId?: string }>(
  records: T[],
  productId: string | undefined,
): T[] {
  if (!productId) return records;
  return records.filter((record) => record.productId === productId);
}
