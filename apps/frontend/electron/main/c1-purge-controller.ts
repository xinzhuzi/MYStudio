// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * C1③ leveldb 明文物理清除——boot 控制器(0924 立项,权威: .trellis/tasks/09-24-c1-leveldb-purge/design.md)。
 *
 * 一次性销毁重建 userData 会话数据下的 Local Storage leveldb 库,抹掉 v17→v18
 * 迁移前残留在 .log/.ldb 里的明文密钥字节。两拍协议:
 *
 *   拍0(pending):boot 字节扫描命中 "apiKeys" 签名且无 staged → 照常开窗;
 *     渲染入口首模块全量捕获 localStorage → purge:stage 落盘 → purge:relaunch 自动重启。
 *   拍1(quarantine):重启后扫描仍命中且 staged 在 → 主进程把 Local Storage 整目录
 *     改名隔离(绝不先删)→ Chromium 重建空库 → 渲染首模块 sendSync 取 staged、
 *     同步 setItem 全量回写 → purge:confirm → 主进程复扫干净后删 staged、
 *     quarantine 改名 purge-backup-<ts> 保留一个启动周期。
 *
 * 回滚状态机(R3/R4,绝不丢键):拍1 中途崩溃(改名后、确认前)= 下个 boot 见
 * staged+quarantine 并存 → fresh 库废弃删除、quarantine 改回 Local Storage、清
 * staged → 回到拍0 重新来;确认前旧库始终在 quarantine 原样保留。任何一步 fs
 * 失败 = 立即停止后续步骤回到不动数据的安全态(不阻塞启动,下次 boot 重试)。
 *
 * 签名字节编码说明:Chromium 的 localStorage leveldb 键值以 UTF-16LE 存储,
 * 因此字节匹配同时覆盖 UTF-8 与 UTF-16LE 两种编码(设计文档签名仍是 "apiKeys"
 * 字面串;新值是 {"v":2,"cipher":...} 密文,不含该串,其他 store 也不用这个词)。
 *
 * 纯函数(签名判定/状态转移/staged 解析)与副作用(fs 目录操作/IPC)分离,后者
 * 经 fileOps 注入可单测(先例:runtime/chromium-data-dir.ts)。
 */
import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";

/** v17 明文信封的特征子串(JSON 键名带引号);新 v2 密文形态不含此串。 */
export const C1_PURGE_SIGNATURE = '"apiKeys"';
const SIGNATURE_UTF8 = Buffer.from(C1_PURGE_SIGNATURE, "utf8");
const SIGNATURE_U16LE = Buffer.from(C1_PURGE_SIGNATURE, "utf16le");

export const C1_LOCAL_STORAGE_DIR_NAME = "Local Storage";
/** 拍1 隔离目录名(= Local Storage + 后缀;目录名含空格,拼接时整体作一段)。 */
export const C1_QUARANTINE_DIR_NAME = "Local Storage.purge-quarantine";
/** confirm 成功后 quarantine 的归宿;保留一个启动周期,下个 boot 清除。 */
export const C1_BACKUP_DIR_PREFIX = "Local Storage.purge-backup-";
/** 回滚时 fresh 库的废弃名(改名让位后立即删除)。 */
export const C1_ABANDONED_DIR_PREFIX = "Local Storage.purge-abandoned-";
/** 拍0 暂存文件(userData 根,c1-purge-staged.json);tmp+rename 原子写。 */
export const C1_PURGE_STAGED_FILE_NAME = "c1-purge-staged.json";
const STAGED_TMP_SUFFIX = ".tmp";

export type C1PurgeMode = "idle" | "pending" | "quarantine";

export const C1_PURGE_IPC_CHANNELS = {
  getMode: "purge:get-mode",
  getStaged: "purge:get-staged",
  stage: "purge:stage",
  confirm: "purge:confirm",
  relaunch: "purge:relaunch",
} as const;

export type C1PurgeFileOps = {
  existsSync: typeof fs.existsSync;
  readdirSync: typeof fs.readdirSync;
  readFileSync: typeof fs.readFileSync;
  renameSync: typeof fs.renameSync;
  mkdirSync: typeof fs.mkdirSync;
  writeFileSync: typeof fs.writeFileSync;
  rmSync: typeof fs.rmSync;
};

