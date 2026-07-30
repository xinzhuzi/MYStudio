import type { PlatformAdapterTransport, PlatformPublishRequest } from "../platform-adapter";
import { assertOAuthCallback, createOAuthState } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  requestJson,
  requireHttpsAssetUrl,
  requireProviderAccountId,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

export function createInstagramTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  const api = "https://graph.instagram.com/v20.0";
  return {
    authenticate: async () => {
      if (!runtime.config.clientSecret) throw new Error("Instagram client secret 未配置");
      const state = createOAuthState();
      const authorizeUrl = new URL("https://www.instagram.com/oauth/authorize");
      authorizeUrl.search = new URLSearchParams({
        client_id: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        scope: runtime.config.scopes.join(","),
        state,
        response_type: "code",
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "instagram", authorizationUrl: authorizeUrl.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const shortToken = await requestJson<{ access_token?: string }>(runtime, "https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: runtime.config.clientId,
          client_secret: runtime.config.clientSecret,
          grant_type: "authorization_code",
          redirect_uri: runtime.config.redirectUri,
          code: callback.searchParams.get("code") ?? "",
        }),
      });
      if (!shortToken.access_token) throw new Error("Instagram access token 缺失");
      const longTokenUrl = new URL("https://graph.instagram.com/access_token");
      longTokenUrl.search = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: runtime.config.clientSecret, access_token: shortToken.access_token }).toString();
      const longToken = await requestJson<{ access_token?: string; expires_in?: number }>(runtime, longTokenUrl.toString());
      const accessToken = longToken.access_token ?? shortToken.access_token;
      const profileUrl = new URL(`${api}/me`);
      profileUrl.search = new URLSearchParams({ fields: "id,user_id,username,name,profile_picture_url", access_token: accessToken }).toString();
      const profile = await requestJson<{ id?: string; user_id?: string; username?: string; name?: string; profile_picture_url?: string }>(runtime, profileUrl.toString());
      const providerAccountId = profile.user_id ?? profile.id;
      if (!providerAccountId) throw new Error("Instagram 用户信息缺失");
      await saveOfficialAccount(runtime, {
        providerAccountId,
        displayName: profile.name ?? profile.username ?? providerAccountId,
        avatarUrl: profile.profile_picture_url,
        credential: {
          kind: "oauth",
          accessToken,
          expiresAt: longToken.expires_in ? new Date(runtime.now().getTime() + longToken.expires_in * 1000).toISOString() : undefined,
        },
      });
      return { authenticated: true };
    },
    listAccounts: () => listOfficialAccounts(runtime),
    publish: async (request: PlatformPublishRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const userId = requireProviderAccountId(account);
      const asset = request.assets.find((item) => item.kind === (request.contentType === "video" ? "video" : "image"));
      if (!asset) throw new Error("Instagram 发布资产缺失");
      const url = new URL(`${api}/${encodeURIComponent(userId)}/media`);
      url.searchParams.set("access_token", account.credential.accessToken);
      url.searchParams.set(request.contentType === "video" ? "video_url" : "image_url", requireHttpsAssetUrl(asset.url));
      url.searchParams.set("media_type", request.contentType === "video" ? "REELS" : "IMAGE");
      url.searchParams.set("caption", [request.title, request.description, ...(request.topics ?? [])].filter(Boolean).join("\n"));
      if (request.cover) url.searchParams.set("cover_url", requireHttpsAssetUrl(request.cover.url));
      const created = await requestJson<{ id?: string }>(runtime, url.toString(), { method: "POST" });
      if (!created.id) throw new Error("Instagram 媒体容器 ID 缺失");
      return { taskId: created.id, providerTaskId: created.id, status: "running", progress: 50 };
    },
    poll: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const statusUrl = new URL(`${api}/${encodeURIComponent(request.taskId)}`);
      statusUrl.search = new URLSearchParams({ fields: "status_code,status", access_token: account.credential.accessToken }).toString();
      const status = await requestJson<{ status_code?: string; status?: string }>(runtime, statusUrl.toString());
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
        return { taskId: request.taskId, providerTaskId: request.taskId, status: "failure", progress: 100, error: { code: "instagram-container-failed", message: status.status ?? "Instagram 媒体处理失败", retryable: false } };
      }
      if (status.status_code !== "FINISHED") return { taskId: request.taskId, providerTaskId: request.taskId, status: "running", progress: 75 };
      const userId = requireProviderAccountId(account);
      const publishUrl = new URL(`${api}/${encodeURIComponent(userId)}/media_publish`);
      publishUrl.search = new URLSearchParams({ creation_id: request.taskId, access_token: account.credential.accessToken }).toString();
      const published = await requestJson<{ id?: string }>(runtime, publishUrl.toString(), { method: "POST" });
      if (!published.id) throw new Error("Instagram 发布媒体 ID 缺失");
      const infoUrl = new URL(`${api}/${encodeURIComponent(published.id)}`);
      infoUrl.search = new URLSearchParams({ fields: "permalink", access_token: account.credential.accessToken }).toString();
      const info = await requestJson<{ permalink?: string }>(runtime, infoUrl.toString());
      return { taskId: request.taskId, providerTaskId: published.id, status: "success", progress: 100, ...(info.permalink ? { resultUrl: info.permalink } : {}) };
    },
    cancel: async () => { throw new Error("Instagram 不支持取消尚未发布的媒体容器"); },
  };
}
