// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { beforeEach, describe, expect, it, vi } from "vitest";

// 只 mock electron 系统调用本身(ipcMain/safeStorage),被测注册逻辑不 mock
// (先例:app-updater-ipc.test.ts 的 handlers Map 捕获模式)。
const { handlers, safeStorage } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((value: Buffer) => {
      const text = value.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("Cannot decrypt");
      return text.slice(4);
    }),
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  safeStorage,
}));

import {
  SECURE_STORAGE_IPC_CHANNELS,
  registerSecureStorageIpcHandlers,
} from "./secure-storage-ipc";

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`channel not registered: ${channel}`);
  return Promise.resolve(handler({} as never, ...args));
};

describe("registerSecureStorageIpcHandlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    safeStorage.isEncryptionAvailable.mockReturnValue(true);
    registerSecureStorageIpcHandlers();
  });

  it("registers exactly the three secure-storage channels", () => {
    expect([...handlers.keys()].sort()).toEqual([
      "secure-storage-decrypt",
      "secure-storage-encrypt",
      "secure-storage-is-available",
    ]);
    expect(SECURE_STORAGE_IPC_CHANNELS.isAvailable).toBe("secure-storage-is-available");
  });

  it("round-trips encrypt → base64 → decrypt when safeStorage is available", async () => {
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.isAvailable)).resolves.toEqual({
      ok: true,
      available: true,
    });
    const encryptReply = await invoke(SECURE_STORAGE_IPC_CHANNELS.encrypt, "秘密明文");
    expect(encryptReply).toEqual({ ok: true, cipher: Buffer.from("enc:秘密明文").toString("base64") });
    const cipher = (encryptReply as { cipher: string }).cipher;
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.decrypt, cipher)).resolves.toEqual({
      ok: true,
      plaintext: "秘密明文",
    });
  });

  it("returns explicit {ok:false, reason:'unavailable'} on all three channels when encryption is unavailable (never throws)", async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.isAvailable)).resolves.toEqual({
      ok: true,
      available: false,
    });
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.encrypt, "x")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.decrypt, "Y2lwaGVy")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it("returns {ok:false} without crashing on invalid base64 / non-ciphertext input", async () => {
    // 非 base64 字符被 Buffer.from 静默吞掉,decryptString 拿到解不开的字节 → 抛 → {ok:false}
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.decrypt, "垃圾!!!不是密文")).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.decrypt, "")).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    await expect(invoke(SECURE_STORAGE_IPC_CHANNELS.decrypt, 42)).resolves.toEqual({
      ok: false,
      reason: "error",
    });
  });
});