type C1PurgePaths = {
  localStorageDir: string;
  quarantineDir: string;
  stagedPath: string;
  logsDir: string;
};

// ---- 纯函数(单测锚点) ----

/** 字节级签名判定:同时匹配 UTF-8 与 UTF-16LE 编码的 "apiKeys" 串。 */
export function bufferContainsSignature(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  return buffer.includes(SIGNATURE_UTF8) || buffer.includes(SIGNATURE_U16LE);
}

/** boot 状态转移判定:由三个磁盘事实推出本轮要执行的动作。 */
export type C1BootDecision =
  /** 无残留,零动作。 */
  | { action: "idle" }
  /** 拍0:扫描命中且未暂存 → 照常开窗,渲染侧暂存+重启。 */
  | { action: "pending" }
  /** 拍1:扫描命中且 staged 在 → 主进程改名隔离,渲染侧回写+确认。 */
  | { action: "quarantine" }
  /** 拍1 中途崩溃恢复:fresh 库废弃、旧库复位、清 staged → 随后重新判定(回到拍0)。 */
  | { action: "rollback" }
  /** confirm 半途崩溃残留(quarantine 在、staged 已删):数据已回写完成,直接清备份。 */
  | { action: "drop-quarantine" }
  /** 孤儿 staged(理论不可达):扫描不命中且无 quarantine,删 staged 了结。 */
  | { action: "drop-staged" };

export function determineC1BootDecision(input: {
  signatureHit: boolean;
  stagedExists: boolean;
  quarantineExists: boolean;
}): C1BootDecision {
  const { signatureHit, stagedExists, quarantineExists } = input;
  if (quarantineExists && stagedExists) return { action: "rollback" };
  if (quarantineExists) return { action: "drop-quarantine" };
  if (stagedExists) return signatureHit ? { action: "quarantine" } : { action: "drop-staged" };
  return signatureHit ? { action: "pending" } : { action: "idle" };
}

export type C1StagedEntries = Array<[string, string]>;

/** staged 文件内容契约:{v:1, savedAt, entries:[[key,value],...]};任何畸形 → ok:false。 */
export function parseC1StagedPayload(raw: string): { ok: true; entries: C1StagedEntries } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not-object" };
  const payload = parsed as { v?: unknown; entries?: unknown };
  if (payload.v !== 1) return { ok: false, reason: "unsupported-version" };
  if (!Array.isArray(payload.entries)) return { ok: false, reason: "entries-not-array" };
  const entries: C1StagedEntries = [];
  for (const entry of payload.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
      return { ok: false, reason: "entry-shape" };
    }
    entries.push([entry[0], entry[1]]);
  }
  return { ok: true, entries };
}

export function buildC1StagedPayload(entries: C1StagedEntries): string {
  return JSON.stringify({ v: 1, savedAt: new Date().toISOString(), entries });
}

/** 渲染层 stage 通道入参校验(与 staged 文件 entries 同形)。 */
export function validateC1StagedEntries(input: unknown): C1StagedEntries | null {
  if (!Array.isArray(input)) return null;
  const entries: C1StagedEntries = [];
  for (const entry of input) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
      return null;
    }
    entries.push([entry[0], entry[1]]);
  }
  return entries;
}

// ---- 模块状态(boot 判定结果,IPC getMode 读这里) ----

let currentMode: C1PurgeMode = "idle";

export function getC1PurgeMode(): C1PurgeMode {
  return currentMode;
}

/** 测试/装配注入用;生产路径由 runC1PurgeBoot 内部维护。 */
export function setC1PurgeModeForTesting(mode: C1PurgeMode): void {
  currentMode = mode;
}

// ---- 副作用:目录扫描 / staged 原子写 / boot 状态机执行 ----

