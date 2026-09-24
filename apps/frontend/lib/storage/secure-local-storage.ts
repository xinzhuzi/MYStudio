// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 安全本地存储适配器(0924 C1 专项:API 密钥 safeStorage 落盘加密)。
 *
 * 物理介质仍是 localStorage(单键原位覆写,键名不变);盘值形态二选一:
 *   v2 密文:{ "v": 2, "cipher": "<base64(safeStorage.encryptString(整包 JSON 明文))>" }
 *   旧明文:zustand 原生 { state, version } JSON(=现行为,降级/未迁移时的形态)
 * 判别式:JSON.parse 成功 && typeof v === "number" && v === 2 → 密文;其余一律按旧明文。
 *
 * 硬约束 H1(计划 §4.2):`createJSONStorage` 在工厂同步抛错时整体 return undefined
 * → persist 落入无 storage 分支,加密与持久化双双静默旁路——因此本工厂体只构造
 * 对象字面量,一切环境探测(window/桥/可用性)延迟到 getItem/setItem 内部,且
 * 全路径 try/catch 绝不抛(spec `.trellis/spec/frontend/state-management.md` C4:
 * hydrate 链静默吞异常 → 空态写盘 = 静默清库)。
 *
 * 迁移算法(计划 §4.3,「加密先行、成功后清明文、失败回滚」):
 * 覆写是**单次 setItem**——先 IPC encrypt 整包明文,成功才写 {v:2,cipher} 原位替换
 * 明文(无独立「删明文」步骤);encrypt 失败/超时则把当次完整明文直写盘(降级,
 * 当次保存不丢)。任何一步不满足,盘上要么是旧明文要么是密文,绝无「明文没了、
 * 密文没写成」的中间态——不存在丢用户密钥的路径。
 *
 * 首写门禁(计划 §4.5,异步水合竞态对策;安全复核后升级为**每次 getItem 在途期
 * 均生效**,原「一次性首写门禁」在 A2 重试二次水合窗口留有近空态覆写唯一密文的
 * 缺口):任何 getItem 在途期间(含首次水合、A2 重试的 decrypt 等待期,最长 2×5s),
 * 一切 setItem **一律丢弃不落盘**(仅记录最后一次供调试)。水合前的近空态快照一旦
 * 落盘,进程中途崩溃即永久丢钥;丢弃则内存/盘一致,真正需要落盘的变更全部发生在
 * 水合之后(migrate 自动回写与 §4.3 钩子写都发生在 getItem settle 之后,不受影响)。
 */
import type { StateStorage } from "zustand/middleware";

/** 每次 secureStorage IPC invoke 的超时上限(慢机主进程繁忙的现实边界)。 */
export const SECURE_STORAGE_INVOKE_TIMEOUT_MS = 5000;

export type SecureVaultStatus =
  /** 加密读写正常 */
  | { mode: "ok" }
  /** 本机不可用/加密失败,明文读写(=现行为,盘上无密文) */
  | { mode: "plaintext-degraded" }
  /** 盘上有 v2 密文但本机读不出(三 cause 数据行为一致:不读+拒写护密文;UI 横幅与出口分档,见设置页 SecureVaultBanner) */
  | { mode: "encrypted-unreadable"; cause: "decrypt-failed" | "read-timeout" | "unavailable"; storageKey: string };

// preload 暴露的 safeStorage 桥(先例:lib/storage/indexed-db-storage.ts 的全局 Window 声明)
declare global {
  interface Window {
    secureStorage?: {
      isEncryptionAvailable: () => Promise<{ ok: true; available: boolean } | { ok: false; reason?: string }>;
      encrypt: (plaintext: string) => Promise<{ ok: true; cipher: string } | { ok: false; reason?: string }>;
      decrypt: (cipher: string) => Promise<{ ok: true; plaintext: string } | { ok: false; reason?: string }>;
    };
  }
}

interface SecureStorageBridge {
  isEncryptionAvailable: () => Promise<{ ok: true; available: boolean } | { ok: false; reason?: string }>;
  encrypt: (plaintext: string) => Promise<{ ok: true; cipher: string } | { ok: false; reason?: string }>;
  decrypt: (cipher: string) => Promise<{ ok: true; plaintext: string } | { ok: false; reason?: string }>;
}

