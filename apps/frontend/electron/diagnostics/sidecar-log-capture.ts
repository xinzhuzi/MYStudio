// 子进程日志捕获——Python sidecar / Electron worker 的 stdout/stderr 统一落盘到
// <userData>/logs/sidecars/<module>-<时间戳>.log。
//
// 设计约束:
// - 模块级 configureSidecarLogCapture 一次注入(main.ts);各 spawn/execFile 现场
//   只认 module 名,不穿目录依赖。未配置时全部 no-op(测试/旧接线安全)。
// - stdio 从 ignore 改 pipe 的 spawn 必须同时挂 data 监听,否则管道塞满会卡死
//   子进程——本模块统一保证。
// - 单文件 10MB 封顶:超限写一行截断标记后停写(不截断中段,保尾部完整因果)。
// - 同 module 旧文件超 14 天,下次创建 writer 时清扫。

import fs from "node:fs";
import path from "node:path";
import type { DiagnosticsLogEntryInput } from "../../types/diagnostics";

interface SidecarStreamLike {
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
}

/** 结构化最小子进程形态:真实 ChildProcess、注入型窄类型(如 tts 的
 * Pick<ChildProcess,"pid"|"kill">)、测试 mock 均可直接传入;缺失的流/事件由
 * 实现侧防御性跳过——捕获绝不能弄断宿主链。 */
export interface SidecarChildLike {
  pid?: number | undefined;
  stdout?: SidecarStreamLike | null;
  stderr?: SidecarStreamLike | null;
  once?(event: "close", listener: (code: number | null, signal: string | null) => void): unknown;
  once?(event: "error", listener: (error: Error) => void): unknown;
}

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 14;
const MODULE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface SidecarLogCaptureConfig {
  /** sidecar 日志目录(<userData>/logs/sidecars)。 */
  getSidecarsDir: () => string;
  /** 生命周期事件同步进 diagnostics 主事件流(category=runtime)。 */
  writeDiagnostics?: (entry: DiagnosticsLogEntryInput) => void | Promise<void>;
  maxFileBytes?: number;
  retentionDays?: number;
}

let config: SidecarLogCaptureConfig | null = null;

export function configureSidecarLogCapture(next: SidecarLogCaptureConfig | null): void {
  config = next;
}

interface SidecarLogWriter {
  readonly filePath: string;
  append(line: string): void;
}

function assertModuleName(module: string): void {
  if (!MODULE_NAME_PATTERN.test(module)) {
    throw new Error(`sidecar 日志 module 名必须是 kebab-case 安全路径段: ${module}`);
  }
}

function formatStamp(date: Date): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function sweepStaleFiles(sidecarsDir: string, module: string, retentionDays: number, now: Date): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(sidecarsDir);
  } catch {
    return; // 目录不存在=无旧文件
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.startsWith(`${module}-`) || !entry.endsWith(".log")) continue;
    const filePath = path.join(sidecarsDir, entry);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch {
      // 清扫是尽力而为:单个文件失败不阻断日志链
    }
  }
}

function createSidecarLogWriter(module: string, now: Date): SidecarLogWriter | null {
  if (!config) return null;
  // 降级不反噬:目录不可建/权限坏时返回 null,捕获静默让位宿主链(设计不变量)。
  try {
    const sidecarsDir = config.getSidecarsDir();
    assertModuleName(module);
    const filePath = path.join(sidecarsDir, `${module}-${formatStamp(now)}.log`);
    fs.mkdirSync(sidecarsDir, { recursive: true });
    sweepStaleFiles(sidecarsDir, module, config.retentionDays ?? DEFAULT_RETENTION_DAYS, now);
    const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    let bytesWritten = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    let capped = false;
    return {
      filePath,
      append(line: string) {
        if (capped) return;
        const payload = `${line}\n`;
        try {
          fs.appendFileSync(filePath, payload, "utf8");
          bytesWritten += Buffer.byteLength(payload, "utf8");
          if (bytesWritten > maxFileBytes) {
            capped = true;
            fs.appendFileSync(filePath, `[truncated] 文件超 ${maxFileBytes} 字节上限,后续输出停写\n`, "utf8");
          }
        } catch {
          // 日志落盘失败不反噬宿主进程
        }
      },
    };
  } catch (error) {
    console.warn(`[sidecar-log-capture] 无法创建 ${module} 日志文件,本次捕获降级为 no-op:`, error);
    return null;
  }
}