function resolveFileOps(fileOps?: Partial<C1PurgeFileOps>): C1PurgeFileOps {
  return {
    existsSync: fileOps?.existsSync ?? fs.existsSync,
    readdirSync: fileOps?.readdirSync ?? fs.readdirSync,
    readFileSync: fileOps?.readFileSync ?? fs.readFileSync,
    renameSync: fileOps?.renameSync ?? fs.renameSync,
    mkdirSync: fileOps?.mkdirSync ?? fs.mkdirSync,
    writeFileSync: fileOps?.writeFileSync ?? fs.writeFileSync,
    rmSync: fileOps?.rmSync ?? fs.rmSync,
  };
}

function resolvePaths(userDataPath: string, sessionDataPath: string): C1PurgePaths {
  return {
    localStorageDir: path.join(sessionDataPath, C1_LOCAL_STORAGE_DIR_NAME),
    quarantineDir: path.join(sessionDataPath, C1_QUARANTINE_DIR_NAME),
    stagedPath: path.join(userDataPath, C1_PURGE_STAGED_FILE_NAME),
    logsDir: path.join(userDataPath, "logs"),
  };
}

/**
 * 字节签名扫描:递归读 Local Storage 目录下全部文件字节找 "apiKeys"
 * (UTF-8/UTF-16LE)。真实 Chromium 布局是 `Local Storage/leveldb/*.log|*.ldb`
 * ——明文在 leveldb/ 子目录里,只扫一层顶层恒空(真机实证缺陷,修复回归见单测
 * 「真实 Chromium 布局」用例)。有界递归(Chromium 实际深度 2,上限防御异常
 * 布局/循环);目录名含协议标记(quarantine/backup/abandoned)的一律跳过防误扫。
 * 目录不存在(全新装机)= 空库不命中;任何读失败按该文件不命中处理并如实计数。
 */
export const C1_PURGE_SKIPPED_DIR_MARKERS = ["purge-quarantine", "purge-backup", "purge-abandoned"] as const;
const SCAN_MAX_DEPTH = 4;

function isSkippedScanDirName(name: string): boolean {
  return C1_PURGE_SKIPPED_DIR_MARKERS.some((marker) => name.includes(marker));
}

