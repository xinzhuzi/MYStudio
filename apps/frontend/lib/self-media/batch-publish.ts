import type { SelfMediaAccount, SelfMediaDraft, SelfMediaPlatform, SelfMediaTask } from "@/types/self-media";
import { SELF_MEDIA_CAPABILITY_MANIFEST, PLATFORM_CHAR_LIMITS } from "./capabilities";

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
 * B5 template integration: If the title already contains platform differentiation
 * (from template {{platform}} variable), skip the fallback suffix to avoid duplication.
 * Design.md §B5: "模板自动注入 {{platform}} 变量,替代 B1a 的最小差异化机制"
 */
export function buildDifferentiatedTitle(baseTitle: string, platform: SelfMediaPlatform): string {
  // Check if title already has platform differentiation from template rendering
  const platformName = PLATFORM_ABBREVIATION[platform];
  const hasPlatformDifferentiation = 
    baseTitle.includes(`[${platformName}]`) || 
    baseTitle.includes(platformName) ||
    // Check for other common platform markers from templates
    Object.values(PLATFORM_ABBREVIATION).some(name => 
      baseTitle.includes(name) && platformName !== name
    );
  
  if (hasPlatformDifferentiation) {
    // Template already provided differentiation, return as-is
    return baseTitle;
  }
  
  // B1a fallback: append platform marker
  const abbr = PLATFORM_ABBREVIATION[platform];
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

/** Minimum interval between cross-platform publishes (5 minutes in ms). */
export const BATCH_PUBLISH_INTERVAL_MS = 5 * 60 * 1000;

/** Default daily publish limit per account. */
export const DEFAULT_DAILY_LIMIT_PER_ACCOUNT = 3;

/** First-publish verification platform (design.md: "默认 X/Twitter"). */
export const FIRST_PUBLISH_PLATFORM: SelfMediaPlatform = "twitter";

/**
 * 单批次任务数上限(implement.md 风控项 2:每批次 ≤ 10 个任务)。
 */
export const MAX_BATCH_TASKS = 10;

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

// ─── Risk control: daily limit tracking ──────────────────────────────────────

const DAILY_LIMIT_STORAGE_KEY = "mystudio-self-media-daily-publish-count";

interface DailyCountRecord {
  date: string; // YYYY-MM-DD
  counts: Record<string, number>; // accountId → count
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadDailyCounts(): DailyCountRecord {
  try {
    const raw = localStorage.getItem(DAILY_LIMIT_STORAGE_KEY);
    if (!raw) return { date: getTodayKey(), counts: {} };
    const parsed = JSON.parse(raw) as DailyCountRecord;
    if (parsed.date !== getTodayKey()) return { date: getTodayKey(), counts: {} };
    return parsed;
  } catch {
    return { date: getTodayKey(), counts: {} };
  }
}

function saveDailyCounts(record: DailyCountRecord): void {
  try {
    localStorage.setItem(DAILY_LIMIT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage may be unavailable; silently degrade
  }
}

/**
 * Get how many publishes an account has done today.
 */
export function getDailyPublishCount(accountId: string): number {
  const record = loadDailyCounts();
  return record.counts[accountId] ?? 0;
}

/**
 * Increment the daily publish count for an account.
 */
export function incrementDailyPublishCount(accountId: string): void {
  const record = loadDailyCounts();
  record.counts[accountId] = (record.counts[accountId] ?? 0) + 1;
  saveDailyCounts(record);
}

// ─── Scheduled-publish daily count (L2 复审修复) ────────────────────────────

/** 本页面会话内已回写每日计数的定时任务 ID(防进度事件重复计数)。 */
const countedScheduledTaskIds = new Set<string>();

/**
 * 定时任务成功实发后回写每日计数前调用:首次见到该 taskId 返回 true,之后返回 false。
 * 立即发布任务不经过此路径(发布循环在创建时已计数),不会双计。
 */
export function markScheduledPublishCounted(taskId: string): boolean {
  if (countedScheduledTaskIds.has(taskId)) return false;
  countedScheduledTaskIds.add(taskId);
  return true;
}

/**
 * Check if an account has exceeded the daily publish limit.
 * Returns `{ exceeded: boolean, count: number, limit: number }`.
 */
export function checkDailyLimit(accountId: string, limit = DEFAULT_DAILY_LIMIT_PER_ACCOUNT): { exceeded: boolean; count: number; limit: number } {
  const count = getDailyPublishCount(accountId);
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
 */
export function validateBatchAccounts(
  accounts: SelfMediaAccount[],
  contentType: "video" | "image-text",
): BatchAccountValidation[] {
  return accounts.map((account) => {
    if (account.status !== "online") {
      return { accountId: account.id, platform: account.platform, displayName: account.displayName, eligible: false, reason: "账号不在线" };
    }
    const supports = contentType === "video" ? account.capabilities.supportsVideo : account.capabilities.supportsImageText;
    if (!supports) {
      return { accountId: account.id, platform: account.platform, displayName: account.displayName, eligible: false, reason: `不支持${contentType === "video" ? "视频" : "图文"}内容` };
    }
    const dailyCheck = checkDailyLimit(account.id);
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

// ─── Batch publish progress ──────────────────────────────────────────────────

export type BatchItemStatus = "pending" | "publishing" | "success" | "failure" | "skipped" | "queued-next-day";

export interface BatchProgressItem {
  platform: SelfMediaPlatform;
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
  /** 排队次日项数(L2 起=已转定时任务的真实发布,不再混入 skipped) */
  queued: number;
  items: BatchProgressItem[];
  estimatedRemainingMinutes: number;
}

export function createInitialProgress(items: BatchDraftItem[]): BatchProgress {
  const queuedCount = items.filter((item) => item.queuedNextDay).length;
  const immediateCount = items.length - queuedCount;
  return {
    total: items.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    queued: queuedCount, // 排队次日项:本轮将转为定时任务(次日 08:05 实发),不是「跳过」
    items: items.map((item) => ({
      platform: item.platform,
      accountId: item.accountId,
      displayName: item.displayName,
      status: (item.queuedNextDay ? "queued-next-day" : "pending") as BatchItemStatus,
    })),
    estimatedRemainingMinutes: Math.ceil((immediateCount * BATCH_PUBLISH_INTERVAL_MS) / 60000),
  };
}

export function updateProgressItem(
  progress: BatchProgress,
  index: number,
  update: Partial<BatchProgressItem>,
): BatchProgress {
  const items = [...progress.items];
  items[index] = { ...items[index], ...update };
  const succeeded = items.filter((i) => i.status === "success").length;
  const failed = items.filter((i) => i.status === "failure").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const queued = items.filter((i) => i.status === "queued-next-day").length;
  // 排队项的定时任务创建成功(taskId 已回填)才计入完成;创建前不算
  const queuedScheduled = items.filter((i) => i.status === "queued-next-day" && i.taskId).length;
  const completed = succeeded + failed + skipped + queuedScheduled;
  const remaining = progress.total - completed;
  return {
    ...progress,
    items,
    completed,
    succeeded,
    failed,
    skipped,
    queued,
    estimatedRemainingMinutes: Math.ceil((remaining * BATCH_PUBLISH_INTERVAL_MS) / 60000),
  };
}

// ─── Batch summary report ────────────────────────────────────────────────────

export interface BatchSummaryReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** 排队次日(已转定时任务,次日 08:05 实发)项数 */
  queued: number;
  failures: Array<{ platform: SelfMediaPlatform; displayName: string; error: string }>;
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

// ─── Delay helper ─────────────────────────────────────────────────────────────

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
