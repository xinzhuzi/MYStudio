/**
 * 网络层错误翻译:把 undici 的 "fetch failed" / 浏览器的 "Failed to fetch"
 * 以及无 reason 的 AbortError 翻译成带具体原因的中文描述,供 toast/测试结果直接展示。
 *
 * 背景与铁律:
 * - Node fetch(undici)失败时 message 恒为 "fetch failed",真实原因(DNS 解析失败、
 *   拒绝连接、超时、证书错误…)藏在 error.cause / cause.cause / AggregateError.errors 里;
 *   原样透传 message 用户只会看到一句 "OpenAI 兼容: fetch failed",无从排查。
 * - 该函数运行在主进程 IPC 处理器内时 cause 链完整;跨过 IPC 边界后 cause 会丢失,
 *   因此必须在主进程 catch 处调用,而不是渲染层。
 */

export interface DescribeFetchErrorOptions {
  /** 超时文案前缀,如 "文本模型调用" / "模型测试";缺省为 "请求" */
  timeoutLabel?: string;
  /** 超时配置(ms),用于换算成可读秒数 */
  timeoutMs?: number;
  /** 目标端点 URL,附加在错误尾部帮助定位配置问题 */
  endpoint?: string;
}

/**
 * 结构化失败标记:重试/回退/止损等决策逻辑读标记,不再解析错误文案。
 * 注意:Error 跨 Electron IPC 时自定义属性会丢,消费侧请用
 * isNetworkFailureError() 兜底(标记优先,稳定文案前缀其次)。
 */
export interface NetworkFailureFlags {
  /** 传输层网络失败(DNS/拒连/重置/断流/超时),不含已拿到 HTTP 状态码的错误 */
  networkFailure?: boolean;
  /** 超时类失败(网络失败子集) */
  timeoutFailure?: boolean;
}

export type DescribedFetchError = Error & NetworkFailureFlags;

/** 系统错误码 → 大白话提示(用户裁定:UI 文案必须通俗) */
const CODE_HINTS: Array<{ match: RegExp; hint: string }> = [
  { match: /^(ENOTFOUND|EAI_AGAIN)$/, hint: "域名解析失败,无法找到服务器地址(检查 Base URL 域名或本机网络/DNS)" },
  { match: /^ECONNREFUSED$/, hint: "服务器拒绝连接(端口未开放或服务未启动)" },
  { match: /^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_RESPONSE_TIMEOUT)$/, hint: "连接或等待响应超时" },
  { match: /^(ECONNRESET|UND_ERR_SOCKET|EPIPE)$/, hint: "连接被服务器或网络中断" },
  { match: /^(EHOSTUNREACH|ENETUNREACH)$/, hint: "网络不可达" },
  { match: /^EPROTO$/, hint: "HTTPS 传输协议错误(常见于代理或中间设备干扰)" },
  { match: /^(CERT_|ERR_TLS|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO)/, hint: "HTTPS 证书校验失败" },
  { match: /^UND_ERR_ABORTED$/, hint: "请求被底层中断" },
];

const BARE_NETWORK_MESSAGES = new Set(["fetch failed", "failed to fetch"]);

/** Electron invoke 失败时给 message 加的固定前缀:"Error invoking remote method 'xxx': TypeError: ..." */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:[A-Za-z]+Error: )?/;

function stripIpcErrorPrefix(message: string): string {
  return message.replace(IPC_ERROR_PREFIX, "");
}

interface CauseDetail {
  code?: string;
  message?: string;
}

function isGenericCauseMessage(message: string | undefined): boolean {
  return !message || BARE_NETWORK_MESSAGES.has(message.toLowerCase()) || message === "This operation was aborted";
}

/**
 * 沿 cause 链(含 undici 的 AggregateError.errors)找最具体的系统错误。
 * 优先返回带错误码的候选(可映射大白话提示);只有 message 的中间包装层
 * (如 undici 的 "terminated")作为备选保留,同时继续向下深挖。
 */
function collectCauseDetail(error: unknown, depth = 0, fallback?: CauseDetail): CauseDetail | undefined {
  if (depth >= 4 || !error || typeof error !== "object") return fallback;
  const candidate = error as { cause?: unknown; errors?: unknown[]; code?: unknown; message?: unknown };

  if (Array.isArray(candidate.errors) && candidate.errors.length) {
    for (const inner of candidate.errors) {
      const found = collectCauseDetail(inner, depth + 1, fallback);
      if (found?.code) return found;
      fallback = found ?? fallback;
    }
  }

  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const message = typeof candidate.message === "string" ? candidate.message : undefined;
  if (code) return { code, message };
  if (!isGenericCauseMessage(message)) fallback = fallback ?? { message };

  return collectCauseDetail(candidate.cause, depth + 1, fallback);
}

