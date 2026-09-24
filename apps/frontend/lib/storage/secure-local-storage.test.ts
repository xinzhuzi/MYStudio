// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * §6.2 渲染层安全存储适配器全量矩阵(out/c1-plan-0924.md)。
 * 只 mock safeStorage 系统调用本身(fake 桥 = preload IPC 桥替身),被测的
 * 适配器状态机/门禁/降级逻辑零 mock。fake 桥全部返回 Promise,模拟 IPC 异步
 * 时序(保证竞态路径被真实覆盖)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import {
  SECURE_STORAGE_INVOKE_TIMEOUT_MS,
  clearDeferredSecureWrites,
  consumePendingPlaintextMigration,
  createSecureLocalStorage,
  discardFailedVault,
  getDeferredSecureWrite,
  getSecureVaultStatus,
  resetSecureVaultStatus,
} from "./secure-local-storage";

// ---- fake 桥(可逆变换,base64 拼标记即够;先例 local-account-vault.test.ts) ----

interface FakeBridgeControl {
  encryptCalls: string[];
  decryptCalls: string[];
  setEncryptBehavior: (behavior: "ok" | "throw" | "hang") => void;
  setDecryptBehavior: (behavior: "ok" | "throw" | "hang") => void;
  setAvailability: (value: "available" | "unavailable" | "fail") => void;
}

function fakeEncode(plaintext: string): string {
  return Buffer.from(`fake-cipher:${plaintext}`).toString("base64");
}

function fakeDecode(cipher: string): string | null {
  const text = Buffer.from(cipher, "base64").toString("utf8");
  return text.startsWith("fake-cipher:") ? text.slice("fake-cipher:".length) : null;
}

function installFakeBridge(): FakeBridgeControl {
  const control: FakeBridgeControl = {
    encryptCalls: [],
    decryptCalls: [],
    setEncryptBehavior: () => undefined,
    setDecryptBehavior: () => undefined,
    setAvailability: () => undefined,
  };
  let encryptBehavior: "ok" | "throw" | "hang" = "ok";
  let decryptBehavior: "ok" | "throw" | "hang" = "ok";
  let availability: "available" | "unavailable" | "fail" = "available";
  control.setEncryptBehavior = (behavior) => {
    encryptBehavior = behavior;
  };
  control.setDecryptBehavior = (behavior) => {
    decryptBehavior = behavior;
  };
  control.setAvailability = (value) => {
    availability = value;
  };
  const bridge = {
    isEncryptionAvailable: async () => {
      if (availability === "available") return { ok: true as const, available: true };
      if (availability === "unavailable") return { ok: true as const, available: false };
      throw new Error("is-available 通道故障");
    },
    encrypt: async (plaintext: string) => {
      control.encryptCalls.push(plaintext);
      if (encryptBehavior === "throw") throw new Error("encrypt 炸了");
      if (encryptBehavior === "hang") return await new Promise<{ ok: true; cipher: string }>(() => undefined);
      return { ok: true as const, cipher: fakeEncode(plaintext) };
    },
    decrypt: async (cipher: string) => {
      control.decryptCalls.push(cipher);
      if (decryptBehavior === "throw") return { ok: false as const, reason: "error" };
      if (decryptBehavior === "hang") return await new Promise<{ ok: true; plaintext: string }>(() => undefined);
      const plaintext = fakeDecode(cipher);
      return plaintext === null
        ? { ok: false as const, reason: "error" }
        : { ok: true as const, plaintext };
    },
  };
  vi.stubGlobal("window", { secureStorage: bridge });
  return control;
}

const never = () => new Promise<never>(() => undefined);