interface SecureEnvelope {
  v: 2;
  cipher: string;
}

interface PerKeyVaultState {
  status: SecureVaultStatus;
  /** getItem 读到旧明文且本机可加密时置位;§4.3 onRehydrateStorage 钩子消费(一次性)。 */
  pendingPlaintextMigration: boolean;
  /** 门禁期被丢弃的最后一次 setItem(仅调试用,绝不 flush 落盘)。 */
  deferredWrite: { name: string; value: string } | null;
}

// ---- 模块级单例状态(状态源不入 store state、不进 partialize,防自持久化) ----
const vaultStates = new Map<string, PerKeyVaultState>();
const statusListeners = new Set<() => void>();

function getVaultState(storageKey: string): PerKeyVaultState {
  let state = vaultStates.get(storageKey);
  if (!state) {
    state = { status: { mode: "ok" }, pendingPlaintextMigration: false, deferredWrite: null };
    vaultStates.set(storageKey, state);
  }
  return state;
}

function setStatus(storageKey: string, next: SecureVaultStatus): void {
  const state = getVaultState(storageKey);
  if (state.status === next) return;
  state.status = next;
  statusListeners.forEach((listener) => listener());
}

/** UI 横幅读此(模块单例;配合 subscribeSecureVaultStatus 做 useSyncExternalStore)。 */
export function getSecureVaultStatus(storageKey: string): SecureVaultStatus {
  return getVaultState(storageKey).status;
}

/** 状态变化订阅(设置页横幅用;返回取消函数)。 */
export function subscribeSecureVaultStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** 门禁期被丢弃的最后一次写(调试/测试观测;永不被 flush)。 */
export function getDeferredSecureWrite(storageKey: string): { name: string; value: string } | null {
  return getVaultState(storageKey).deferredWrite;
}

/** onFinishHydration 双保险:只清空 deferred 记录,绝不把捕获值补写落盘。 */
export function clearDeferredSecureWrites(storageKey: string): void {
  getVaultState(storageKey).deferredWrite = null;
}

/**
 * §4.3 迁移触发器:水合完成回调里消费。返回 true 表示「读到过旧明文且本机可加密,
 * 该覆写一次了」且**只返回一次**(消费即清);覆写若降级失败,下次启动 getItem 重读
 * 明文会重新置位,自愈重试。
 */
export function consumePendingPlaintextMigration(storageKey: string): boolean {
  const state = getVaultState(storageKey);
  if (!state.pendingPlaintextMigration) return false;
  state.pendingPlaintextMigration = false;
  return true;
}

function resetVaultState(storageKey: string): void {
  vaultStates.delete(storageKey);
  statusListeners.forEach((listener) => listener());
}

/**
 * 「清除无效密文」出口(A1/B 横幅按钮,二次确认后调用):移除键 + 状态复位。
 * 复位后不可用环境立即呈现 plaintext-degraded(横幅 C),可用环境回 ok。
 */
export function discardFailedVault(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // 存储本体异常时也只能尽力:键若删不掉,下次 getItem 仍会按密文路径处理
  }
  resetVaultState(storageKey);
  const bridge = getSecureStorageBridge();
  const available = bridge ? (peekResolvedAvailability(bridge) ?? true) : false;
  setStatus(storageKey, available ? { mode: "ok" } : { mode: "plaintext-degraded" });
}

/**
 * A2(读取超时)横幅「重试」按钮:只复位本键状态,不动盘上数据;随后由调用方
 * 触发 store.persist.rehydrate() 再试一次(同会话内)。
 */
export function resetSecureVaultStatus(storageKey: string): void {
  resetVaultState(storageKey);
}

// ---- 盘值读写与判别 ----

function readRaw(name: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

/** 写盘并如实回报结果(配额/隐私模式等失败不抛,由调用方决定状态如何上报)。 */
function writeRaw(name: string, value: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(name, value);
    return true;
  } catch (error) {
    console.error("secure storage 写盘失败,盘上保留旧值", error);
    return false;
  }
}

function parseSecureEnvelope(raw: string | null): { v2: true; cipher: string } | { v2: false } {
  if (!raw) return { v2: false };
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; cipher?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.v === "number" &&
      parsed.v === 2 &&
      typeof parsed.cipher === "string" &&
      parsed.cipher.length > 0
    ) {
      return { v2: true, cipher: parsed.cipher };
    }
  } catch {
    // 非 JSON → 旧明文
  }
  return { v2: false };
}

