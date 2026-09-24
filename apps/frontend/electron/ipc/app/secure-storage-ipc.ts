// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * safeStorage 三通道 IPC(0924 C1 专项:API 密钥落盘加密)。
 *
 * 契约铁律(计划 out/c1-plan-0924.md §4.2/§6.1):
 * - 三通道一律返回显式结果对象,**绝不向渲染层抛错**——渲染层适配器需要区分
 *   「环境不可用」(unavailable)与「密文损坏/解密失败」(error)两种语义,抛错
 *   会让两者混为一谈(对比先例 local-account-vault.ts 只有一个笼统 catch)。
 * - 加密:encryptString → base64;解密:Buffer.from(base64) → decryptString,
 *   均裹 try/catch(非法 base64 / 非本机密文 → {ok:false},进程不崩)。
 */
import { ipcMain, safeStorage } from "electron";

export type SecureStorageAvailabilityReply =
  | { ok: true; available: boolean }
  | { ok: false; reason: "error" };

export type SecureStorageEncryptReply =
  | { ok: true; cipher: string }
  | { ok: false; reason: "unavailable" | "error" };

export type SecureStorageDecryptReply =
  | { ok: true; plaintext: string }
  | { ok: false; reason: "unavailable" | "error" };

export const SECURE_STORAGE_IPC_CHANNELS = {
  isAvailable: "secure-storage-is-available",
  encrypt: "secure-storage-encrypt",
  decrypt: "secure-storage-decrypt",
} as const;

function isEncryptionAvailable(): boolean {
  return (
    typeof safeStorage.isEncryptionAvailable === "function" &&
    safeStorage.isEncryptionAvailable()
  );
}

export function registerSecureStorageIpcHandlers(): void {
  ipcMain.handle(SECURE_STORAGE_IPC_CHANNELS.isAvailable, (): SecureStorageAvailabilityReply => {
    try {
      return { ok: true, available: isEncryptionAvailable() };
    } catch {
      return { ok: false, reason: "error" };
    }
  });

  ipcMain.handle(SECURE_STORAGE_IPC_CHANNELS.encrypt, (
    _event,
    plaintext: unknown,
  ): SecureStorageEncryptReply => {
      if (typeof plaintext !== "string") return { ok: false, reason: "error" };
      if (!isEncryptionAvailable()) return { ok: false, reason: "unavailable" };
      try {
        return { ok: true, cipher: safeStorage.encryptString(plaintext).toString("base64") };
      } catch {
        return { ok: false, reason: "error" };
      }
    },
  );

  ipcMain.handle(SECURE_STORAGE_IPC_CHANNELS.decrypt, (
    _event,
    cipher: unknown,
  ): SecureStorageDecryptReply => {
      if (typeof cipher !== "string" || !cipher) return { ok: false, reason: "error" };
      if (!isEncryptionAvailable()) return { ok: false, reason: "unavailable" };
      try {
        return { ok: true, plaintext: safeStorage.decryptString(Buffer.from(cipher, "base64")) };
      } catch {
        // 非法 base64(被静默吞字符)或非本机密文(换机/重装)都会在这里抛
        return { ok: false, reason: "error" };
      }
    },
  );
}