function lookupCodeHint(code: string | undefined): string | undefined {
  if (!code) return undefined;
  for (const entry of CODE_HINTS) {
    if (entry.match.test(code)) return entry.hint;
  }
  return undefined;
}

function formatEndpointHost(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return endpoint.length > 80 ? `${endpoint.slice(0, 80)}…` : endpoint;
  }
}

function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 传输层超时的文案特征(中文标签或英文 token,跨层判定兜底用) */
const TIMEOUT_MESSAGE_PATTERN = /超时|timed?[\s_-]?out|timeout/i;
/**
 * 翻译产物/原始错误里指向传输层失败的稳定文案特征。
 * 注意:任务级轮询超时(如「视频生成超时(已轮询 N 次…)」)不算传输层失败,
 * 整单重试有重复付费风险,不列入。
 */
const NETWORK_FAILURE_MESSAGE_PATTERNS = [
  "网络请求失败",
  "fetch failed",
  "failed to fetch",
  "请求超时",
  "调用超时",
];

function isTransportFailureSource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = error instanceof Error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : String(error);
  if (BARE_NETWORK_MESSAGES.has(message.toLowerCase())) return true;
  // 关键:必须挖到带系统错误码的深层原因才算传输层失败。
  // AI SDK 会把 4xx/5xx 也包进带 errors/cause 的 RetryError,仅凭"链上有 message"
  // 会把鉴权/配额这类确定性 HTTP 错误误标成网络失败,误触发重试与回退。
  return Boolean(collectCauseDetail(error)?.code);
}

/** 传输层网络失败判定:结构化标记优先,稳定文案特征兜底(IPC 边界丢标记) */
export function isNetworkFailureError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as NetworkFailureFlags).networkFailure === true) return true;
  const name = error instanceof Error ? error.name : undefined;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return NETWORK_FAILURE_MESSAGE_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** 超时类失败判定:结构化标记优先,文案特征兜底 */
export function isTimeoutFailureError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as NetworkFailureFlags).timeoutFailure === true) return true;
  if (!isNetworkFailureError(error)) return false;
  return TIMEOUT_MESSAGE_PATTERN.test(error instanceof Error ? error.message : String(error));
}

/** 包装成带原因文案 + 结构化标记的错误对象;抛出侧统一用它,别再手写 new Error(describeFetchError(...)) */
export function createDescribedFetchError(error: unknown, options: DescribeFetchErrorOptions = {}): DescribedFetchError {
  const described = new Error(describeFetchError(error, options)) as DescribedFetchError;
  const transport = isTransportFailureSource(error) || isNetworkFailureError(error);
  if (transport) {
    described.networkFailure = true;
    if (TIMEOUT_MESSAGE_PATTERN.test(described.message)) described.timeoutFailure = true;
  }
  return described;
}

export function describeFetchError(error: unknown, options: DescribeFetchErrorOptions = {}): string {
  const errorName = error instanceof Error ? error.name : undefined;
  if (errorName === "AbortError" || errorName === "TimeoutError") {
    const label = options.timeoutLabel ?? "请求";
    const seconds = options.timeoutMs ? ` (${Math.round(options.timeoutMs / 1000)}s)` : "";
    return `${label}超时${seconds}`;
  }

  const rawMessage = stripIpcErrorPrefix(
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error),
  );
  // 已在主进程(或上一层)翻译过的错误直接透传,避免重复包装目标地址
  if (rawMessage.includes("网络请求失败") || rawMessage.includes("· 目标 ")) {
    return rawMessage;
  }
  const suffix = options.endpoint ? ` · 目标 ${formatEndpointHost(options.endpoint)}` : "";

  const isBareNetworkFailure = typeof rawMessage === "string" && BARE_NETWORK_MESSAGES.has(rawMessage.toLowerCase());
  if (!isBareNetworkFailure) {
    return `${rawMessage}${suffix}`;
  }

  const cause = collectCauseDetail(error);
  if (!cause) {
    return `网络请求失败,未获取到具体原因(可能是断网、代理或防火墙拦截)${suffix}`;
  }

  const hint = lookupCodeHint(cause.code);
  const detail = cause.code && cause.message && !cause.message.includes(cause.code)
    ? `${cause.code} ${cause.message}`
    : cause.message || cause.code || "";
  const reason = hint
    ? `网络请求失败:${hint}`
    : detail
      ? `网络请求失败:${clip(detail)}`
      : "网络请求失败,未获取到具体原因(可能是断网、代理或防火墙拦截)";
  return `${reason}${suffix}`;
}
