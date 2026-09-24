// @vitest-environment node
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * C1③ 物理清除控制器单测(design 测试矩阵:签名判定/状态机全转移/staged 原子写/
 * boot 集成/回滚/confirm 收尾/IPC 通道)。
 * 只 mock electron 系统调用本身(ipcMain,先例 secure-storage-ipc.test.ts)与注入
 * 内存 fileOps(先例 chromium-data-dir.ts 的 fileOps 注入);被测的扫描/状态机/
 * 目录操作逻辑零 mock。
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleChannels, onChannels } = vi.hoisted(() => ({
  handleChannels: new Map<string, (...args: unknown[]) => unknown>(),
  onChannels: new Map<string, (event: { returnValue?: unknown }) => void>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handleChannels.set(channel, handler);
    }),
    on: vi.fn((channel: string, listener: (event: { returnValue?: unknown }) => void) => {
      onChannels.set(channel, listener);
    }),
  },
}));

import {
  C1_ABANDONED_DIR_PREFIX,
  C1_BACKUP_DIR_PREFIX,
  C1_LOCAL_STORAGE_DIR_NAME,
  C1_PURGE_IPC_CHANNELS,
  C1_PURGE_SIGNATURE,
  C1_PURGE_STAGED_FILE_NAME,
  C1_QUARANTINE_DIR_NAME,
  C1_RELAUNCH_DELAY_MS,
  bufferContainsSignature,
  cancelScheduledC1Relaunch,
  confirmC1Purge,
  determineC1BootDecision,
  parseC1StagedPayload,
  readC1Staged,
  registerC1PurgeIpcHandlers,
  runC1PurgeBoot,
  setC1PurgeModeForTesting,
  validateC1StagedEntries,
  writeC1StagedAtomically,
  type C1PurgeFileOps,
} from "./c1-purge-controller";

// ---- 内存文件系统(注入 fileOps;被测逻辑零 mock) ----

interface MemoryFs {
  ops: C1PurgeFileOps;
  files: Map<string, Buffer>;
  dirs: Set<string>;
  calls: { writeFileSync: string[]; renameSync: Array<[string, string]>; rmSync: string[] };
}

function createMemoryFs(initial: { files?: Record<string, string | Buffer>; dirs?: string[] } = {}): MemoryFs {
  const files = new Map<string, Buffer>(
    Object.entries(initial.files ?? {}).map(([filePath, content]) => [
      filePath,
      Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, "utf-8"),
    ]),
  );
  const dirs = new Set<string>(initial.dirs ?? []);
  const calls = { writeFileSync: [] as string[], renameSync: [] as Array<[string, string]>, rmSync: [] as string[] };
  const ensureParent = (filePath: string): void => {
    const parent = path.dirname(filePath);
    if (parent && parent !== "." && parent !== "/") dirs.add(parent);
  };
  const ops = {
    existsSync: (target: fs.PathLike) => files.has(String(target)) || dirs.has(String(target)),
    readdirSync: ((target: fs.PathLike, options?: { withFileTypes?: boolean }) => {
      const prefix = `${String(target)}${String(target).endsWith("/") ? "" : "/"}`;
      const names = new Set<string>();
      for (const key of files.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
      for (const dir of dirs) if (dir.startsWith(prefix)) names.add(dir.slice(prefix.length).split("/")[0]);
      const list = [...names];
      if (options?.withFileTypes) {
        return list.map((name) => ({
          name,
          isFile: () => files.has(prefix + name),
          isDirectory: () => dirs.has(prefix + name),
        }));
      }
      return list;
    }) as typeof fs.readdirSync,
    readFileSync: ((target: fs.PathLike, encoding?: string) => {
      const bytes = files.get(String(target));
      if (!bytes) throw new Error(`ENOENT: ${String(target)}`);
      return encoding === "utf-8" ? bytes.toString("utf-8") : Buffer.from(bytes);
    }) as typeof fs.readFileSync,
    renameSync: ((from: fs.PathLike, to: fs.PathLike) => {
      calls.renameSync.push([String(from), String(to)]);
      if (files.has(String(from))) {
        files.set(String(to), files.get(String(from)) as Buffer);
        files.delete(String(from));
      } else if (dirs.has(String(from))) {
        const prefix = `${String(from)}/`;
        for (const key of [...files.keys()]) {
          if (key.startsWith(prefix)) {
            files.set(`${String(to)}/${key.slice(prefix.length)}`, files.get(key) as Buffer);
            files.delete(key);
          }
        }
        dirs.delete(String(from));
        dirs.add(String(to));
      } else {
        throw new Error(`ENOENT: ${String(from)}`);
      }
    }) as typeof fs.renameSync,
    mkdirSync: ((target: fs.PathLike) => {
      dirs.add(String(target));
    }) as typeof fs.mkdirSync,
    writeFileSync: ((target: fs.PathLike, data: string | NodeJS.ArrayBufferView) => {
      calls.writeFileSync.push(String(target));
      ensureParent(String(target));
      const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data as Uint8Array);
      files.set(String(target), buffer);
    }) as typeof fs.writeFileSync,
    rmSync: ((target: fs.PathLike) => {
      calls.rmSync.push(String(target));
      files.delete(String(target));
      const prefix = `${String(target)}/`;
      for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
      dirs.delete(String(target));
      for (const dir of [...dirs]) if (dir.startsWith(prefix)) dirs.delete(dir);
    }) as typeof fs.rmSync,
  } as C1PurgeFileOps;
  return { ops, files, dirs, calls };
}

