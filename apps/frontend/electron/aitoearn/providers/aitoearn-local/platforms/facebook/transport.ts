import type { PlatformAdapterTransport, PlatformPublishRequest, PlatformTaskInput } from "../platform-adapter";
import { assertOAuthCallback, createOAuthState } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  requireHttpsAssetUrl,
  requireProviderAccountId,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

export function createFacebookTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  const graph = "https://graph.facebook.com/v20.0";
  return {
    authenticate: async () => {
      if (!runtime.config.clientSecret) throw new Error("Facebook client secret 未配置");
      const state = createOAuthState();
      const authorizeUrl = new URL("https://www.facebook.com/v20.0/dialog/oauth");
      authorizeUrl.search = new URLSearchParams({
        client_id: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        scope: runtime.config.scopes.join(","),
        state,
        response_type: "code",
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "facebook", authorizationUrl: authorizeUrl.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const tokenUrl = new URL(`${graph}/oauth/access_token`);
      tokenUrl.search = new URLSearchParams({
        client_id: runtime.config.clientId,
        client_secret: runtime.config.clientSecret,
        redirect_uri: runtime.config.redirectUri,
        code: callback.searchParams.get("code") ?? "",
      }).toString();
      const shortToken = await requestJson<{ access_token?: string }>(runtime, tokenUrl.toString());
      if (!shortToken.access_token) throw new Error("Facebook access token 缺失");
      const longTokenUrl = new URL(`${graph}/oauth/access_token`);
      longTokenUrl.search = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: runtime.config.clientId,
        client_secret: runtime.config.clientSecret,
        fb_exchange_token: shortToken.access_token,
      }).toString();
      const longToken = await requestJson<{ access_token?: string; expires_in?: number }>(runtime, longTokenUrl.toString());
      const accessToken = longToken.access_token ?? shortToken.access_token;
      const pagesUrl = new URL(`${graph}/me/accounts`);
      pagesUrl.search = new URLSearchParams({ fields: "id,name,access_token,picture", access_token: accessToken }).toString();
      const pages = await requestJson<{ data?: Array<{ id?: string; name?: string; access_token?: string; picture?: { data?: { url?: string } } }> }>(runtime, pagesUrl.toString());
      if (!pages.data?.length) throw new Error("Facebook 未返回可发布主页");
      for (const page of pages.data) {
        if (!page.id || !page.access_token) continue;
        await saveOfficialAccount(runtime, {
          providerAccountId: page.id,
          displayName: page.name ?? page.id,
          avatarUrl: page.picture?.data?.url,
          credential: {
            kind: "oauth",
            accessToken: page.access_token,
            expiresAt: longToken.expires_in ? new Date(runtime.now().getTime() + longToken.expires_in * 1000).toISOString() : undefined,
          },
        });
      }
      return { authenticated: true };
    },
    listAccounts: () => listOfficialAccounts(runtime),
    publish: async (request: PlatformPublishRequest): Promise<PlatformTaskInput> => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const pageId = requireProviderAccountId(account);
      let taskId: string | undefined;
      if (request.contentType === "video") {
        const video = request.assets.find((asset) => asset.kind === "video");
        if (!video) throw new Error("Facebook 视频资产缺失");
        const asset = await readOfficialAsset(runtime, video.url);
        const form = new FormData();
        const bytes = asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer;
        form.append("source", new Blob([bytes], { type: asset.contentType }), asset.filename);
        form.append("title", request.title ?? "");
        form.append("description", request.description ?? "");
        form.append("access_token", account.credential.accessToken);
        const response = await runtime.fetch(`${graph}/${encodeURIComponent(pageId)}/videos`, { method: "POST", body: form });
        if (!response.ok) throw new Error(`Facebook 视频上传失败 (${response.status})`);
        taskId = ((await response.json()) as { id?: string }).id;
      } else {
        const image = request.assets.find((asset) => asset.kind === "image");
        const endpoint = image ? "photos" : "feed";
        const url = new URL(`${graph}/${encodeURIComponent(pageId)}/${endpoint}`);
        url.searchParams.set("access_token", account.credential.accessToken);
        url.searchParams.set("message", request.description ?? request.title ?? "");
        if (image) url.searchParams.set("url", requireHttpsAssetUrl(image.url));
        const result = await requestJson<{ id?: string; post_id?: string }>(runtime, url.toString(), { method: "POST" });
        taskId = result.post_id ?? result.id;
      }
      if (!taskId) throw new Error("Facebook 帖子 ID 缺失");
      return { taskId, status: request.contentType === "video" ? "running" : "success", progress: request.contentType === "video" ? 75 : 100, providerTaskId: taskId };
    },
    poll: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const url = new URL(`${graph}/${encodeURIComponent(request.taskId)}`);
      url.search = new URLSearchParams({ fields: "id,status,permalink_url", access_token: account.credential.accessToken }).toString();
      const result = await requestJson<{ id?: string; permalink_url?: string; status?: { video_status?: string } }>(runtime, url.toString());
      if (!result.id) throw new Error("Facebook 发布任务不存在");
      const videoStatus = result.status?.video_status?.toLowerCase();
      if (videoStatus?.includes("error")) {
        return { taskId: request.taskId, providerTaskId: request.taskId, status: "failure", progress: 100, error: { code: "facebook-video-failed", message: "Facebook 视频处理失败", retryable: false } };
      }
      const done = !videoStatus || videoStatus === "ready" || videoStatus === "published" || videoStatus === "complete";
      return { taskId: request.taskId, providerTaskId: request.taskId, status: done ? "success" : "running", progress: done ? 100 : 90, ...(result.permalink_url ? { resultUrl: result.permalink_url } : {}) };
    },
    cancel: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const url = new URL(`${graph}/${encodeURIComponent(request.taskId)}`);
      url.searchParams.set("access_token", account.credential.accessToken);
      const response = await runtime.fetch(url, { method: "DELETE" });
      if (!response.ok) throw new Error(`Facebook 帖子删除失败 (${response.status})`);
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "canceled", progress: 100 };
    },
  };
}
