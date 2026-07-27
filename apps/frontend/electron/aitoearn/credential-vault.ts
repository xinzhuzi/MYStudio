import fs from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type { SelfMediaProviderId } from "../../types/self-media";

export interface CredentialVault {
  set: (providerId: SelfMediaProviderId, secret: string) => Promise<void>;
  get: (providerId: SelfMediaProviderId) => Promise<string | null>;
  has: (providerId: SelfMediaProviderId) => Promise<boolean>;
  remove: (providerId: SelfMediaProviderId) => Promise<void>;
}

type StoredCredential = { encrypted: string };

function assertSecret(secret: string) {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("credential must not be empty");
  }
}

export function createCredentialVault(userDataPath: string): CredentialVault {
  const root = path.join(userDataPath, "self-media");
  const filePath = path.join(root, "credentials.json");

  async function read(): Promise<Partial<Record<SelfMediaProviderId, StoredCredential>>> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      return parsed as Partial<Record<SelfMediaProviderId, StoredCredential>>;
    } catch {
      return {};
    }
  }

  async function write(value: Partial<Record<SelfMediaProviderId, StoredCredential>>) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return {
    async set(providerId, secret) {
      assertSecret(secret);
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Electron safeStorage is unavailable");
      const current = await read();
      current[providerId] = { encrypted: safeStorage.encryptString(secret).toString("base64") };
      await write(current);
    },
    async has(providerId) {
      return (await this.get(providerId)) !== null;
    },
    async get(providerId) {
      const current = await read();
      const encrypted = current[providerId]?.encrypted;
      if (typeof encrypted !== "string" || !safeStorage.isEncryptionAvailable()) return null;
      try {
        return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        return null;
      }
    },
    async remove(providerId) {
      const current = await read();
      delete current[providerId];
      await write(current);
    },
  };
}