const USER_DATA = "/app-user-data";
const SESSION_DATA = "/app-user-data/Chromium";
const LS_DIR = path.join(SESSION_DATA, C1_LOCAL_STORAGE_DIR_NAME);
const QUARANTINE_DIR = path.join(SESSION_DATA, C1_QUARANTINE_DIR_NAME);
const STAGED_PATH = path.join(USER_DATA, C1_PURGE_STAGED_FILE_NAME);
/** 真实 Chromium 布局:localStorage 数据文件住在 Local Storage/leveldb/ 子目录。 */
const LEVELDB_DIR = path.join(LS_DIR, "leveldb");
const QUARANTINE_LEVELDB_DIR = path.join(QUARANTINE_DIR, "leveldb");

const PLAINTEXT_ENVELOPE = JSON.stringify({
  state: { apiKeys: { "sk-明文密钥": "plaintext-secret" } },
  version: 17,
});
const CIPHER_ENVELOPE = JSON.stringify({ v: 2, cipher: "ZmFrZS1jaXBoZXI=" });

/** 模拟 zustand persist 旧明文信封在 leveldb 里的 UTF-16LE 字节形态。 */
const PLAINTEXT_LOG_BYTES = () => Buffer.from(PLAINTEXT_ENVELOPE, "utf16le");
const CIPHER_LOG_BYTES = () => Buffer.from(CIPHER_ENVELOPE, "utf16le");

const STAGED_JSON = JSON.stringify({
  v: 1,
  savedAt: "2026-09-24T00:00:00.000Z",
  entries: [
    ["opencut-api-config", CIPHER_ENVELOPE],
    ["ui-preferences", '{"theme":"dark"}'],
  ],
});

function flushPendingCapture(): MemoryFs {
  return createMemoryFs({
    files: {
      [path.join(LEVELDB_DIR, "000003.log")]: PLAINTEXT_LOG_BYTES(),
      [path.join(LEVELDB_DIR, "LOCK")]: "1",
    },
    dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR],
  });
}

beforeEach(() => {
  handleChannels.clear();
  onChannels.clear();
  setC1PurgeModeForTesting("idle");
  cancelScheduledC1Relaunch(); // 清上一用例可能遗留的延迟调度,防跨用例定时器泄漏
});

// ---- 纯函数:字节签名判定 ----

