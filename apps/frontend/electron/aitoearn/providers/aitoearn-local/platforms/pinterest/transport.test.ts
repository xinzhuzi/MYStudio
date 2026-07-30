import { describe, expect, it, vi } from "vitest";
import type { LocalAccountRecord, LocalAccountVault } from "../../../../local-account-vault";
import type { OfficialTransportRuntime } from "../official/transport-runtime";
import { withMemoryAccountVault } from "../official/transport-test-helpers";
import { createPinterestTransport } from "./transport";

function createFetchMock() { return vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(); }
function createRuntime(fetchMock: ReturnType<typeof createFetchMock>): OfficialTransportRuntime {
  const account: LocalAccountRecord = { id: "aitoearn-local:pinterest:account-1", platform: "pinterest", providerAccountId: "user-1", displayName: "Pinterest", credential: { kind: "oauth", accessToken: "token-1", expiresAt: "2026-07-28T00:00:00.000Z" }, updatedAt: "2026-07-27T00:00:00.000Z" };
  return {
    config: { platformId: "pinterest", clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://localhost/oauth/pinterest", scopes: ["pins:write"] },
    vault: { get: vi.fn(async () => account), list: vi.fn(async () => []) } as unknown as LocalAccountVault,
    fetch: fetchMock as unknown as typeof fetch,
    authorize: vi.fn(),
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  };
}

describe("Pinterest official transport", () => {
  it("authenticates through the official endpoints and lists the saved account", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "auth-token", refresh_token: "refresh-1", expires_in: 7200, scope: "pins:write" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "user-auth", business_name: "Pinterest Auth", profile_image: "https://avatar.test/pinterest.png" })));
    const { runtime, records } = withMemoryAccountVault(createRuntime(fetchMock));
    const transport = createPinterestTransport(runtime);

    await expect(transport.authenticate()).resolves.toEqual({ authenticated: true });
    const [account] = [...records.values()];
    expect(account).toMatchObject({ platform: "pinterest", providerAccountId: "user-auth", displayName: "Pinterest Auth", credential: { kind: "oauth", accessToken: "auth-token", refreshToken: "refresh-1", expiresAt: "2026-07-27T02:00:00.000Z" } });
    await expect(transport.listAccounts()).resolves.toEqual([{ accountId: account?.id, displayName: "Pinterest Auth", avatarUrl: "https://avatar.test/pinterest.png", status: "online" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.pinterest.com/v5/oauth/token",
      "https://api.pinterest.com/v5/user_account",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
      },
    });
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("code=code-1");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer auth-token" });
  });

  it("requires a board and creates/deletes a Pin with the v5 contract", async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pin-1" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const transport = createPinterestTransport(createRuntime(fetchMock));
    await expect(transport.publish({
      accountId: "aitoearn-local:pinterest:account-1",
      contentType: "image-text",
      assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }],
      title: "Pin title",
      options: { boardId: "board-1" },
    })).resolves.toMatchObject({ taskId: "pin-1", status: "success", resultUrl: "https://www.pinterest.com/pin/pin-1" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      board_id: "board-1",
      media_source: { source_type: "image_url", url: "https://assets.test/image.png" },
    });
    await expect(transport.cancel({ accountId: "aitoearn-local:pinterest:account-1", taskId: "pin-1" }))
      .resolves.toMatchObject({ status: "canceled" });
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("fails before network when boardId is missing", async () => {
    const transport = createPinterestTransport(createRuntime(createFetchMock()));
    await expect(transport.publish({ accountId: "aitoearn-local:pinterest:account-1", contentType: "image-text", assets: [{ assetId: "image-1", kind: "image", url: "https://assets.test/image.png" }] }))
      .rejects.toThrow("画板 ID");
  });
});