function stubHangingAvailabilityBridge() {
  vi.stubGlobal("window", {
    secureStorage: {
      isEncryptionAvailable: () => never(),
      encrypt: async (plaintext: string) => ({ ok: true as const, cipher: fakeEncode(plaintext) }),
      decrypt: (cipher: string) => Promise.resolve(
        fakeDecode(cipher) === null
          ? { ok: false as const, reason: "error" }
          : { ok: true as const, plaintext: fakeDecode(cipher) as string },
      ),
    },
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("secure-local-storage §6.2 矩阵", () => {
  it("加密往返:setItem → 盘上 v2 密文,getItem 还原;盘值不含明文密钥子串", async () => {
    const control = installFakeBridge();
    const key = "sls-roundtrip";
    const adapter = createSecureLocalStorage(key);
    await adapter.getItem(key); // 先走一次 getItem settle 首写门禁(生产语义:水合先于任何写)
    const payload = JSON.stringify({
      state: { providers: [{ apiKey: "sk-明文密钥-0924" }] },
      version: 18,
    });
    await adapter.setItem(key, payload);
    const raw = localStorage.getItem(key);
    expect(raw).not.toBeNull();
    expect(raw).toContain('"v":2');
    expect(raw).not.toContain("sk-明文密钥-0924");
    expect(fakeDecode(JSON.parse(raw as string).cipher)).toBe(payload);
    await expect(adapter.getItem(key)).resolves.toBe(payload);
    expect(getSecureVaultStatus(key)).toEqual({ mode: "ok" });
    expect(control.encryptCalls).toEqual([payload]);
  });

  it("旧明文识别:盘预置 v1 明文 → getItem 原样返回 + pendingPlaintextMigration 置位", async () => {
    installFakeBridge();
    const key = "sls-legacy-plain";
    const adapter = createSecureLocalStorage(key);
    const legacy = JSON.stringify({ state: { apiKeys: { openai: "sk-old" } }, version: 17 });
    localStorage.setItem(key, legacy);
    await expect(adapter.getItem(key)).resolves.toBe(legacy);
    expect(consumePendingPlaintextMigration(key)).toBe(true);
    expect(consumePendingPlaintextMigration(key)).toBe(false); // 一次性消费
  });

  it("解密失败(明确失败):盘预置垃圾密文 → getItem null + decrypt-failed;期间 setItem no-op 盘值字节不变", async () => {
    installFakeBridge();
    const key = "sls-decrypt-fail";
    const adapter = createSecureLocalStorage(key);
    const garbage = JSON.stringify({ v: 2, cipher: Buffer.from("不是本机密文").toString("base64") });
    localStorage.setItem(key, garbage);
    await expect(adapter.getItem(key)).resolves.toBeNull();
    expect(getSecureVaultStatus(key)).toEqual({
      mode: "encrypted-unreadable",
      cause: "decrypt-failed",
      storageKey: key,
    });
    await adapter.setItem(key, JSON.stringify({ state: {}, version: 18 }));
    expect(localStorage.getItem(key)).toBe(garbage); // 字节不变(拒写护密文)
    await expect(adapter.getItem(key)).resolves.toBeNull(); // latch 期间继续 null
  });

  it("decrypt 超时:两次均 >5s → read-timeout 且无破坏性出口;第一次超时第二次成功 → 正常水合", async () => {
    vi.useFakeTimers();
    const control = installFakeBridge();
    control.setDecryptBehavior("hang");
    const key = "sls-decrypt-timeout";
    const adapter = createSecureLocalStorage(key);
    localStorage.setItem(key, JSON.stringify({ v: 2, cipher: fakeEncode("{}") }));

    const pending = adapter.getItem(key);
    await vi.advanceTimersByTimeAsync(SECURE_STORAGE_INVOKE_TIMEOUT_MS); // 第一次超时 → 重试
    await vi.advanceTimersByTimeAsync(SECURE_STORAGE_INVOKE_TIMEOUT_MS); // 重试仍超时
    await expect(pending).resolves.toBeNull();
    expect(getSecureVaultStatus(key)).toEqual({
      mode: "encrypted-unreadable",
      cause: "read-timeout",
      storageKey: key,
    });
    expect(control.decryptCalls).toHaveLength(2);
    await adapter.setItem(key, "x");
    expect(JSON.parse(localStorage.getItem(key) as string).v).toBe(2); // 拒写,盘值不动

    // 第一次超时、第二次成功 → 正常水合,无 read-timeout
    const key2 = "sls-decrypt-timeout-retry";
    let decryptAttempt = 0;
    vi.stubGlobal("window", {
      secureStorage: {
        isEncryptionAvailable: async () => ({ ok: true as const, available: true }),
        encrypt: async (plaintext: string) => ({ ok: true as const, cipher: fakeEncode(plaintext) }),
        decrypt: async (cipher: string) => {
          decryptAttempt += 1;
          if (decryptAttempt === 1) return never();
          return { ok: true as const, plaintext: fakeDecode(cipher) as string };
        },
      },
    });
    const adapter2 = createSecureLocalStorage(key2);
    const plain = JSON.stringify({ state: { apiKeys: { a: "b" } }, version: 18 });
    localStorage.setItem(key2, JSON.stringify({ v: 2, cipher: fakeEncode(plain) }));
    const pending2 = adapter2.getItem(key2);
    await vi.advanceTimersByTimeAsync(SECURE_STORAGE_INVOKE_TIMEOUT_MS); // 第一次超时
    await expect(pending2).resolves.toBe(plain); // 重试成功
    expect(getSecureVaultStatus(key2)).toEqual({ mode: "ok" });
  });

  it("is-available 异常:重试一次仍失败按不可用——盘上明文 → 明文读写+degraded;盘上 v2 密文 → unavailable 拒写", async () => {
    const control = installFakeBridge();
    control.setAvailability("fail");
    const plainKey = "sls-avail-fail-plain";
    const adapter = createSecureLocalStorage(plainKey);
    const legacy = JSON.stringify({ state: { servers: [] }, version: 0 });
    localStorage.setItem(plainKey, legacy);
    await expect(adapter.getItem(plainKey)).resolves.toBe(legacy);
    expect(getSecureVaultStatus(plainKey)).toEqual({ mode: "plaintext-degraded" });
    await adapter.setItem(plainKey, JSON.stringify({ state: { servers: [1] }, version: 0 }));
    expect(localStorage.getItem(plainKey)).toBe(JSON.stringify({ state: { servers: [1] }, version: 0 })); // 明文直写
    expect(consumePendingPlaintextMigration(plainKey)).toBe(false); // 不可用不置迁移标志

    const cipherKey = "sls-avail-fail-cipher";
    const adapter2 = createSecureLocalStorage(cipherKey);
    const envelope = JSON.stringify({ v: 2, cipher: fakeEncode("{}") });
    localStorage.setItem(cipherKey, envelope);
    await expect(adapter2.getItem(cipherKey)).resolves.toBeNull();
    expect(getSecureVaultStatus(cipherKey)).toEqual({
      mode: "encrypted-unreadable",
      cause: "unavailable",
      storageKey: cipherKey,
    });
    await adapter2.setItem(cipherKey, "新值");
    expect(localStorage.getItem(cipherKey)).toBe(envelope); // 拒写护密文
  });

  it("is-available 超时(失败安全):两次 >5s → 按不可用处理", async () => {
    vi.useFakeTimers();
    stubHangingAvailabilityBridge();
    const key = "sls-avail-timeout";
    const adapter = createSecureLocalStorage(key);
    localStorage.setItem(key, JSON.stringify({ v: 2, cipher: fakeEncode("{}") }));
    const pending = adapter.getItem(key);
    await vi.advanceTimersByTimeAsync(SECURE_STORAGE_INVOKE_TIMEOUT_MS); // 第一次超时 → 重试
    await vi.advanceTimersByTimeAsync(SECURE_STORAGE_INVOKE_TIMEOUT_MS); // 重试仍超时 → 不可用
    await expect(pending).resolves.toBeNull();
    expect(getSecureVaultStatus(key)).toEqual({
      mode: "encrypted-unreadable",
      cause: "unavailable",
      storageKey: key,
    });
  });

  it("桥在但明确不可用、盘上明文/空:明文读写 + degraded,不置 pendingPlaintextMigration", async () => {
    const control = installFakeBridge();
    control.setAvailability("unavailable");
    const key = "sls-unavailable-plain";
    const adapter = createSecureLocalStorage(key);
    expect(await adapter.getItem(key)).toBeNull(); // 空盘
    expect(getSecureVaultStatus(key)).toEqual({ mode: "plaintext-degraded" });
    const legacy = JSON.stringify({ state: { a: 1 }, version: 18 });
    localStorage.setItem(key, legacy);
    await expect(adapter.getItem(key)).resolves.toBe(legacy);
    await adapter.setItem(key, JSON.stringify({ state: { a: 2 }, version: 18 }));
    expect(localStorage.getItem(key)).toBe(JSON.stringify({ state: { a: 2 }, version: 18 }));
    expect(consumePendingPlaintextMigration(key)).toBe(false);
  });

  it("桥在但不可用、盘上 v2 密文:getItem null + unavailable;setItem no-op;discardFailedVault 后转明文可用", async () => {
    const control = installFakeBridge();
    const key = "sls-unavailable-cipher";
    const adapter = createSecureLocalStorage(key);
    const envelope = JSON.stringify({ v: 2, cipher: fakeEncode("密文载荷") });
    localStorage.setItem(key, envelope);
    control.setAvailability("unavailable");
    await expect(adapter.getItem(key)).resolves.toBeNull();
    expect(getSecureVaultStatus(key)).toEqual({
      mode: "encrypted-unreadable",
      cause: "unavailable",
      storageKey: key,
    });
    await adapter.setItem(key, "别毁我");
    expect(localStorage.getItem(key)).toBe(envelope); // 可恢复密文字节保住

    discardFailedVault(key); // 显式知情出口
    expect(localStorage.getItem(key)).toBeNull();
    expect(getSecureVaultStatus(key)).toEqual({ mode: "plaintext-degraded" });
    await adapter.setItem(key, "明文重来");
    expect(localStorage.getItem(key)).toBe("明文重来");
  });

  it("加密失败降级:encrypt 抛错/超时 → setItem 后盘上为明文新值(当次保存不丢)+ degraded", async () => {
    const control = installFakeBridge();
    control.setEncryptBehavior("throw");
    const key = "sls-encrypt-fail";
    const adapter = createSecureLocalStorage(key);
    await adapter.getItem(key); // 门禁 settle + 可用性缓存
    const value = JSON.stringify({ state: { providers: [{ apiKey: "sk-新密钥" }] }, version: 18 });
    await adapter.setItem(key, value);
    expect(localStorage.getItem(key)).toBe(value); // 明文直写,当次内容完整
    expect(getSecureVaultStatus(key)).toEqual({ mode: "plaintext-degraded" });

    // 超时变体:encrypt 挂住 → 5s 边界后降级
    vi.useFakeTimers();
    const control2 = installFakeBridge();
    control2.setEncryptBehavior("hang");
    const key2 = "sls-encrypt-timeout";
    const adapter2 = createSecureLocalStorage(key2);
    await adapter2.getItem(key2);
    const write = adapter2.setItem(key2, "超时降级值");
    await vi.advanceTimersByTimeAsync(SECURE_STORAGE_INVOKE_TIMEOUT_MS);
    await write;
    expect(localStorage.getItem(key2)).toBe("超时降级值");
    expect(getSecureVaultStatus(key2)).toEqual({ mode: "plaintext-degraded" });
  });

  it("无桥降级:无 window.secureStorage → setItem 明文直写(现行为)+ degraded;读到 v2 密文 → decrypt-failed 返回 null", async () => {
    const key = "sls-no-bridge";
    const adapter = createSecureLocalStorage(key);
    await adapter.getItem(key);
    await adapter.setItem(key, "明文值");
    expect(localStorage.getItem(key)).toBe("明文值");
    expect(getSecureVaultStatus(key)).toEqual({ mode: "plaintext-degraded" });

    const key2 = "sls-no-bridge-cipher";
    const adapter2 = createSecureLocalStorage(key2);
    localStorage.setItem(key2, JSON.stringify({ v: 2, cipher: fakeEncode("x") }));
    await expect(adapter2.getItem(key2)).resolves.toBeNull();
    expect(getSecureVaultStatus(key2)).toEqual({
      mode: "encrypted-unreadable",
      cause: "decrypt-failed",
      storageKey: key2,
    });
    await adapter2.setItem(key2, "也不许写");
    expect(JSON.parse(localStorage.getItem(key2) as string).v).toBe(2); // 拒写护密文
  });

  it("H1 工厂不抛错:无 window/桥缺失/桥残缺时构造均不抛,createJSONStorage 永不返回 undefined", () => {
    expect(() => createSecureLocalStorage("sls-h1")).not.toThrow(); // 无 window
    vi.stubGlobal("window", {}); // 桥缺失
    expect(() => createSecureLocalStorage("sls-h1")).not.toThrow();
    vi.stubGlobal("window", { secureStorage: { encrypt: () => undefined } }); // 桥残缺
    expect(() => createSecureLocalStorage("sls-h1")).not.toThrow();
    expect(createJSONStorage(() => createSecureLocalStorage("sls-h1"))).toBeDefined();
  });

  it("discardFailedVault:removeItem 生效 + 状态复位", async () => {
    installFakeBridge();
    const key = "sls-discard";
    const adapter = createSecureLocalStorage(key);
    await adapter.getItem(key); // settle 首写门禁
    await adapter.setItem(key, "v2 值");
    expect(JSON.parse(localStorage.getItem(key) as string).v).toBe(2);
    discardFailedVault(key);
    expect(localStorage.getItem(key)).toBeNull();
    expect(getSecureVaultStatus(key)).toEqual({ mode: "ok" }); // 可用环境回 ok
    await expect(adapter.getItem(key)).resolves.toBeNull();
  });

  it("首写门禁(§4.5):水合 getItem 未 settle 时 setItem 一律丢弃不落盘;settle 后无任何补写;水合后真实 set() 正常落盘", async () => {
    const control = installFakeBridge();
    const key = "sls-first-write-gate";
    const adapter = createSecureLocalStorage(key);
    const legacy = JSON.stringify({ state: { apiKeys: { openai: "sk-hydrate" } }, version: 18 });
    localStorage.setItem(key, legacy);

    // 门禁期(首次 getItem 尚未 settle):两次写全部丢弃
    const dropped1 = adapter.setItem(key, JSON.stringify({ state: { apiKeys: {} }, version: 18 }));
    const dropped2 = adapter.setItem(key, "近空态快照");
    await Promise.all([dropped1, dropped2]);
    expect(localStorage.getItem(key)).toBe(legacy); // 盘值=水合源值,无任何补写
    expect(control.encryptCalls).toEqual([]); // 丢弃发生在 IPC 之前
    expect(getDeferredSecureWrite(key)?.value).toBe("近空态快照"); // 仅记录最后一次供调试

    await expect(adapter.getItem(key)).resolves.toBe(legacy); // 水合完成,门禁 settle
    clearDeferredSecureWrites(key); // onFinishHydration 双保险:只清记录,不 flush
    expect(getDeferredSecureWrite(key)).toBeNull();
    expect(localStorage.getItem(key)).toBe(legacy); // 清记录不产生任何写

    // 水合后下一次真实用户 set() 正常落盘(值=水合后全量态)
    const next = JSON.stringify({ state: { apiKeys: { openai: "sk-hydrate", k2: "v2" } }, version: 18 });
    await adapter.setItem(key, next);
    const raw = localStorage.getItem(key) as string;
    expect(JSON.parse(raw).v).toBe(2);
    expect(fakeDecode(JSON.parse(raw).cipher)).toBe(next);
  });

  it("A2 重试窗口门禁(安全复核补):unreadable 复位后的再次 getItem 在途期,setItem 照样被丢弃,防近空态覆写唯一密文", async () => {
    const payload = JSON.stringify({ state: { apiKeys: { a: "sk-唯一密钥" } }, version: 18 });
    let decryptMode: "fail" | "gated" = "fail";
    let releaseGated: (() => void) | null = null;
    vi.stubGlobal("window", {
      secureStorage: {
        isEncryptionAvailable: async () => ({ ok: true as const, available: true }),
        encrypt: async (plaintext: string) => ({ ok: true as const, cipher: fakeEncode(plaintext) }),
        decrypt: (cipher: string) => {
          if (decryptMode === "fail") return Promise.resolve({ ok: false as const, reason: "error" });
          return new Promise((resolve) => {
            releaseGated = () => resolve({ ok: true as const, plaintext: fakeDecode(cipher) as string });
          });
        },
      },
    });
    const key = "sls-retry-window-gate";
    const adapter = createSecureLocalStorage(key);
    const envelope = JSON.stringify({ v: 2, cipher: fakeEncode(payload) });
    localStorage.setItem(key, envelope);

    // 第一次 getItem:decrypt 明确失败 → encrypted-unreadable(decrypt-failed)
    await expect(adapter.getItem(key)).resolves.toBeNull();
    expect(getSecureVaultStatus(key).mode).toBe("encrypted-unreadable");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await adapter.setItem(key, "latch 期写入");
    expect(warnSpy).toHaveBeenCalledTimes(1); // 拒写有逐次反馈
    expect(localStorage.getItem(key)).toBe(envelope);
    warnSpy.mockRestore();

    // A2 重试:复位状态(横幅「重试」第一步),decrypt 切到挂起模式
    resetSecureVaultStatus(key);
    decryptMode = "gated";
    const retryRead = adapter.getItem(key); // 重试水合在途(等待 decrypt,最长 2×5s)
    await Promise.resolve();
    await adapter.setItem(key, JSON.stringify({ state: { apiKeys: {} }, version: 18 })); // 窗口内竞态写(近空态)
    expect(localStorage.getItem(key)).toBe(envelope); // 门禁在途期生效:密文字节不变
    expect(getDeferredSecureWrite(key)?.value).toContain("apiKeys"); // 丢弃已记录

    // TS 的 CFA 不追踪 decrypt 闭包内对 releaseGated 的赋值(narrow 成 null),显式还原类型
    (releaseGated as (() => void) | null)?.();
    await expect(retryRead).resolves.toBe(payload); // 重试水合成功
    expect(getSecureVaultStatus(key)).toEqual({ mode: "ok" });

    // 窗口结束后写盘恢复正常(值=水合后全量态)
    const next = JSON.stringify({ state: { apiKeys: { a: "sk-唯一密钥", b: "新增" } }, version: 18 });
    await adapter.setItem(key, next);
    expect(fakeDecode(JSON.parse(localStorage.getItem(key) as string).cipher)).toBe(next);
  });

  it("写盘失败不谎报 ok(安全复核补):加密成功但 localStorage 写入抛错 → 状态降档、盘上保留旧值", async () => {
    installFakeBridge();
    const key = "sls-write-fail";
    const adapter = createSecureLocalStorage(key);
    await adapter.getItem(key); // settle 门禁
    localStorage.setItem(key, "旧明文值");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setItemSpy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await adapter.setItem(key, JSON.stringify({ state: { apiKeys: { a: "b" } }, version: 18 }));
    expect(getSecureVaultStatus(key)).toEqual({ mode: "plaintext-degraded" }); // 不谎报 ok
    expect(errorSpy).toHaveBeenCalled(); // 写盘失败有日志
    setItemSpy.mockRestore();
    expect(localStorage.getItem(key)).toBe("旧明文值"); // 盘上保留旧值,无半写状态
    errorSpy.mockRestore();
  });
});