describe("bufferContainsSignature", () => {
  it("命中 UTF-16LE 编码的旧明文(Chromium localStorage leveldb 实际形态)", () => {
    expect(bufferContainsSignature(Buffer.from(PLAINTEXT_ENVELOPE, "utf16le"))).toBe(true);
  });

  it("命中 UTF-8 编码的明文字节", () => {
    expect(bufferContainsSignature(Buffer.from(`xx ${C1_PURGE_SIGNATURE} yy`))).toBe(true);
  });

  it("不命中 v2 密文形态与其他 store 数据", () => {
    expect(bufferContainsSignature(Buffer.from(CIPHER_ENVELOPE, "utf16le"))).toBe(false);
    expect(bufferContainsSignature(Buffer.from('{"state":{"theme":"dark"}}', "utf16le"))).toBe(false);
  });

  it("空 buffer 不命中", () => {
    expect(bufferContainsSignature(Buffer.alloc(0))).toBe(false);
  });
});

// ---- 纯函数:状态机全转移 ----

describe("determineC1BootDecision", () => {
  it.each([
    [{ signatureHit: false, stagedExists: false, quarantineExists: false }, "idle"],
    [{ signatureHit: true, stagedExists: false, quarantineExists: false }, "pending"],
    [{ signatureHit: true, stagedExists: true, quarantineExists: false }, "quarantine"],
    [{ signatureHit: true, stagedExists: true, quarantineExists: true }, "rollback"],
    [{ signatureHit: false, stagedExists: false, quarantineExists: true }, "drop-quarantine"],
    [{ signatureHit: false, stagedExists: true, quarantineExists: false }, "drop-staged"],
  ] as Array<[Parameters<typeof determineC1BootDecision>[0], string]>)("%# %o → %s", (input, expected) => {
    expect(determineC1BootDecision(input)).toEqual({ action: expected });
  });
});

// ---- 纯函数:staged 解析与入参校验 ----

describe("parseC1StagedPayload / validateC1StagedEntries", () => {
  it("合法 payload 往返:entries 键值原样还原", () => {
    const reply = parseC1StagedPayload(STAGED_JSON);
    expect(reply).toEqual({
      ok: true,
      entries: [
        ["opencut-api-config", CIPHER_ENVELOPE],
        ["ui-preferences", '{"theme":"dark"}'],
      ],
    });
  });

  it.each([
    ["not-json", "not-json"],
    ["null", "not-object"],
    ['{"v":2,"entries":[]}', "unsupported-version"],
    ['{"v":1}', "entries-not-array"],
    ['{"v":1,"entries":["a"]}', "entry-shape"],
    ['{"v":1,"entries":[["k", 1]]}', "entry-shape"],
    ['{"v":1,"entries":[["k","v","extra"]]}', "entry-shape"],
  ])("畸形 payload %s → %s", (raw, reason) => {
    expect(parseC1StagedPayload(raw)).toEqual({ ok: false, reason });
  });

  it("validateC1StagedEntries:非数组/畸形项拒绝,合法表原样通过", () => {
    expect(validateC1StagedEntries("nope")).toBeNull();
    expect(validateC1StagedEntries([["a", "1"], ["b"]])).toBeNull();
    expect(validateC1StagedEntries([["a", "1"]])).toEqual([["a", "1"]]);
  });
});

// ---- staged 原子写 ----

