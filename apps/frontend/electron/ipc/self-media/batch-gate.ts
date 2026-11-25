import { BATCH_GATE_RETRY_MS, BATCH_PUBLISH_INTERVAL_MS } from "../../../lib/self-media/batch-policy";
import type { SelfMediaBatchRole, SelfMediaPlatform, SelfMediaTask, SelfMediaTaskStatus } from "../../../types/self-media";
import type { DiagnosticsLogEntryInput } from "../../../types/diagnostics";
import type { TaskGateDecision } from "../../aitoearn/task-runtime";

/**
 * L6(1125 二轮收尾): 批量发布闸门与级联。
 *
 * - 闸门(gateScheduled): 运行时把定时任务转「发布中」之前先问一次。只有带
 *   batchId 的任务受管;其它定时任务照旧直接执行,发布页即时单发不经过闸门。
 * - 级联(maybeCascade / cascadeNewMember): 本批首发验证任务进入失败、登录过期
 *   或已取消时,把其余还是 scheduled 的成员立即置败,错误码 batch-verification-failed。
 *
 * 「上一次放行时刻」记在两张内存表(按批次/按账号),不写任务记录、不落盘;
 * 表里没记录时(进程刚启动)退回同批/同账号非 scheduled 任务的最新 updatedAt 做保守兜底。
 */

export const BATCH_VERIFICATION_FAILED_CODE = "batch-verification-failed";

/** 首发验证出这三种终态时,成员不再外发 */
const VERIFICATION_BLOCKED: readonly SelfMediaTaskStatus[] = ["failure", "expired-login", "canceled"];

const isTerminalTaskStatus = (status: SelfMediaTaskStatus): boolean =>
  status === "success" || status === "failure" || status === "partial" || status === "audit"
  || status === "canceled" || status === "expired-login";

function verificationBlockedMessage(verificationStatus: SelfMediaTaskStatus): string {
  return verificationStatus === "canceled"
    ? "首发验证已取消，本条未发布"
    : "首发验证未通过，本条未发布";
}

export type BatchGateOptions = {
  tasks: Map<string, SelfMediaTask>;
  /** 级联置败经运行时的 abort 落地(走 apply 的 attemptId/终态防篡改检查) */
  abort: (task: SelfMediaTask, code: string, message: string) => Promise<SelfMediaTask>;
  intervalMs?: number;
  retryMs?: number;
  /** L6 诊断日志写手(main.ts 注入 writeDiagnosticsLog;测试不传就不写) */
  writeDiagnostic?: (entry: DiagnosticsLogEntryInput) => void;
};

export type BatchGate = {
  gateScheduled: (task: SelfMediaTask, nowMs: number) => TaskGateDecision;
  /** 任务进入失败/登录过期/已取消且是本批首发验证时,级联置败其余成员。 */
  maybeCascade: (task: SelfMediaTask) => Promise<void>;
  /** 建单处理器创建成员后调用:首发已是坏终态则立即置败并带回失败态任务。 */
  cascadeNewMember: (task: SelfMediaTask) => Promise<SelfMediaTask>;
  /** 闸门放行任务的时刻(诊断日志用;未放行过返回 undefined)。 */
  releasedAt: (taskId: string) => number | undefined;
  /** 批次任务真正开始发布(executeScheduled)时写一条诊断日志,给 L11 留实际发送时刻证据。 */
  writeStartDiagnostic: (task: SelfMediaTask, platform?: SelfMediaPlatform) => void;
};

