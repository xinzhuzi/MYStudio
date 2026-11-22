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
    await expect(readOfficialAsset(runtime, "https://169.254.169.254/latest/meta-data")).rejects.toThrow("安全策略");
    await expect(readOfficialAsset(runtime, "https://metadata.google.internal/computeMetadata/v1/")).rejects.toThrow("安全策略");
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
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

  function refreshableRecord(overrides: Partial<LocalAccountRecord> = {}): LocalAccountRecord {
    return {
      id: "account-refresh",
      platform: "googleBusiness",
      providerAccountId: "accounts/1/locations/2",
      displayName: "续期账号",
      credential: { kind: "oauth", accessToken: "stale-token", refreshToken: "old-refresh", expiresAt: "2026-07-26T00:00:00.000Z" },
      updatedAt: "2026-07-27T00:00:00.000Z",
      ...overrides,
    };
  }

  function refreshRuntime(fetchMock: ReturnType<typeof vi.fn>, upsert: ReturnType<typeof vi.fn>, record: LocalAccountRecord, platformId = "googleBusiness") {
    return {
      config: { platformId, clientId: "client", clientSecret: "secret", redirectUri: "https://localhost/callback", scopes: [] },
      fetch: fetchMock,
      now: () => new Date("2026-07-27T12:00:00.000Z"),
      vault: {
        get: vi.fn(async () => record),
        list: vi.fn(async () => [{ id: record.id, platform: record.platform, displayName: record.displayName, updatedAt: record.updatedAt }]),
        upsert,
      },
    } as unknown as OfficialTransportRuntime;
  }

  it("refreshes an expired credential and persists the rotated token to the vault", async () => {
    const record = refreshableRecord();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-token", refresh_token: "rotated-refresh", expires_in: 3600 })));
    const upsert = vi.fn(async () => undefined);
    const runtime = refreshRuntime(fetchMock, upsert, record);

    const account = await getOfficialAccount(runtime, record.id);

    expect(account.credential).toMatchObject({ accessToken: "fresh-token", refreshToken: "rotated-refresh", expiresAt: "2026-07-27T13:00:00.000Z" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=old-refresh");
    expect(String(init.body)).toContain("client_secret=secret");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: record.id,
      credential: expect.objectContaining({ accessToken: "fresh-token", refreshToken: "rotated-refresh" }),
    }));
  });

  it("fails closed without persisting when the refresh request is rejected", async () => {
    const record = refreshableRecord();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const upsert = vi.fn(async () => undefined);
    const runtime = refreshRuntime(fetchMock, upsert, record);

    await expect(getOfficialAccount(runtime, record.id)).rejects.toThrow("自动续期失败，请重新登录");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refreshes an expired account through listAccounts and reports it online", async () => {
    const record = refreshableRecord({ platform: "twitter" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 7200 })));
    const upsert = vi.fn(async () => undefined);
    const runtime = refreshRuntime(fetchMock, upsert, record, "twitter");

    await expect(listOfficialAccounts(runtime)).resolves.toEqual([
      { accountId: record.id, displayName: record.displayName, status: "online" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twitter.com/2/oauth2/token");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("client:secret").toString("base64")}`);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent refreshes for the same account", async () => {
    const record = refreshableRecord();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh-token", refresh_token: "rotated-refresh", expires_in: 3600 })));
    const runtime = refreshRuntime(fetchMock, vi.fn(async () => undefined), record);

    const [first, second] = await Promise.all([
      getOfficialAccount(runtime, record.id),
      getOfficialAccount(runtime, record.id),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(first.credential.accessToken).toBe("fresh-token");
    expect(second.credential.accessToken).toBe("fresh-token");
  });
});