function emitDiagnostics(entry: DiagnosticsLogEntryInput): void {
  const sink = config?.writeDiagnostics;
  if (!sink) return;
  try {
    void sink(entry);
  } catch {
    // diagnostics 写入失败不影响子进程链
  }
}

export interface SidecarCaptureHandle {
  /** 本次捕获的日志文件路径;未配置捕获时为 null。 */
  filePath: string | null;
  /** 手动收尾(测试用);close 事件后自动失效。 */
  dispose(): void;
}

/** 给长驻 spawn 子进程挂 stdout/stderr 行缓冲落盘。
 * child 的 stdio 必须是 pipe(本函数不改变已有 stdio 配置)。 */
export function captureSidecarOutput(options: {
  module: string;
  child: SidecarChildLike;
  label?: string;
}): SidecarCaptureHandle {
  const { module, child, label } = options;
  if (!config) return { filePath: null, dispose: () => undefined };
  const writer = createSidecarLogWriter(module, new Date());
  if (!writer) return { filePath: null, dispose: () => undefined };

  let disposed = false;
  const carry: { out: string; err: string } = { out: "", err: "" };
  writer.append(`[start] ${label ?? module} pid=${child.pid ?? "unknown"}`);

  const consume = (stream: "out" | "err", chunk: Buffer) => {
    const prefix = stream === "err" ? "[err] " : "[out] ";
    carry[stream] += chunk.toString("utf8");
    const lines = carry[stream].split("\n");
    carry[stream] = lines.pop() ?? "";
    for (const line of lines) if (line) writer.append(prefix + line);
  };

  if (child.stdout && typeof child.stdout.on === "function") child.stdout.on("data", (chunk: Buffer) => consume("out", chunk));
  else writer.append("[note] stdout 未接管(stdio 非 pipe 或 mock),仅捕获 stderr");
  if (child.stderr && typeof child.stderr.on === "function") child.stderr.on("data", (chunk: Buffer) => consume("err", chunk));
  else writer.append("[note] stderr 未接管(stdio 非 pipe 或 mock),仅捕获 stdout");

  const finalize = () => {
    if (disposed) return;
    disposed = true;
    if (carry.out) writer.append(`[out] ${carry.out}`);
    if (carry.err) writer.append(`[err] ${carry.err}`);
  };
  if (typeof child.once === "function") {
    child.once("close", (code, signal) => {
      writer.append(`[exit] code=${code ?? "null"} signal=${signal ?? "null"}`);
      emitDiagnostics({
        category: "runtime",
        level: code === 0 ? "info" : "warn",
        message: `sidecar ${module} 退出 code=${code ?? "null"} signal=${signal ?? "null"}`,
        context: { module, pid: child.pid ?? null, exitCode: code ?? null, signal: signal ?? null, logFile: writer.filePath },
      });
      finalize();
    });
    child.once("error", (error) => {
      writer.append(`[error] ${error.message}`);
      emitDiagnostics({
        category: "runtime",
        level: "error",
        message: `sidecar ${module} 进程错误: ${error.message}`,
        context: { module, logFile: writer.filePath },
      });
      finalize();
    });
  }

  return { filePath: writer.filePath, dispose: finalize };
}

/** 一次性 execFile 失败落盘:失败是低频事件,每次失败单独一个带时间戳的文件。 */
export function dumpSidecarFailure(options: {
  module: string;
  title: string;
  detail: string;
}): string | null {
  const { module, title, detail } = options;
  if (!config) return null;
  const writer = createSidecarLogWriter(module, new Date());
  if (!writer) return null;
  writer.append(`[failure] ${title}`);
  for (const line of detail.split("\n")) if (line) writer.append(line);
  emitDiagnostics({
    category: "runtime",
    level: "error",
    message: `sidecar ${module} 失败已落盘: ${title}`,
    context: { module, logFile: writer.filePath },
  });
  return writer.filePath;
}