describe("writeC1StagedAtomically", () => {
  it("先写 .tmp 再 rename 到目标(任何时刻读 staged 都只见完整文件)", () => {
    const memory = createMemoryFs();
    expect(writeC1StagedAtomically(STAGED_PATH, [["k", "v"]], memory.ops)).toBe(true);
    expect(memory.calls.writeFileSync).toEqual([`${STAGED_PATH}.tmp`]);
    expect(memory.calls.renameSync).toEqual([[`${STAGED_PATH}.tmp`, STAGED_PATH]]);
    expect(readC1Staged(STAGED_PATH, memory.ops)).toEqual({ ok: true, entries: [["k", "v"]] });
  });

  it("写 tmp 失败:不留半成品、不 rename,返回 false", () => {
    const memory = createMemoryFs();
    const failing = { ...memory.ops, writeFileSync: () => { throw new Error("disk full"); } };
    expect(writeC1StagedAtomically(STAGED_PATH, [["k", "v"]], failing)).toBe(false);
    expect(memory.calls.renameSync).toEqual([]);
    expect(memory.ops.existsSync(STAGED_PATH)).toBe(false);
  });
});

// ---- boot 集成(两拍协议 + 回滚状态机) ----

describe("runC1PurgeBoot", () => {
  it("全新装机(Local Storage 目录不存在)= 空库,idle 零动作", () => {
    const memory = createMemoryFs({ dirs: [USER_DATA, SESSION_DATA] });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("idle");
    expect(memory.calls.renameSync).toEqual([]);
  });

  it("干净库(密文,无签名)零动作 idle", () => {
    const memory = createMemoryFs({
      files: { [path.join(LEVELDB_DIR, "000003.log")]: CIPHER_LOG_BYTES() },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR],
    });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("idle");
  });

  it("真实 Chromium 布局回归(真机缺陷:明文在 leveldb/ 子目录,顶层无文件)→ 扫描命中触发拍0", () => {
    // 真机实证:旧实现只扫一层顶层且跳过目录,Local Storage/leveldb/000003.log
    // 里的明文永远扫不到,getMode 恒 idle——协议永不触发。夹具必须与现场同构。
    const memory = createMemoryFs({
      files: { [path.join(LEVELDB_DIR, "000003.log")]: PLAINTEXT_LOG_BYTES() },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR],
    });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("pending");
  });

  it("扫描跳过协议自身的 quarantine/backup/abandoned 目录,诱饵不触发协议", () => {
    const decoyQuarantine = path.join(LS_DIR, "nested-purge-quarantine");
    const decoyBackup = path.join(LS_DIR, "nested-purge-backup-1");
    const memory = createMemoryFs({
      files: {
        [path.join(LEVELDB_DIR, "000005.log")]: CIPHER_LOG_BYTES(),
        [path.join(decoyQuarantine, "000003.log")]: PLAINTEXT_LOG_BYTES(),
        [path.join(decoyBackup, "000003.log")]: PLAINTEXT_LOG_BYTES(),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR, decoyQuarantine, decoyBackup],
    });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("idle");
  });

  it("拍0:旧库命中明文且无 staged → pending,照常开窗(不动目录)", () => {
    const memory = flushPendingCapture();
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("pending");
    expect(memory.calls.renameSync).toEqual([]);
    expect(memory.ops.existsSync(LS_DIR)).toBe(true);
  });

  it("拍1:命中 + staged 在 → 改名隔离 Local Storage,写 R6 报告,mode=quarantine", () => {
    const memory = flushPendingCapture();
    memory.files.set(STAGED_PATH, Buffer.from(STAGED_JSON, "utf-8"));
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("quarantine");
    expect(memory.ops.existsSync(LS_DIR)).toBe(false);
    expect(memory.ops.existsSync(QUARANTINE_DIR)).toBe(true);
    expect(readC1Staged(STAGED_PATH, memory.ops)).toEqual({ ok: true, entries: JSON.parse(STAGED_JSON).entries });
    const logs = [...memory.files.keys()].filter((key) => key.startsWith(path.join(USER_DATA, "logs", "c1-purge-report-")));
    expect(logs).toHaveLength(1);
    expect(JSON.parse((memory.files.get(logs[0]) as Buffer).toString("utf-8"))).toMatchObject({
      action: "quarantine",
      stagedKeys: 2,
      hitFiles: ["leveldb/000003.log"],
    });
  });

  it("回滚:staged+quarantine 并存(拍1 中途崩溃)→ 旧库复位、fresh 库废弃、清 staged,回到拍0 pending", () => {
    const memory = createMemoryFs({
      files: {
        // fresh 库(回写一半,含密文不含明文)
        [path.join(LEVELDB_DIR, "000005.log")]: CIPHER_LOG_BYTES(),
        // quarantine = 旧库(含明文)
        [path.join(QUARANTINE_LEVELDB_DIR, "000003.log")]: PLAINTEXT_LOG_BYTES(),
        [STAGED_PATH]: Buffer.from(STAGED_JSON, "utf-8"),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR, QUARANTINE_DIR, QUARANTINE_LEVELDB_DIR],
    });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("pending");
    // fresh 库已被改名 abandoned 后删除;旧库从 quarantine 复位回 Local Storage
    expect(memory.ops.existsSync(QUARANTINE_DIR)).toBe(false);
    expect(memory.ops.existsSync(LS_DIR)).toBe(true);
    expect(memory.ops.existsSync(path.join(LEVELDB_DIR, "000003.log"))).toBe(true);
    expect(memory.ops.existsSync(STAGED_PATH)).toBe(false);
    expect([...memory.dirs].some((dir) => dir.includes(C1_ABANDONED_DIR_PREFIX))).toBe(false);
  });

  it("drop-quarantine:confirm 半途崩溃残留(无 staged)→ 直接清备份,idle", () => {
    const memory = createMemoryFs({
      files: {
        [path.join(LEVELDB_DIR, "000005.log")]: CIPHER_LOG_BYTES(),
        [path.join(QUARANTINE_LEVELDB_DIR, "000003.log")]: PLAINTEXT_LOG_BYTES(),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR, QUARANTINE_DIR, QUARANTINE_LEVELDB_DIR],
    });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("idle");
    expect(memory.ops.existsSync(QUARANTINE_DIR)).toBe(false);
    expect(memory.ops.existsSync(LS_DIR)).toBe(true);
  });

  it("drop-staged:孤儿 staged(无 quarantine、扫描不命中)→ 删 staged 了结", () => {
    const memory = createMemoryFs({
      files: {
        [path.join(LEVELDB_DIR, "000005.log")]: CIPHER_LOG_BYTES(),
        [STAGED_PATH]: Buffer.from(STAGED_JSON, "utf-8"),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR],
    });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("idle");
    expect(memory.ops.existsSync(STAGED_PATH)).toBe(false);
  });

  it("上轮成功遗留的 backup 目录在 boot 时清除(= 保留一个启动周期)", () => {
    const backupDir = path.join(SESSION_DATA, `${C1_BACKUP_DIR_PREFIX}1700000000000`);
    const backupLevelbDir = path.join(backupDir, "leveldb");
    const memory = createMemoryFs({
      files: {
        [path.join(backupLevelbDir, "000003.log")]: PLAINTEXT_LOG_BYTES(),
        [path.join(LEVELDB_DIR, "000005.log")]: CIPHER_LOG_BYTES(),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR, backupDir, backupLevelbDir],
    });
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops })).toBe("idle");
    expect(memory.ops.existsSync(backupDir)).toBe(false);
  });

  it("改名隔离失败(目录被锁)→ 吞错退化为 idle,绝不阻塞启动、数据原样", () => {
    const memory = flushPendingCapture();
    memory.files.set(STAGED_PATH, Buffer.from(STAGED_JSON, "utf-8"));
    const failing = { ...memory.ops, renameSync: () => { throw new Error("EBUSY"); } };
    expect(runC1PurgeBoot({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: failing })).toBe("idle");
    expect(memory.ops.existsSync(LS_DIR)).toBe(true);
  });
});