function scanDirectoryRecursive(
  dir: string,
  ops: C1PurgeFileOps,
  state: { scannedFiles: number; hitFiles: string[] },
  relativePrefix: string,
  depth: number,
): void {
  if (depth > SCAN_MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = ops.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 单目录读失败(锁/权限):不计命中,协议靠 staged/quarantine 状态自洽
  }
  for (const entry of entries) {
    if (isSkippedScanDirName(entry.name)) continue;
    if (entry.isDirectory()) {
      scanDirectoryRecursive(path.join(dir, entry.name), ops, state, `${relativePrefix}${entry.name}/`, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue; // 符号链接等:isFile() 为 false,天然无循环风险
    try {
      const bytes = ops.readFileSync(path.join(dir, entry.name));
      state.scannedFiles += 1;
      if (bufferContainsSignature(bytes)) state.hitFiles.push(`${relativePrefix}${entry.name}`);
    } catch {
      // 单文件读失败(锁/权限):不计命中
    }
  }
}

export function scanLocalStorageForSignature(
  localStorageDir: string,
  ops: C1PurgeFileOps,
): { hit: boolean; scannedFiles: number; hitFiles: string[] } {
  if (!ops.existsSync(localStorageDir)) return { hit: false, scannedFiles: 0, hitFiles: [] };
  const state = { scannedFiles: 0, hitFiles: [] as string[] };
  scanDirectoryRecursive(localStorageDir, ops, state, "", 0);
  return { hit: state.hitFiles.length > 0, scannedFiles: state.scannedFiles, hitFiles: state.hitFiles };
}

/** staged 原子写:先写 <staged>.tmp 再 rename 覆盖目标;任何失败返回 false 不留半成品。 */
export function writeC1StagedAtomically(
  stagedPath: string,
  entries: C1StagedEntries,
  ops: C1PurgeFileOps,
): boolean {
  const tmpPath = `${stagedPath}${STAGED_TMP_SUFFIX}`;
  try {
    ops.writeFileSync(tmpPath, buildC1StagedPayload(entries), "utf-8");
    ops.renameSync(tmpPath, stagedPath);
    return true;
  } catch {
    try {
      ops.rmSync(tmpPath, { force: true });
    } catch {
      // 尽力清理半成品
    }
    return false;
  }
}

/** 读取并解析 staged 文件;getStaged 同步通道与 boot 判定共用。 */
export function readC1Staged(
  stagedPath: string,
  ops: C1PurgeFileOps,
): { ok: true; entries: C1StagedEntries } | { ok: false; reason: string } {
  if (!ops.existsSync(stagedPath)) return { ok: false, reason: "not-found" };
  try {
    return parseC1StagedPayload(ops.readFileSync(stagedPath, "utf-8"));
  } catch {
    return { ok: false, reason: "read-failed" };
  }
}

/** R6 真实档案保护:拍1 隔离前把 staged+扫描报告落 userData/logs/(quarantine 本身即整目录备份)。 */
function writePurgeReport(
  paths: C1PurgePaths,
  ops: C1PurgeFileOps,
  report: Record<string, unknown>,
): void {
  try {
    ops.mkdirSync(paths.logsDir, { recursive: true });
    ops.writeFileSync(
      path.join(paths.logsDir, `c1-purge-report-${Date.now()}.json`),
      JSON.stringify({ timestamp: new Date().toISOString(), ...report }, null, 2),
      "utf-8",
    );
  } catch {
    // 报告尽力而为,失败不拦协议
  }
}

/** 清掉上一轮成功的 backup / 上上轮回滚的 abandoned 遗留(= 保留一个启动周期)。 */
function cleanupLegacyDirs(sessionDataPath: string, ops: C1PurgeFileOps): void {
  let topLevel: string[];
  try {
    topLevel = ops.readdirSync(sessionDataPath);
  } catch {
    return;
  }
  for (const name of topLevel) {
    if (name.startsWith(C1_BACKUP_DIR_PREFIX) || name.startsWith(C1_ABANDONED_DIR_PREFIX)) {
      try {
        ops.rmSync(path.join(sessionDataPath, name), { recursive: true, force: true });
      } catch {
        // 尽力清理;遗留目录不影响协议正确性
      }
    }
  }
}

/**
 * boot 主流程(必须在首个 BrowserWindow 创建前调用,窗口一开 Chromium 就锁库)。
 * 返回本轮模式:pending=照常开窗走拍0;quarantine=已隔离,渲染侧回写;idle=零动作。
 * 任何 fs 异常都吞掉并退化为 idle——绝不因清除协议阻塞启动,数据原样留给下次重试。
 */
export function runC1PurgeBoot(options: {
  userDataPath: string;
  sessionDataPath: string;
  fileOps?: Partial<C1PurgeFileOps>;
}): C1PurgeMode {
  const ops = resolveFileOps(options.fileOps);
  const paths = resolvePaths(options.userDataPath, options.sessionDataPath);
  try {
    cleanupLegacyDirs(options.sessionDataPath, ops);

    const stagedExists = ops.existsSync(paths.stagedPath);
    const quarantineExists = ops.existsSync(paths.quarantineDir);
    const scan = scanLocalStorageForSignature(paths.localStorageDir, ops);
    let decision = determineC1BootDecision({
      signatureHit: scan.hit,
      stagedExists,
      quarantineExists,
    });

    // 回滚:fresh 库废弃 → 旧库复位 → 清 staged → 重新判定(此时必回拍0 pending)
    if (decision.action === "rollback") {
      if (ops.existsSync(paths.localStorageDir)) {
        const abandonedDir = `${paths.localStorageDir}.purge-abandoned-${Date.now()}`;
        ops.renameSync(paths.localStorageDir, abandonedDir);
        ops.rmSync(abandonedDir, { recursive: true, force: true });
      }
      ops.renameSync(paths.quarantineDir, paths.localStorageDir);
      try {
        ops.rmSync(paths.stagedPath, { force: true });
      } catch {
        // staged 删不掉不影响数据安全;下个 boot 会再次走回滚(幂等)
      }
      writePurgeReport(paths, ops, { action: "rollback", restoredFrom: paths.quarantineDir });
      const rescan = scanLocalStorageForSignature(paths.localStorageDir, ops);
      decision = determineC1BootDecision({
        signatureHit: rescan.hit,
        stagedExists: false,
        quarantineExists: false,
      });
    } else if (decision.action === "drop-quarantine") {
      // confirm 半途崩溃:数据已回写进 fresh 库,备份直接清
      ops.rmSync(paths.quarantineDir, { recursive: true, force: true });
      writePurgeReport(paths, ops, { action: "drop-quarantine" });
      decision = { action: "idle" };
    } else if (decision.action === "drop-staged") {
      try {
        ops.rmSync(paths.stagedPath, { force: true });
      } catch {
        // 同上,幂等重试
      }
      decision = { action: "idle" };
    }

    if (decision.action === "quarantine") {
      // 拍1:先写报告(R6),再整目录改名隔离(不是删除);Chromium 随后重建空库
      const staged = readC1Staged(paths.stagedPath, ops);
      writePurgeReport(paths, ops, {
        action: "quarantine",
        hitFiles: scan.hitFiles,
        scannedFiles: scan.scannedFiles,
        stagedKeys: staged.ok ? staged.entries.length : null,
        quarantineDir: paths.quarantineDir,
      });
      ops.renameSync(paths.localStorageDir, paths.quarantineDir);
      currentMode = "quarantine";
      return currentMode;
    }
    if (decision.action === "pending") {
      currentMode = "pending";
      return currentMode;
    }
    currentMode = "idle";
    return currentMode;
  } catch (error) {
    // 隔离/回滚任一步失败:立即停在不动数据的安全态(旧库或 quarantine 原样),
    // 下个 boot 依据 staged/quarantine 磁盘事实重新走状态机。
    console.warn(
      "[c1-purge] boot 清除协议未完成,已安全停在当前态(下次启动重试):",
      error instanceof Error ? error.message : error,
    );
    currentMode = "idle";
    return currentMode;
  }
}

/**
 * confirm 收尾:复扫 fresh 库(渲染侧已回写,密文不含签名)→ 干净才动数据:
 * 先 quarantine 改名 backup(旧库尽早让位,避免与回滚分支混淆),再删 staged。
 * 两步之间崩溃均有自愈路径(backup+staged 并存 → 下轮 legacy 清理/孤儿 staged 分支)。
 */
export function confirmC1Purge(options: {
  userDataPath: string;
  sessionDataPath: string;
  fileOps?: Partial<C1PurgeFileOps>;
}): { ok: true } | { ok: false; reason: string } {
  const ops = resolveFileOps(options.fileOps);
  const paths = resolvePaths(options.userDataPath, options.sessionDataPath);
  try {
    const rescan = scanLocalStorageForSignature(paths.localStorageDir, ops);
    if (rescan.hit) {
      // 回写内容本身含签名(理论不可达):拒绝收尾,staged/quarantine 原样保留,
      // 下个 boot 走回滚恢复旧库重来——绝不丢数据。
      return { ok: false, reason: "signature-still-present" };
    }
    if (ops.existsSync(paths.quarantineDir)) {
      const backupDir = `${paths.localStorageDir}.purge-backup-${Date.now()}`;
      ops.renameSync(paths.quarantineDir, backupDir);
      writePurgeReport(paths, ops, { action: "confirmed", backupDir, rescannedFiles: rescan.scannedFiles });
    }
    try {
      ops.rmSync(paths.stagedPath, { force: true });
    } catch {
      // staged 删不掉:下个 boot 走 drop-staged/orphan 分支自愈,数据已安全
    }
    currentMode = "idle";
    return { ok: true };
  } catch (error) {
    console.warn(
      "[c1-purge] confirm 收尾失败(数据已回写,遗留目录下个启动自清):",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, reason: "error" };
  }
}

// ---- IPC(风格先例:ipc/app/secure-storage-ipc.ts——显式结果对象,绝不向渲染层抛错) ----

export type C1PurgeGetModeReply = { mode: C1PurgeMode };
export type C1PurgeGetStagedReply =
  | { ok: true; entries: C1StagedEntries }
  | { ok: false; reason: string };
export type C1PurgeSimpleReply = { ok: true } | { ok: false; reason: string };

/**
 * 拍0 延迟成熟退出窗口(真机实证,3/3 复现):启动早期 ~1s 内 relaunch 退出会把
 * 主进程硬阻塞在原生代码——SIGTERM 无效,连 1500ms process.exit 兜底定时器都
 * 跑不到(事件循环已停);对照组:应用完全启动(~3 分钟)后触发 relaunch = 干净
 * 退出。故拍0 的 relaunch 不立即执行,延迟此窗口后再 app.relaunch()+exit,
 * 走已被实证干净的成熟退出路径。渲染侧等待覆盖层(「正在完成安全迁移,应用即将
 * 自动重启…」)恰好盖住这 5 秒。打包版渲染层秒开、真实用户首清必命中本窗口。
 */
export const C1_RELAUNCH_DELAY_MS = 5000;

let scheduledRelaunchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 取消已调度的延迟 relaunch(用户在延迟窗口内手动关窗/退出时由 before-quit
 * 调用)。staged 原样保留、localStorge 数据未动——下次启动状态机见「扫描命中 +
 * staged 在」自然走拍1 回写,两拍协议支持中断续走。返回是否真的取消了一次调度。
 */
export function cancelScheduledC1Relaunch(): boolean {
  if (scheduledRelaunchTimer === null) return false;
  clearTimeout(scheduledRelaunchTimer);
  scheduledRelaunchTimer = null;
  return true;
}

/**
 * 注册五通道。getMode/getStaged 用 ipcMain.on + event.returnValue 同步应答
 * (渲染侧 sendSync,拍1 回写必须先于一切 store 模块求值);stage/confirm/relaunch
 * 用 handle。relaunch(app.relaunch+exit)经注入避免测试触发真进程退出。
 */
export function registerC1PurgeIpcHandlers(options: {
  userDataPath: () => string;
  sessionDataPath: () => string;
  relaunch: () => void;
  fileOps?: Partial<C1PurgeFileOps>;
}): void {
  const ops = resolveFileOps(options.fileOps);

  // sendSync 同步应答:渲染入口首模块在一切异步之前取模式/取暂存
  ipcMain.on(C1_PURGE_IPC_CHANNELS.getMode, (event) => {
    const reply: C1PurgeGetModeReply = { mode: getC1PurgeMode() };
    event.returnValue = reply;
  });

  ipcMain.on(C1_PURGE_IPC_CHANNELS.getStaged, (event) => {
    let reply: C1PurgeGetStagedReply;
    try {
      reply = readC1Staged(path.join(options.userDataPath(), C1_PURGE_STAGED_FILE_NAME), ops);
    } catch {
      reply = { ok: false, reason: "error" };
    }
    event.returnValue = reply;
  });

  ipcMain.handle(C1_PURGE_IPC_CHANNELS.stage, (_event, entries: unknown): C1PurgeSimpleReply => {
    const validated = validateC1StagedEntries(entries);
    if (!validated) return { ok: false, reason: "invalid-entries" };
    const stagedPath = path.join(options.userDataPath(), C1_PURGE_STAGED_FILE_NAME);
    if (!writeC1StagedAtomically(stagedPath, validated, ops)) return { ok: false, reason: "write-failed" };
    return { ok: true };
  });

  ipcMain.handle(C1_PURGE_IPC_CHANNELS.confirm, (): C1PurgeSimpleReply => {
    return confirmC1Purge({
      userDataPath: options.userDataPath(),
      sessionDataPath: options.sessionDataPath(),
      fileOps: options.fileOps,
    });
  });

  ipcMain.handle(C1_PURGE_IPC_CHANNELS.relaunch, (): C1PurgeSimpleReply => {
    if (scheduledRelaunchTimer) return { ok: true }; // 已在延迟窗口内,幂等
    try {
      scheduledRelaunchTimer = setTimeout(() => {
        scheduledRelaunchTimer = null;
        try {
          options.relaunch();
        } catch {
          // 成熟退出本体异常:app.exit 正常应已收尾;此处置空防 timer 抛错外泄
        }
      }, C1_RELAUNCH_DELAY_MS);
      // 不 unref:这个定时器是协议必经步骤,必须活到触发(触发后 app.exit 强杀)
      return { ok: true };
    } catch {
      return { ok: false, reason: "error" };
    }
  });
}
