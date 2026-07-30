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

const API = "https://graph.threads.net";

function postText(request: PlatformPublishRequest): string {
  return [request.title, request.description, ...(request.topics ?? []).map((topic) => topic.startsWith("#") ? topic : `#${topic}`)]
    .filter(Boolean)
    .join("\n");
}

export function createThreadsTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      if (!runtime.config.clientSecret) throw new Error("Threads client secret 未配置");
      const state = createOAuthState();
      const authorizeUrl = new URL("https://threads.net/oauth/authorize");
      authorizeUrl.search = new URLSearchParams({
        client_id: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        scope: runtime.config.scopes.join(","),
        response_type: "code",
        state,
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "threads", authorizationUrl: authorizeUrl.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const shortToken = await requestJson<{ access_token?: string; expires_in?: number }>(runtime, `${API}/oauth/access_token`, {
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
      if (!shortToken.access_token) throw new Error("Threads access token 缺失");
      const longTokenUrl = new URL(`${API}/access_token`);
      longTokenUrl.search = new URLSearchParams({ grant_type: "th_exchange_token", client_secret: runtime.config.clientSecret, access_token: shortToken.access_token }).toString();
      const longToken = await requestJson<{ access_token?: string; expires_in?: number }>(runtime, longTokenUrl.toString());
      const accessToken = longToken.access_token ?? shortToken.access_token;
      const profileUrl = new URL(`${API}/me`);
      profileUrl.searchParams.set("fields", "id,username,name,threads_profile_picture_url");
      const profile = await requestJson<{ id?: string; username?: string; name?: string; threads_profile_picture_url?: string }>(runtime, profileUrl.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!profile.id) throw new Error("Threads 用户信息缺失");
      await saveOfficialAccount(runtime, {
        providerAccountId: profile.id,
        displayName: profile.name ?? profile.username ?? profile.id,
        avatarUrl: profile.threads_profile_picture_url,
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
      const form = new FormData();
      form.append("text", postText(request));
      if (request.contentType === "video") {
        const video = request.assets.find((asset) => asset.kind === "video");
        if (!video) throw new Error("Threads 视频资产缺失");
        form.append("media_type", "VIDEO");
        form.append("video_url", requireHttpsAssetUrl(video.url));
      } else {
        const image = request.assets.find((asset) => asset.kind === "image");
        if (!image) throw new Error("Threads 图片资产缺失");
        form.append("media_type", "IMAGE");
        form.append("image_url", requireHttpsAssetUrl(image.url));
      }
      const created = await requestJson<{ id?: string }>(runtime, `${API}/${encodeURIComponent(userId)}/threads`, {
        method: "POST",
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
        body: form,
      });
      if (!created.id) throw new Error("Threads 媒体容器 ID 缺失");
      return { taskId: created.id, providerTaskId: created.id, status: "running", progress: 50 };
    },
    poll: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const statusUrl = new URL(`${API}/${encodeURIComponent(request.taskId)}`);
      statusUrl.searchParams.set("fields", "id,status");
      const status = await requestJson<{ id?: string; status?: string }>(runtime, statusUrl.toString(), {
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (status.status === "ERROR" || status.status === "EXPIRED") {
        return { taskId: request.taskId, providerTaskId: request.taskId, status: "failure", progress: 100, error: { code: "threads-container-failed", message: "Threads 媒体处理失败", retryable: false } };
      }
      if (status.status !== "FINISHED") return { taskId: request.taskId, providerTaskId: request.taskId, status: "running", progress: 75 };
      const userId = requireProviderAccountId(account);
      const publishUrl = new URL(`${API}/${encodeURIComponent(userId)}/threads_publish`);
      publishUrl.searchParams.set("creation_id", request.taskId);
      const published = await requestJson<{ id?: string }>(runtime, publishUrl.toString(), {
        method: "POST",
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (!published.id) throw new Error("Threads 帖子 ID 缺失");
      const infoUrl = new URL(`${API}/${encodeURIComponent(published.id)}`);
      infoUrl.searchParams.set("fields", "id,status,permalink");
      const info = await requestJson<{ permalink?: string }>(runtime, infoUrl.toString(), {
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      return { taskId: request.taskId, providerTaskId: published.id, status: "success", progress: 100, ...(info.permalink ? { resultUrl: info.permalink } : {}) };
    },
    cancel: async () => { throw new Error("Threads 不支持取消尚未发布的媒体容器"); },
  };
}