// ---- confirm 收尾 ----

describe("confirmC1Purge", () => {
  it("复扫干净(leveldb/ 子目录真实层级,不再空扫)→ quarantine 改名 backup、删 staged、mode 复位 idle", () => {
    const memory = createMemoryFs({
      files: {
        [path.join(LEVELDB_DIR, "000005.log")]: CIPHER_LOG_BYTES(),
        [path.join(QUARANTINE_LEVELDB_DIR, "000003.log")]: PLAINTEXT_LOG_BYTES(),
        [STAGED_PATH]: Buffer.from(STAGED_JSON, "utf-8"),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR, QUARANTINE_DIR, QUARANTINE_LEVELDB_DIR],
    });
    expect(
      confirmC1Purge({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops }),
    ).toEqual({ ok: true });
    expect(memory.ops.existsSync(QUARANTINE_DIR)).toBe(false);
    expect([...memory.dirs].some((dir) => dir.includes(C1_BACKUP_DIR_PREFIX))).toBe(true);
    expect(memory.ops.existsSync(STAGED_PATH)).toBe(false);
    // 钉死复扫不再恒空(真机缺陷回归:旧实现 rescannedFiles:0)
    const logs = [...memory.files.keys()].filter((key) => key.startsWith(path.join(USER_DATA, "logs", "c1-purge-report-")));
    expect(logs).toHaveLength(1);
    expect(JSON.parse((memory.files.get(logs[0]) as Buffer).toString("utf-8"))).toMatchObject({
      action: "confirmed",
      rescannedFiles: 1,
    });
  });

  it("复扫仍命中签名(回写内容含明文,理论不可达)→ 拒绝收尾,staged/quarantine 原样保留", () => {
    const memory = createMemoryFs({
      files: {
        [path.join(LEVELDB_DIR, "000005.log")]: PLAINTEXT_LOG_BYTES(),
        [path.join(QUARANTINE_LEVELDB_DIR, "000003.log")]: PLAINTEXT_LOG_BYTES(),
        [STAGED_PATH]: Buffer.from(STAGED_JSON, "utf-8"),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR, QUARANTINE_DIR, QUARANTINE_LEVELDB_DIR],
    });
    expect(
      confirmC1Purge({ userDataPath: USER_DATA, sessionDataPath: SESSION_DATA, fileOps: memory.ops }),
    ).toEqual({ ok: false, reason: "signature-still-present" });
    expect(memory.ops.existsSync(QUARANTINE_DIR)).toBe(true);
    expect(memory.ops.existsSync(STAGED_PATH)).toBe(true);
  });
});

