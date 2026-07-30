import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalAccountRecord } from "../../../../local-account-vault";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  requireHttpsAssetUrl,
  type OfficialTransportRuntime,
} from "./transport-runtime";

describe("official platform transport runtime", () => {
  it("parses JSON and normalizes HTTP failures without exposing request credentials", async () => {
    const runtime = {
      config: { platformId: "twitter", clientId: "client", redirectUri: "https://localhost/callback", scopes: [] },
      fetch: vi.fn(async () => new Response(JSON.stringify({ message: "denied: access_token=server-secret" }), { status: 401 })),
    } as unknown as OfficialTransportRuntime;
    await expect(requestJson(runtime, "https://api.test", { headers: { authorization: "Bearer request-secret" } })).rejects.toThrow(new Error("twitter API 请求失败 (401)"));
    expect(runtime.fetch).toHaveBeenCalledOnce();
  });

  it("reads only HTTPS remote assets and enforces the public-URL boundary", async () => {
    const runtime = {
      config: { platformId: "twitter", clientId: "client", redirectUri: "https://localhost/callback", scopes: [] },
      fetch: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })),
    } as unknown as OfficialTransportRuntime;
    await expect(readOfficialAsset(runtime, "https://assets.example.test/image.png")).resolves.toMatchObject({
      filename: "image.png",
      contentType: "image/png",
    });
    await expect(readOfficialAsset(runtime, "http://assets.example.test/image.png")).rejects.toThrow("HTTPS URL");
    expect(requireHttpsAssetUrl("https://assets.example.test/image.png")).toBe("https://assets.example.test/image.png");
    expect(() => requireHttpsAssetUrl("file:///tmp/image.png")).toThrow("公网访问");
  });

  it("reads absolute assets only after lexical and canonical root validation", async () => {
    const currentFile = fileURLToPath(import.meta.url);
    const allowedRoot = path.dirname(currentFile);
    const outsideFile = path.resolve(allowedRoot, "../platform-types.ts");
    const runtime = {
      allowedAssetRoots: () => [allowedRoot],
    } as unknown as OfficialTransportRuntime;

    await expect(readOfficialAsset(runtime, currentFile)).resolves.toMatchObject({
      filename: "transport-runtime.test.ts",
      contentType: "application/octet-stream",
    });
    await expect(readOfficialAsset(runtime, outsideFile)).rejects.toThrow("不在受控存储目录内");
  });

  it("fails closed when OAuth credentials are unavailable, invalid, or expired", async () => {
    const summaries = [
      { id: "account-online", platform: "twitter" as const, displayName: "Online", updatedAt: "2026-07-27T00:00:00.000Z" },
      { id: "account-expired", platform: "twitter" as const, displayName: "Expired", updatedAt: "2026-07-27T00:00:00.000Z" },
      { id: "account-no-expiry", platform: "twitter" as const, displayName: "No expiry", updatedAt: "2026-07-27T00:00:00.000Z" },
      { id: "account-unavailable", platform: "twitter" as const, displayName: "Unavailable", updatedAt: "2026-07-27T00:00:00.000Z" },
      { id: "account-other-platform", platform: "youtube" as const, displayName: "Other platform", updatedAt: "2026-07-27T00:00:00.000Z" },
    ];
    const records = new Map<string, LocalAccountRecord>([
      ["account-online", { ...summaries[0], credential: { kind: "oauth" as const, accessToken: "online-token", expiresAt: "2026-07-28T00:00:00.000Z" } }],
      ["account-expired", { ...summaries[1], credential: { kind: "oauth" as const, accessToken: "expired-token", expiresAt: "2026-07-26T00:00:00.000Z" } }],
      ["account-no-expiry", { ...summaries[2], credential: { kind: "oauth" as const, accessToken: "no-expiry-token" } }],
    ]);
    const getAccount = vi.fn(async (accountId: string) => records.get(accountId) ?? null);
    const runtime = {
      config: { platformId: "twitter", clientId: "client", redirectUri: "https://localhost/callback", scopes: [] },
      now: () => new Date("2026-07-27T12:00:00.000Z"),
      vault: {
        list: vi.fn(async () => summaries),
        get: getAccount,
      },
    } as unknown as OfficialTransportRuntime;

    const projected = await listOfficialAccounts(runtime);
    expect(projected).toEqual([
      { accountId: "account-online", displayName: "Online", status: "online" },
      { accountId: "account-expired", displayName: "Expired", status: "expired" },
      { accountId: "account-no-expiry", displayName: "No expiry", status: "error" },
      { accountId: "account-unavailable", displayName: "Unavailable", status: "error" },
    ]);
    expect(projected.every((account) => !("credential" in account) && !("accessToken" in account) && !("refreshToken" in account))).toBe(true);
    expect(getAccount).not.toHaveBeenCalledWith("account-other-platform");
    await expect(getOfficialAccount(runtime, "account-expired")).rejects.toThrow("OAuth 凭据已过期");
    await expect(getOfficialAccount(runtime, "account-no-expiry")).rejects.toThrow("OAuth 凭据缺少到期时间");
  });
});
