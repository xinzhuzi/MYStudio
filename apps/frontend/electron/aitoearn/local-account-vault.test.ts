import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => value.toString()),
}));
vi.mock("electron", () => ({ safeStorage }));

import { createLocalAccountVault } from "./local-account-vault";

describe("local account vault security boundaries", () => {
  const root = path.join(os.tmpdir(), `mystudio-account-vault-${process.pid}`);
  const record = {
    id: "account-1", platform: "xhs" as const, displayName: "测试账号",
    credential: { cookies: [{ name: "sid", value: "secret" }], localStorage: "token" },
    updatedAt: "2026-07-27T00:00:00.000Z",
  };

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
    safeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  it("rejects saving credentials when safeStorage is unavailable", async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    await expect(createLocalAccountVault(root).upsert(record)).rejects.toThrow("拒绝保存本地平台凭据");
    await expect(fs.stat(path.join(root, "self-media", "accounts.json"))).rejects.toThrow();
  });

  it("lists account metadata without returning credentials", async () => {
    const vault = createLocalAccountVault(root);
    await vault.upsert(record);
    const listed = await vault.list();
    expect(listed[0]).not.toHaveProperty("credential");
    expect(JSON.stringify(listed)).not.toContain("secret");
  });

  it("stores OAuth tokens encrypted while keeping them out of account summaries", async () => {
    const vault = createLocalAccountVault(root);
    await vault.upsert({
      id: "youtube:channel-1",
      platform: "youtube",
      providerAccountId: "channel-1",
      displayName: "YouTube · channel-1",
      credential: { kind: "oauth", accessToken: "access-secret", refreshToken: "refresh-secret" },
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(JSON.stringify(await vault.list())).not.toContain("access-secret");
    await expect(vault.get("youtube:channel-1")).resolves.toMatchObject({
      platform: "youtube",
      providerAccountId: "channel-1",
      credential: { kind: "oauth", accessToken: "access-secret", refreshToken: "refresh-secret" },
    });
  });

  it("refuses to touch a corrupt vault instead of silently resetting it", async () => {
    // 09-10 P0-3 回归:半写截断的库文件曾被静默当空库,下一次登录即整文件重写=全账号丢失
    const vault = createLocalAccountVault(root);
    const file = path.join(root, "self-media", "accounts.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const truncated = '{"schemaVersion":1,"accounts":[{"id":"account-1","encryptedCredential":"x';
    await fs.writeFile(file, truncated, "utf8");
    await expect(vault.upsert(record)).rejects.toThrow("账号库文件已损坏");
    await expect(vault.list()).rejects.toThrow("账号库文件已损坏");
    await expect(fs.readFile(file, "utf8")).resolves.toBe(truncated);
  });

  it("rejects an unexpected schema version instead of treating it as empty", async () => {
    const vault = createLocalAccountVault(root);
    const file = path.join(root, "self-media", "accounts.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{"schemaVersion":2,"accounts":[]}', "utf8");
    await expect(vault.upsert(record)).rejects.toThrow("格式异常");
  });

  it("writes atomically and leaves no tmp residue", async () => {
    const vault = createLocalAccountVault(root);
    await vault.upsert(record);
    const entries = await fs.readdir(path.join(root, "self-media"));
    expect(entries).toEqual(["accounts.json"]);
  });

  it("treats a missing vault file as a legitimate empty state", async () => {
    const vault = createLocalAccountVault(root);
    await expect(vault.list()).resolves.toEqual([]);
    await vault.upsert(record);
    expect(await vault.list()).toHaveLength(1);
  });

  it("serializes upserts across separate vault instances on the same file", async () => {
    // 09-10 P1:本地桥与官方传输各建 vault 实例——实例内串行不够,跨实例并发
    // 读-改-写仍会整文件互覆丢账号;串行链必须挂模块级按路径分道。
    const vaultA = createLocalAccountVault(root);
    const vaultB = createLocalAccountVault(root);
    await vaultA.upsert(record);
    const second = { ...record, id: "account-2", displayName: "第二账号" };
    await Promise.all([vaultA.upsert(second), vaultB.upsert(second)]);
    expect(await vaultA.list()).toHaveLength(2);
  });
});