// ---- IPC 五通道 ----

describe("registerC1PurgeIpcHandlers", () => {
  function register(memory: MemoryFs, relaunch = vi.fn()) {
    registerC1PurgeIpcHandlers({
      userDataPath: () => USER_DATA,
      sessionDataPath: () => SESSION_DATA,
      relaunch,
      fileOps: memory.ops,
    });
    return relaunch;
  }

  function syncCall(channel: string): unknown {
    const listener = onChannels.get(channel);
    if (!listener) throw new Error(`channel not registered: ${channel}`);
    const event: { returnValue?: unknown } = {};
    listener(event);
    return event.returnValue;
  }

  function invoke(channel: string, ...args: unknown[]): unknown {
    const handler = handleChannels.get(channel);
    if (!handler) throw new Error(`channel not registered: ${channel}`);
    return handler({} as never, ...args);
  }

  it("注册恰好五通道(handle 三 + on 二),通道名与常量一致", () => {
    register(createMemoryFs());
    expect([...handleChannels.keys()].sort()).toEqual([
      C1_PURGE_IPC_CHANNELS.confirm,
      C1_PURGE_IPC_CHANNELS.relaunch,
      C1_PURGE_IPC_CHANNELS.stage,
    ]);
    expect([...onChannels.keys()].sort()).toEqual([C1_PURGE_IPC_CHANNELS.getMode, C1_PURGE_IPC_CHANNELS.getStaged]);
    expect(C1_PURGE_IPC_CHANNELS.getMode).toBe("purge:get-mode");
  });

  it("get-mode sendSync 同步应答当前模式", () => {
    register(createMemoryFs());
    setC1PurgeModeForTesting("quarantine");
    expect(syncCall(C1_PURGE_IPC_CHANNELS.getMode)).toEqual({ mode: "quarantine" });
  });

  it("get-staged:staged 在盘 → 同步返回全量键值;不在盘 → {ok:false}", () => {
    const memory = createMemoryFs();
    register(memory);
    expect(syncCall(C1_PURGE_IPC_CHANNELS.getStaged)).toEqual({ ok: false, reason: "not-found" });
    writeC1StagedAtomically(STAGED_PATH, [["a", "1"], ["b", "2"]], memory.ops);
    expect(syncCall(C1_PURGE_IPC_CHANNELS.getStaged)).toEqual({ ok: true, entries: [["a", "1"], ["b", "2"]] });
  });

  it("stage:合法 entries 原子落盘可往返;畸形入参拒绝不落盘", () => {
    const memory = createMemoryFs();
    register(memory);
    expect(invoke(C1_PURGE_IPC_CHANNELS.stage, [["k", "v"]])).toEqual({ ok: true });
    expect(readC1Staged(STAGED_PATH, memory.ops)).toEqual({ ok: true, entries: [["k", "v"]] });
    expect(invoke(C1_PURGE_IPC_CHANNELS.stage, "not-entries")).toEqual({ ok: false, reason: "invalid-entries" });
  });

  it("relaunch:立即返回已调度,延迟成熟退出窗口后才执行(真机缺陷回归:启动早期退出硬阻塞)", () => {
    vi.useFakeTimers();
    try {
      const relaunch = register(createMemoryFs());
      expect(invoke(C1_PURGE_IPC_CHANNELS.relaunch)).toEqual({ ok: true });
      // 不立即退出:避开启动早期 ~1s 的原生代码硬阻塞窗口(SIGTERM/兜底定时器均无效)
      expect(relaunch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(C1_RELAUNCH_DELAY_MS - 1);
      expect(relaunch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(relaunch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("relaunch:延迟窗口内重复请求幂等,不重置不叠加定时器", () => {
    vi.useFakeTimers();
    try {
      const relaunch = register(createMemoryFs());
      invoke(C1_PURGE_IPC_CHANNELS.relaunch);
      invoke(C1_PURGE_IPC_CHANNELS.relaunch);
      vi.advanceTimersByTime(C1_RELAUNCH_DELAY_MS);
      expect(relaunch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelScheduledC1Relaunch:延迟窗口内用户手动退出 → 取消调度,relaunch 永不执行;staged 语义留给状态机续走拍1", () => {
    vi.useFakeTimers();
    try {
      const relaunch = register(createMemoryFs());
      invoke(C1_PURGE_IPC_CHANNELS.relaunch);
      expect(cancelScheduledC1Relaunch()).toBe(true);
      vi.advanceTimersByTime(C1_RELAUNCH_DELAY_MS * 2);
      expect(relaunch).not.toHaveBeenCalled();
      // 无调度时再取消返回 false(幂等)
      expect(cancelScheduledC1Relaunch()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirm:经 handle 通道收尾(干净库成功)", () => {
    const memory = createMemoryFs({
      files: {
        [path.join(LEVELDB_DIR, "000005.log")]: CIPHER_LOG_BYTES(),
        [path.join(QUARANTINE_LEVELDB_DIR, "000003.log")]: PLAINTEXT_LOG_BYTES(),
        [STAGED_PATH]: Buffer.from(STAGED_JSON, "utf-8"),
      },
      dirs: [SESSION_DATA, LS_DIR, LEVELDB_DIR, QUARANTINE_DIR, QUARANTINE_LEVELDB_DIR],
    });
    register(memory);
    expect(invoke(C1_PURGE_IPC_CHANNELS.confirm)).toEqual({ ok: true });
    expect(memory.ops.existsSync(STAGED_PATH)).toBe(false);
  });
});
