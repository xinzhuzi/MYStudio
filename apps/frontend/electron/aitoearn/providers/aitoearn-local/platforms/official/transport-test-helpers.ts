import type {
  LocalAccountRecord,
  LocalAccountSummary,
  LocalAccountVault,
} from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "./transport-runtime";

export function createMemoryAccountVault(initialRecords: readonly LocalAccountRecord[] = []) {
  const records = new Map(initialRecords.map((record) => [record.id, { ...record }]));
  const vault: LocalAccountVault = {
    filePath: "memory://self-media/accounts.json",
    list: async (): Promise<LocalAccountSummary[]> => [...records.values()].map((record) => ({
      id: record.id,
      platform: record.platform,
      providerAccountId: record.providerAccountId,
      displayName: record.displayName,
      avatarUrl: record.avatarUrl,
      updatedAt: record.updatedAt,
    })),
    get: async (accountId) => records.get(accountId) ?? null,
    upsert: async (record) => { records.set(record.id, { ...record }); },
    remove: async (accountId) => { records.delete(accountId); },
  };
  return { records, vault };
}

export function withMemoryAccountVault(runtime: OfficialTransportRuntime) {
  const memory = createMemoryAccountVault();
  return {
    ...memory,
    runtime: {
      ...runtime,
      vault: memory.vault,
      authorize: async ({ redirectUri, expectedState }) => {
        const callback = new URL(redirectUri);
        callback.searchParams.set("code", "code-1");
        callback.searchParams.set("state", expectedState);
        return callback;
      },
    } satisfies OfficialTransportRuntime,
  };
}
