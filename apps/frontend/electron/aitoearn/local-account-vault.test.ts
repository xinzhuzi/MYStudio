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
});
