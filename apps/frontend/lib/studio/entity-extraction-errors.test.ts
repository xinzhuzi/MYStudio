import { describe, expect, it } from "vitest";
import {
  QUOTA_WINDOW_DEFAULT_RESUME_DELAY_MS,
  classifyExtractionError,
  isQuotaWindowError,
  isTransientError,
  parseQuotaResetAt,
  stringifyErrorText,
  transientBackoffDelayMs,
} from "./entity-extraction-errors";

/** 固定时基:2026-10-19 12:00:00 本地时(测试均注入 now,不依赖墙钟)。 */
const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime();

describe("entity-extraction-errors · quota_window 判定与 1308 解析", () => {
  it("装机实弹样本文本([1308]+时刻)→ quota_window 且解析出 resumeAt", () => {
    // 探子 3 实弹:diagnostics-2026-10-19 12:44 失败文本形态
    const text = "[1308] 已达到 5 小时的使用上限 (22:53:31 重置)";
    expect(isQuotaWindowError(text)).toBe(true);

    const parsed = parseQuotaResetAt(text, NOW);
    expect(parsed).toBe(new Date(2026, 9, 19, 22, 53, 31).getTime());

    const result = classifyExtractionError(new Error(text), NOW);
    expect(result.kind).toBe("quota_window");
    expect(result.resumeAt).toBe(new Date(2026, 9, 19, 22, 53, 31).getTime());
    expect(result.message).toContain("[1308]");
  });

  it("完整日期时刻「YYYY-MM-DD HH:MM:SS 重置」→ 精确解析(design §4 口径)", () => {
    const text = "请求失败:[1308] 已达到 5 小时的使用上限 (2026-10-20 08:00:00 重置)";
    expect(parseQuotaResetAt(text, NOW)).toBe(
      new Date(2026, 9, 20, 8, 0, 0).getTime(),
    );
  });

  it("仅含「使用上限」无 [1308] 码 → 仍判 quota_window(设计并列两信号)", () => {
    expect(isQuotaWindowError("该账号已达到本时段使用上限,请稍后再试")).toBe(true);
    expect(classifyExtractionError("达到使用上限", NOW).kind).toBe("quota_window");
  });

  it("1308 无可解析时刻 → 默认 now+30min(无时刻默认 +30min)", () => {
    const result = classifyExtractionError("[1308] quota exceeded", NOW);
    expect(result.kind).toBe("quota_window");
    expect(result.resumeAt).toBe(NOW + QUOTA_WINDOW_DEFAULT_RESUME_DELAY_MS);
    expect(QUOTA_WINDOW_DEFAULT_RESUME_DELAY_MS).toBe(30 * 60 * 1000);
  });

  it("纯时刻(HH:MM:SS 重置)已过今天 → 顺延到明天;未过 → 今天", () => {
    // now=12:00,时刻 22:53 → 今天
    expect(parseQuotaResetAt("(22:53:31 重置)", NOW)).toBe(
      new Date(2026, 9, 19, 22, 53, 31).getTime(),
    );
    // now=12:00,时刻 08:00(已过)→ 明天 08:00
    expect(parseQuotaResetAt("(08:00:00 重置)", NOW)).toBe(
      new Date(2026, 9, 20, 8, 0, 0).getTime(),
    );
  });

  it("无任何重置语义的文本 → parseQuotaResetAt 返回 null", () => {
    expect(parseQuotaResetAt("普通的网络错误", NOW)).toBeNull();
    expect(parseQuotaResetAt("", NOW)).toBeNull();
  });
});

describe("entity-extraction-errors · transient / fatal 分类", () => {
  it("超时/5xx/网络/429(非 1308)→ transient", () => {
    expect(classifyExtractionError("Request timeout after 300000ms", NOW).kind).toBe("transient");
    expect(classifyExtractionError("HTTP 503 Service Unavailable", NOW).kind).toBe("transient");
    expect(classifyExtractionError("429 Too Many Requests", NOW).kind).toBe("transient");
    expect(classifyExtractionError("fetch failed: ECONNRESET", NOW).kind).toBe("transient");
    expect(classifyExtractionError("网络连接中断", NOW).kind).toBe("transient");
    expect(isTransientError("ETIMEDOUT")).toBe(true);
  });

  it("解析为空表/输入缺失/截断/未知错误 → fatal 不重试", () => {
    expect(classifyExtractionError("未解析出任何实体", NOW).kind).toBe("fatal");
    expect(classifyExtractionError("input_truncated", NOW).kind).toBe("fatal");
    expect(classifyExtractionError("no_input", NOW).kind).toBe("fatal");
    // 未知 provider 错误(非 1308 非瞬时形态)→ fatal(未知错误也归可读文本,不盲重试)
    expect(classifyExtractionError("[1210] 参数校验失败", NOW).kind).toBe("fatal");
  });

  it("quota_window 优先级高于 transient(文本同时含 429 与 使用上限)", () => {
    expect(classifyExtractionError("429: 已达到使用上限 (13:00:00 重置)", NOW).kind).toBe(
      "quota_window",
    );
  });
});

describe("entity-extraction-errors · transient 退避节奏", () => {
  it("指数退避 30s/120s,第三次起无重试(design §4:共重试 2 次)", () => {
    expect(transientBackoffDelayMs(1)).toBe(30_000);
    expect(transientBackoffDelayMs(2)).toBe(120_000);
    expect(transientBackoffDelayMs(3)).toBeNull();
  });
});

describe("entity-extraction-errors · 深串化可读文本(R6 纯函数面)", () => {
  it("Error 形态 → message", () => {
    expect(stringifyErrorText(new Error("boom"))).toBe("boom");
  });

  it("字符串形态 → 原样", () => {
    expect(stringifyErrorText("plain failure")).toBe("plain failure");
  });

  it("对象形态 → JSON 可读文本,不再是 [object Object]", () => {
    const text = stringifyErrorText({ code: 1308, detail: "使用上限" });
    expect(text).toContain("1308");
    expect(text).not.toBe("[object Object]");
  });

  it("嵌套 Error 的对象 → JSON.stringify 处理不了的 Error 字段有兜底,不抛异常", () => {
    const nested = { err: new Error("inner"), extra: 1 };
    expect(() => stringifyErrorText(nested)).not.toThrow();
    expect(stringifyErrorText(nested)).toContain("inner");
  });

  it("循环引用对象 → 不抛异常且有字符串兜底", () => {
    const cyclic: Record<string, unknown> = { name: "cycle" };
    cyclic.self = cyclic;
    expect(() => stringifyErrorText(cyclic)).not.toThrow();
    expect(typeof stringifyErrorText(cyclic)).toBe("string");
    expect(stringifyErrorText(cyclic).length).toBeGreaterThan(0);
  });

  it("undefined/null → 空串语义(不崩,调用方给缺省文案)", () => {
    expect(stringifyErrorText(undefined)).not.toBe("[object Object]");
    expect(stringifyErrorText(null)).not.toBe("[object Object]");
  });
});