// ---- 桥解析与可用性缓存(全局事实,进程内不变;按桥对象 WeakMap 缓存,换桥即重估) ----

function getSecureStorageBridge(): SecureStorageBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.secureStorage;
  if (!bridge) return null;
  if (
    typeof bridge.isEncryptionAvailable !== "function" ||
    typeof bridge.encrypt !== "function" ||
    typeof bridge.decrypt !== "function"
  ) {
    return null;
  }
  return bridge;
}

class SecureStorageTimeoutError extends Error {
  constructor(channel: string, ms: number) {
    super(`secureStorage IPC 通道 ${channel} 超时 (${ms}ms)`);
    this.name = "SecureStorageTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, channel: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SecureStorageTimeoutError(channel, SECURE_STORAGE_INVOKE_TIMEOUT_MS)), SECURE_STORAGE_INVOKE_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const availabilityCache = new WeakMap<object, Promise<boolean>>();
let resolvedAvailability: { bridge: object; available: boolean } | null = null;

function peekResolvedAvailability(bridge: object): boolean | null {
  return resolvedAvailability && resolvedAvailability.bridge === bridge ? resolvedAvailability.available : null;
}

/**
 * 可用性判定(失败安全取向):查询异常/超时 → 重试一次 → 仍失败按「会话级不可用」。
 * 明确返回 available:false(如 Linux 无 keyring)不重试——那是环境事实。
 */
function resolveAvailability(bridge: SecureStorageBridge): Promise<boolean> {
  const cached = availabilityCache.get(bridge);
  if (cached) return cached;
  const query = (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const reply = await withTimeout(bridge.isEncryptionAvailable(), "secure-storage-is-available");
        if (reply && reply.ok) return reply.available === true;
        // reply.ok === false:通道自身异常 → 重试
      } catch {
        // 超时/抛错 → 重试
      }
    }
    return false;
  })();
  availabilityCache.set(bridge, query);
  void query.then((available) => {
    resolvedAvailability = { bridge, available };
  });
  return query;
}

/**
 * decrypt:超时重试一次(慢≠坏),重试仍超时 → read-timeout(transient,不给破坏性
 * 出口);通道明确失败/抛错 → decrypt-failed。成功返回明文。
 */
async function decryptEnvelope(
  bridge: SecureStorageBridge,
  cipher: string,
): Promise<{ ok: true; plaintext: string } | { ok: false; cause: "decrypt-failed" | "read-timeout" }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reply = await withTimeout(bridge.decrypt(cipher), "secure-storage-decrypt");
      if (reply && reply.ok) return { ok: true, plaintext: reply.plaintext };
      return { ok: false, cause: "decrypt-failed" };
    } catch (error) {
      if (error instanceof SecureStorageTimeoutError) continue; // 超时 → 重试一次
      return { ok: false, cause: "decrypt-failed" };
    }
  }
  return { ok: false, cause: "read-timeout" };
}

// ---- 工厂(H1:绝不同步抛错;环境探测全部延迟到方法内部) ----

/**
 * 为单个存储键建安全适配器(zustand `createJSONStorage(() => createSecureLocalStorage(key))`)。
 * 实例内含一次性首写门禁;模块级状态(可用性缓存/横幅状态)按 storageKey 共享。
 */
