/**
 * 实体提取批量执行器的错误分类(纯函数,C1 Step 3;design §4 / 父任务 D5)。
 *
 * 三类口径:
 * - quota_window:文本含 `[1308]` 或「使用上限」→ 解析「…重置」时刻为 resumeAt,
 *   全局挂起不计失败;解析不出时刻默认 now+30min 复探。
 * - transient(超时/5xx/网络/429 非 1308)→ 指数退避 30s/120s,共重试 2 次。
 * - fatal(解析为空表/输入缺失/截断/未知错误)→ 记 failed 继续下一章,不重试。
 *
 * 附 R6 纯函数面:stringifyErrorText 对 Error/对象/字符串/循环引用统一产出
 * 可读文本——修 useNovelPipelineActions throw 位 `[object Object]` 串化缺陷的
 * 底层工具(throw 位接线在后续 Step,本模块先行供管线复用)。
 */

/** 1308 无可解析重置时刻时的默认复探间隔:30 分钟(design §4)。 */
export const QUOTA_WINDOW_DEFAULT_RESUME_DELAY_MS = 30 * 60 * 1000;

export type ExtractionErrorKind = "quota_window" | "transient" | "fatal";

export interface ExtractionErrorClassification {
  kind: ExtractionErrorKind;
  /** 深串化后的可读错误文本(R6)。 */
  message: string;
  /** 仅 quota_window:额度窗口重置时刻(epoch ms);解析失败=now+30min。 */
  resumeAt: number | null;
}

/**
 * 任意形态错误 → 可读文本(R6)。对象走 JSON(含 Error 的序列化兜底),
 * 循环引用等 JSON.stringify 失败形态回退 String();目标=永不产出
 * `[object Object]`、永不抛异常。
 */
export function stringifyErrorText(error: unknown): string {
  if (error === undefined) return "";
  if (error === null) return "null";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }
  try {
    return JSON.stringify(error, (_key, value: unknown) => {
      if (value instanceof Error) {
        // Error.toJSON 缺省丢 message——显式摊平,嵌套 Error 也可见
        return { name: value.name, message: value.message };
      }
      return value;
    }) ?? String(error);
  } catch {
    return String(error);
  }
}

/** quota 判定:文本含 `[1308]` 或「使用上限」(design §4 并列两信号)。 */
export function isQuotaWindowError(text: string): boolean {
  return text.includes("[1308]") || text.includes("使用上限");
}

const TRANSIENT_PATTERNS: RegExp[] = [
  /timeout|timed[\s-]?out|超时/i,
  /\b(?:429|500|502|503|504)\b/i,
  /rate[\s-]?limit|too many requests/i,
  /econn(?:reset|refused|aborted)?|enotfound|eai_again|epipe/i,
  /fetch[\s-]?failed|network|socket|网络|连接(?:中断|失败|重置)/i,
];

/** transient 判定:超时/5xx/网络/429(非 1308)形态。 */
export function isTransientError(text: string): boolean {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text));
}

/** 「YYYY-MM-DD HH:MM:SS 重置」或「HH:MM:SS 重置」→ epoch ms;无时刻 null。
 *
 * 时刻形态来自装机实弹(diagnostics 2026-10-19 12:44:`(22:53:31 重置)`)与
 * design §4 口径(完整日期)。纯时刻按本地时今天解释,已过今天则顺延明天
 * (5h 滚动窗口的重置点在消息生成时刻之后,顺延是保守兜底)。
 */
export function parseQuotaResetAt(text: string, now: number): number | null {
  const full = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*重置/);
  if (full) {
    const [, y, mo, d, h, mi, s] = full;
    const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    if (!Number.isNaN(at.getTime())) return at.getTime();
  }

  const timeOnly = text.match(/(\d{2}):(\d{2}):(\d{2})\s*重置/);
  if (timeOnly) {
    const [, h, mi, s] = timeOnly;
    const today = new Date(now);
    const todayAt = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      Number(h),
      Number(mi),
      Number(s),
    );
    if (!Number.isNaN(todayAt.getTime())) {
      return todayAt.getTime() > now
        ? todayAt.getTime()
        : todayAt.getTime() + 24 * 60 * 60 * 1000;
    }
  }

  return null;
}

/** transient 指数退避:第 1 次重试 30s、第 2 次 120s;再往后无重试(共 2 次)。 */
export function transientBackoffDelayMs(retryAttempt: number): number | null {
  if (retryAttempt === 1) return 30_000;
  if (retryAttempt === 2) return 120_000;
  return null;
}

/** 错误分类器:quota_window 优先(文本可能同时带 429 与限额语义),次 transient,余 fatal。 */
export function classifyExtractionError(
  error: unknown,
  now: number = Date.now(),
): ExtractionErrorClassification {
  const message = stringifyErrorText(error);
  if (isQuotaWindowError(message)) {
    return {
      kind: "quota_window",
      message,
      resumeAt:
        parseQuotaResetAt(message, now) ??
        now + QUOTA_WINDOW_DEFAULT_RESUME_DELAY_MS,
    };
  }
  if (isTransientError(message)) {
    return { kind: "transient", message, resumeAt: null };
  }
  return { kind: "fatal", message, resumeAt: null };
}
