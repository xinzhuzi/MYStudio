import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { SelfMediaPlatform } from "../../types/self-media";

export interface LocalAccountCredential {
  cookies: unknown;
  localStorage?: string;
}

export interface LocalAccountRecord {
  id: string;
  platform: SelfMediaPlatform;
  displayName: string;
  avatarUrl?: string;
  credential: LocalAccountCredential;
  updatedAt: string;
}

export interface LocalAccountSummary extends Omit<LocalAccountRecord, "credential"> {}

interface PersistedLocalAccount {
  id: string;
  platform: LocalAccountRecord["platform"];
  displayName: string;
  avatarUrl?: string;
  encryptedCredential: string;
  updatedAt: string;
}

interface LocalAccountVaultFile {
  schemaVersion: 1;
  accounts: PersistedLocalAccount[];
}

function isAvailable() {
  return typeof safeStorage.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable();
}

export function createLocalAccountVault(userDataPath: string) {
  const filePath = path.join(userDataPath, "self-media", "accounts.json");

  async function read(): Promise<LocalAccountVaultFile> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<LocalAccountVaultFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.accounts)) return { schemaVersion: 1, accounts: [] };
      return { schemaVersion: 1, accounts: parsed.accounts.filter((account): account is PersistedLocalAccount => Boolean(account && typeof account.id === "string" && typeof account.encryptedCredential === "string")) };
    } catch {
      return { schemaVersion: 1, accounts: [] };
    }
  }

  async function write(value: LocalAccountVaultFile) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async function list(): Promise<LocalAccountSummary[]> {
    const value = await read();
    return value.accounts.map((account) => ({
      id: account.id,
      platform: account.platform,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      updatedAt: account.updatedAt,
    }));
  }

  async function get(accountId: string): Promise<LocalAccountRecord | null> {
    const value = await read();
    const account = value.accounts.find((item) => item.id === accountId);
    if (!account || !isAvailable()) return null;
    try {
      const credential = JSON.parse(safeStorage.decryptString(Buffer.from(account.encryptedCredential, "base64"))) as LocalAccountCredential;
      return { ...account, credential };
    } catch {
      return null;
    }
  }

  async function upsert(record: LocalAccountRecord) {
    if (!isAvailable()) throw new Error("Electron safeStorage 不可用，拒绝保存本地平台凭据");
    const value = await read();
    const encryptedCredential = safeStorage.encryptString(JSON.stringify(record.credential)).toString("base64");
    const persisted: PersistedLocalAccount = {
      id: record.id,
      platform: record.platform,
      displayName: record.displayName,
      avatarUrl: record.avatarUrl,
      encryptedCredential,
      updatedAt: record.updatedAt,
    };
    const index = value.accounts.findIndex((item) => item.id === record.id);
    if (index >= 0) value.accounts[index] = persisted;
    else value.accounts.push(persisted);
    await write(value);
  }

  async function remove(accountId: string) {
    const value = await read();
    const next = value.accounts.filter((account) => account.id !== accountId);
    if (next.length !== value.accounts.length) await write({ schemaVersion: 1, accounts: next });
  }

  return { filePath, list, get, upsert, remove };
}

export type LocalAccountVault = ReturnType<typeof createLocalAccountVault>;