export function createSecureLocalStorage(storageKey: string): StateStorage {
  // 门禁(§4.5 + 0924 安全复核):首个 getItem 启动前 + **任何 getItem 在途期**
  // (含 A2 重试二次水合的 decrypt 等待窗口),setItem 一律丢弃——防止近初始
  // 内存态加密覆写盘上唯一完好密文。
  let firstGetItemStarted = false;
  let inFlightGetItemCount = 0;

  return {
    async getItem(name: string): Promise<string | null> {
      firstGetItemStarted = true;
      inFlightGetItemCount += 1;
      try {
        // encrypted-unreadable 期间:不读不抛,返回 null(§4.2 矩阵第 5 行)
        if (getSecureVaultStatus(storageKey).mode === "encrypted-unreadable") {
          return null;
        }
        const raw = readRaw(name);
        const envelope = parseSecureEnvelope(raw);
        const bridge = getSecureStorageBridge();

        if (!envelope.v2) {
          // 旧明文/空盘
          if (!bridge) {
            setStatus(storageKey, { mode: "plaintext-degraded" });
            return raw;
          }
          const available = await resolveAvailability(bridge);
          if (!available) {
            // 本机不可用:明文照读,但无从迁移
            setStatus(storageKey, { mode: "plaintext-degraded" });
            return raw;
          }
          if (raw !== null) {
            getVaultState(storageKey).pendingPlaintextMigration = true; // §4.3 迁移候选
          }
          return raw;
        }

        // 盘上是 v2 密文
        if (!bridge) {
          // web dev / 未注入:密文本机解不开,护住不覆写
          setStatus(storageKey, { mode: "encrypted-unreadable", cause: "decrypt-failed", storageKey });
          return null;
        }
        const available = await resolveAvailability(bridge);
        if (!available) {
          // 密文数据完好,换环境可恢复——拒明文覆写
          setStatus(storageKey, { mode: "encrypted-unreadable", cause: "unavailable", storageKey });
          return null;
        }
        const result = await decryptEnvelope(bridge, envelope.cipher);
        if (result.ok) {
          setStatus(storageKey, { mode: "ok" });
          return result.plaintext;
        }
        setStatus(storageKey, { mode: "encrypted-unreadable", cause: result.cause, storageKey });
        return null;
      } catch {
        // 绝不抛:水合链 catch 会静默清库(spec C4)
        return null;
      } finally {
        inFlightGetItemCount -= 1;
      }
    },

    async setItem(name: string, value: string): Promise<void> {
      try {
        if (!firstGetItemStarted || inFlightGetItemCount > 0) {
          // 门禁:水合/重试窗口在途期的近空态快照一律丢弃(只记录最后一次,绝不
          // flush——flush 会把陈旧近空态写上盘,期间崩溃即永久丢钥,见计划 §4.5)
          getVaultState(storageKey).deferredWrite = { name, value };
          return;
        }
        if (getSecureVaultStatus(storageKey).mode === "encrypted-unreadable") {
          // 拒写护密文:防空态 set() 把可恢复密文覆成「空态密文/明文空态」。
          // 逐次反馈:用户当次保存只进内存不落盘,须让其在控制台可见(横幅文案同步提示)
          console.warn(`[secure-storage] ${storageKey} 处于无法解密状态,本次保存未写入磁盘(仅保留在内存,重启后丢失)`);
          return;
        }
        const bridge = getSecureStorageBridge();
        if (!bridge) {
          writeRaw(name, value); // =现行为
          setStatus(storageKey, { mode: "plaintext-degraded" });
          return;
        }
        const available = await resolveAvailability(bridge);
        if (!available) {
          const raw = readRaw(name);
          if (parseSecureEnvelope(raw).v2) {
            // 盘上有完好密文且本机不可用:宁可拒写也不毁唯一可恢复副本
            setStatus(storageKey, { mode: "encrypted-unreadable", cause: "unavailable", storageKey });
            return;
          }
          writeRaw(name, value);
          setStatus(storageKey, { mode: "plaintext-degraded" });
          return;
        }
        // 加密先行:明文在加密成功前绝不触碰盘
        try {
          const reply = await withTimeout(bridge.encrypt(value), "secure-storage-encrypt");
          if (reply && reply.ok) {
            const envelope: SecureEnvelope = { v: 2, cipher: reply.cipher };
            // 单次覆写:明文即被密文原位替换。写盘失败则不谎报 ok(状态如实降档)
            if (writeRaw(name, JSON.stringify(envelope))) {
              getVaultState(storageKey).pendingPlaintextMigration = false;
              setStatus(storageKey, { mode: "ok" });
            } else {
              setStatus(storageKey, { mode: "plaintext-degraded" });
            }
            return;
          }
        } catch {
          // 加密抛错/超时 → 降级
        }
        // 降级明文直写:当次保存不丢,内存=盘(与横幅 C「将以明文保存」语义一致)
        writeRaw(name, value);
        setStatus(storageKey, { mode: "plaintext-degraded" });
      } catch {
        // 绝不抛
      }
    },

    removeItem(name: string): void {
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(name);
      } catch {
        // 尽力而为
      }
      resetVaultState(storageKey);
    },
  };
}
