import { safeStorage } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { SelfMediaPlatform } from "../../types/self-media";

export interface LocalSessionAccountCredential {
  kind?: "session";
  cookies: unknown;
  localStorage?: string;
}

export interface LocalOAuthAccountCredential {
  kind: "oauth";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scope?: string;
}

export type LocalAccountCredential = LocalSessionAccountCredential | LocalOAuthAccountCredential;

export function isLocalSessionAccountCredential(value: LocalAccountCredential): value is LocalSessionAccountCredential {
  return value.kind !== "oauth" && "cookies" in value;
}

export function isLocalOAuthAccountCredential(value: LocalAccountCredential): value is LocalOAuthAccountCredential {
  return value.kind === "oauth" && typeof value.accessToken === "string" && value.accessToken.length > 0;
}

export interface LocalAccountRecord {
  id: string;
  platform: SelfMediaPlatform;
  providerAccountId?: string;
  displayName: string;
  avatarUrl?: string;
  credential: LocalAccountCredential;
  updatedAt: string;
}

export interface LocalAccountSummary extends Omit<LocalAccountRecord, "credential"> {}

interface PersistedLocalAccount {
  id: string;
  platform: LocalAccountRecord["platform"];
  providerAccountId?: string;
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

let tmpSequence = 0;

// 09-10 P0-3 附修:upsert/remove 全程串行——并发「读-改-写」同库会整文件互覆丢账号
// (实测两个并发登录曾互抢同一 tmp 文件名直接 ENOENT)。链按 filePath 分道并挂在
// 模块级:同一 accounts.json 的多个 vault 实例(本地桥+官方传输各建一个)也串行。
const operationChains = new Map<string, Promise<unknown>>();

export function createLocalAccountVault(userDataPath: string) {
  const filePath = path.join(userDataPath, "self-media", "accounts.json");
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = operationChains.get(filePath) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    operationChains.set(filePath, run.then(
      () => undefined,
      () => undefined,
    ));
    return run;
  };

  async function read(): Promise<LocalAccountVaultFile> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, accounts: [] };
      }
      throw error;
    }
    // 09-10 P0-3:文件存在但解析失败/结构不符 = 库损坏,必须报错拒绝——
    // 静默当空库会让下一次 upsert 以空为基线整文件重写,全平台账号不可逆丢失。
    let parsed: Partial<LocalAccountVaultFile>;
    try {
      parsed = JSON.parse(raw) as Partial<LocalAccountVaultFile>;
    } catch {
      throw new Error("账号库文件已损坏，已停止读写以防覆盖全部已存账号——请先备份或删除该文件后重试");
    }
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.accounts)) {
      throw new Error("账号库文件格式异常（schemaVersion 不符），已停止读写以防覆盖全部已存账号");
    }
    return { schemaVersion: 1, accounts: parsed.accounts.filter((account): account is PersistedLocalAccount => Boolean(account && typeof account.id === "string" && typeof account.encryptedCredential === "string")) };
  }

  async function write(value: LocalAccountVaultFile) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    // 09-10 P0-3:tmp+rename 原子落盘(与任务日志同口径),防写中途崩溃截断整库;
    // tmp 名带进程内单调序号,防并发写同库互抢同名 tmp。
    tmpSequence += 1;
    const tmpPath = `${filePath}.${process.pid}.${tmpSequence}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  }

  async function list(): Promise<LocalAccountSummary[]> {
    const value = await read();
    return value.accounts.map((account) => ({
      id: account.id,
      platform: account.platform,
      providerAccountId: account.providerAccountId,
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

  function upsert(record: LocalAccountRecord): Promise<void> {
    if (!isAvailable()) return Promise.reject(new Error("Electron safeStorage 不可用，拒绝保存本地平台凭据"));
    return enqueue(async () => {
      const value = await read();
      const encryptedCredential = safeStorage.encryptString(JSON.stringify(record.credential)).toString("base64");
      const persisted: PersistedLocalAccount = {
        id: record.id,
        platform: record.platform,
        providerAccountId: record.providerAccountId,
        displayName: record.displayName,
        avatarUrl: record.avatarUrl,
        encryptedCredential,
        updatedAt: record.updatedAt,
      };
      const index = value.accounts.findIndex((item) => item.id === record.id);
      if (index >= 0) value.accounts[index] = persisted;
      else value.accounts.push(persisted);
      await write(value);
    });
  }

  function remove(accountId: string): Promise<void> {
    return enqueue(async () => {
      const value = await read();
      const next = value.accounts.filter((account) => account.id !== accountId);
      if (next.length !== value.accounts.length) await write({ schemaVersion: 1, accounts: next });
    });
  }

  return { filePath, list, get, upsert, remove };
}

export type LocalAccountVault = ReturnType<typeof createLocalAccountVault>;