export function createBatchGate(options: BatchGateOptions): BatchGate {
  const { tasks, abort } = options;
  const intervalMs = options.intervalMs ?? BATCH_PUBLISH_INTERVAL_MS;
  const retryMs = options.retryMs ?? BATCH_GATE_RETRY_MS;
  const lastReleaseByBatch = new Map<string, number>();
  const lastReleaseByAccount = new Map<string, number>();
  const releasedAtByTask = new Map<string, number>();

  const findVerification = (batchId: string): SelfMediaTask | undefined =>
    [...tasks.values()].find((task) => task.batchId === batchId && task.batchRole === ("verification" satisfies SelfMediaBatchRole));

  /**
   * 保守兜底:维度(批次或账号)表里还没放过行时,取该维度里状态不是 scheduled
   * 的任务中 updatedAt 最新的那条。覆盖重启补发、重启时正在发布、发布页刚单发过。
   */
  const fallbackReleaseTime = (batchId: string, accountId: string, dimension: "batch" | "account"): number | null => {
    let latest: number | null = null;
    for (const task of tasks.values()) {
      if (task.status === "scheduled") continue;
      if (dimension === "batch" ? task.batchId !== batchId : task.accountId !== accountId) continue;
      const timestamp = Date.parse(task.updatedAt);
      if (!Number.isFinite(timestamp)) continue;
      if (latest === null || timestamp > latest) latest = timestamp;
    }
    return latest;
  };

  /** 距最早允许放行时刻还差多少毫秒;≤0 即可放行。 */
  const intervalWaitMs = (batchId: string, accountId: string, nowMs: number): number => {
    let earliest = 0;
    const batchBase = lastReleaseByBatch.get(batchId) ?? fallbackReleaseTime(batchId, accountId, "batch");
    if (batchBase !== undefined && batchBase !== null) earliest = Math.max(earliest, batchBase + intervalMs);
    const accountBase = lastReleaseByAccount.get(accountId) ?? fallbackReleaseTime(batchId, accountId, "account");
    if (accountBase !== undefined && accountBase !== null) earliest = Math.max(earliest, accountBase + intervalMs);
    return earliest - nowMs;
  };

  const gateScheduled = (task: SelfMediaTask, nowMs: number): TaskGateDecision => {
    // 不带 batchId 的定时任务不受管,照旧直接执行
    if (!task.batchId) return { action: "execute" };

    // 首发检查(兜底):首发验证任务本身不做;批次里没有首发验证任务(单平台批次)时跳过
    if (task.batchRole !== "verification") {
      const verification = findVerification(task.batchId);
      if (verification) {
        if (VERIFICATION_BLOCKED.includes(verification.status)) {
          return { action: "fail", code: BATCH_VERIFICATION_FAILED_CODE, message: verificationBlockedMessage(verification.status) };
        }
        // 还没出终态:顺延 10 秒后再问
        if (!isTerminalTaskStatus(verification.status)) {
          return { action: "delay", delayMs: retryMs };
        }
      }
    }

    // 间隔检查:同批上一条放行、或同一账号上一条放行,距今不满间隔则顺延到满。
    // 不拿 scheduledAt 代入——首发拖长后成员被顺延,计划时刻没变,实际间隔会短于间隔常量。
    const waitMs = intervalWaitMs(task.batchId, task.accountId, nowMs);
    if (waitMs > 0) return { action: "delay", delayMs: waitMs };

    // 放行:把当前时刻记进两张表(首发验证任务也记)
    lastReleaseByBatch.set(task.batchId, nowMs);
    lastReleaseByAccount.set(task.accountId, nowMs);
    releasedAtByTask.set(task.id, nowMs);
    return { action: "execute" };
  };

  const cascadeFromVerification = async (verification: SelfMediaTask): Promise<void> => {
    if (!verification.batchId) return;
    const members = [...tasks.values()].filter((task) =>
      task.batchId === verification.batchId
      && task.id !== verification.id
      && task.batchRole !== "verification"
      && task.status === "scheduled");
    for (const member of members) {
      await abort(member, BATCH_VERIFICATION_FAILED_CODE, verificationBlockedMessage(verification.status));
    }
  };

  const maybeCascade = async (task: SelfMediaTask): Promise<void> => {
    if (!task.batchId || task.batchRole !== "verification") return;
    if (!VERIFICATION_BLOCKED.includes(task.status)) return;
    await cascadeFromVerification(task);
  };

  const cascadeNewMember = async (task: SelfMediaTask): Promise<SelfMediaTask> => {
    if (!task.batchId || task.batchRole === "verification") return task;
    const verification = findVerification(task.batchId);
    if (!verification || !VERIFICATION_BLOCKED.includes(verification.status)) return task;
    return abort(task, BATCH_VERIFICATION_FAILED_CODE, verificationBlockedMessage(verification.status));
  };

  const releasedAt = (taskId: string): number | undefined => releasedAtByTask.get(taskId);

  const writeStartDiagnostic = (task: SelfMediaTask, platform?: SelfMediaPlatform): void => {
    if (!options.writeDiagnostic || !task.batchId) return;
    options.writeDiagnostic({
      category: "runtime",
      operationId: task.id,
      message: "self-media batch task started",
      context: {
        batchId: task.batchId,
        batchRole: task.batchRole,
        platform: platform ?? task.platform,
        scheduledAt: task.scheduledAt,
        releasedAt: releasedAtByTask.get(task.id),
      },
    });
    releasedAtByTask.delete(task.id);
  };

  return { gateScheduled, maybeCascade, cascadeNewMember, releasedAt, writeStartDiagnostic };
}
