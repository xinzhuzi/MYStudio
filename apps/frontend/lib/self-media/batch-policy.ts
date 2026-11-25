import type { SelfMediaTask } from "@/types/self-media";

/**
 * L6(1125 二轮收尾): 环境无关的批量发布纯函数与常量。
 * 主进程(闸门、每日统计 IPC)与渲染进程(排计划、进度投影)共用,
 * 不得引用 localStorage / Electron —— 需要状态的一律由调用方注入。
 */

/** Minimum interval between cross-platform publishes (5 minutes in ms). */
export const BATCH_PUBLISH_INTERVAL_MS = 5 * 60 * 1000;

/** Default daily publish limit per account. */
export const DEFAULT_DAILY_LIMIT_PER_ACCOUNT = 3;

/** 单批次任务数上限(implement.md 风控项 2:每批次 ≤ 10 个任务)。 */
export const MAX_BATCH_TASKS = 10;

/** 首槽提前量:首条也走定时(约 5 秒后由主进程发出),给草稿契约的「未来时间」留余量。 */
export const BATCH_FIRST_SLOT_DELAY_MS = 5_000;

/** 闸门顺延步长:首发验证还没出终态时,成员每 10 秒再问一次闸门。 */
export const BATCH_GATE_RETRY_MS = 10_000;

// ─── 每日次数统计口径(主进程与渲染进程共用,见 implement.md L6) ─────────────

/**
 * 「今天」按系统本地日期算,返回 YYYY-MM-DD。
 * 不用 toISOString().slice(0, 10)——那是 UTC 日期,本地跨午夜时口径会漂移。
 */
export function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayKeyOf(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? localDayKey(parsed) : "";
}

/**
 * 单条任务是否计入「该账号今天的发布次数」。
 *
 * 同一账号下,满足任一条即计一次:
 * - 已发出:状态 success/partial/audit,且 updatedAt 是今天。
 * - 占位(只在当天有效):draft/running 且 updatedAt 是今天;或 scheduled 且
 *   scheduledAt 是今天(不看 batchRole——排队任务到了到期那天就占当天额度)。
 * 失败、已取消、登录过期,以及 scheduledAt 不是今天的 scheduled 不计。
 *
 * 占位带日期:崩溃/强杀会留下永远是 draft 的任务,recover() 只处理
 * scheduled/running,若占位不带日期,三个僵尸就会让账号永久超限。
 */
export function countsTowardDailyPublish(task: SelfMediaTask, dateKey: string): boolean {
  switch (task.status) {
    case "success":
    case "partial":
    case "audit":
    case "draft":
    case "running":
      return dayKeyOf(task.updatedAt) === dateKey;
    case "scheduled":
      return Boolean(task.scheduledAt) && dayKeyOf(task.scheduledAt as string) === dateKey;
    default:
      return false;
  }
}

export interface DailyPublishStats {
  date: string;
  limit: number;
  counts: Record<string, number>;
}

export interface DailyPublishStatsOptions {
  /** 统计的「今天」,默认调用时刻的本地日期;测试注入固定值。 */
  dateKey?: string;
  limit?: number;
}

/** 统计单个账号今天的发布次数(整本台账,不按项目过滤)。 */
export function countDailyPublishes(
  tasks: readonly SelfMediaTask[],
  accountId: string,
  options: DailyPublishStatsOptions = {},
): number {
  const dateKey = options.dateKey ?? localDayKey(new Date());
  let count = 0;
  for (const task of tasks) {
    if (task.accountId !== accountId) continue;
    if (countsTowardDailyPublish(task, dateKey)) count += 1;
  }
  return count;
}

/** 按台账统计所有账号今天的发布次数(dailyPublishStats IPC 的回执体)。 */
export function summarizeDailyPublishes(
  tasks: readonly SelfMediaTask[],
  options: DailyPublishStatsOptions = {},
): DailyPublishStats {
  const dateKey = options.dateKey ?? localDayKey(new Date());
  const limit = options.limit ?? DEFAULT_DAILY_LIMIT_PER_ACCOUNT;
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    if (!countsTowardDailyPublish(task, dateKey)) continue;
    counts[task.accountId] = (counts[task.accountId] ?? 0) + 1;
  }
  return { date: dateKey, limit, counts };
}
