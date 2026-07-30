import type { PlatformAdapterTransport, PlatformPublishRequest, PlatformTaskRequest } from "../platform-adapter";
import { assertOAuthCallback, createOAuthState, createPkcePair } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

const API = "https://www.googleapis.com/youtube/v3";

function privacy(request: PlatformPublishRequest): "private" | "public" | "unlisted" {
  if (request.scheduledAt || request.visibility === "private") return "private";
  return request.visibility === "friends" ? "unlisted" : "public";
}

export function createYoutubeTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      const pkce = createPkcePair();
      const state = createOAuthState();
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        response_type: "code",
        scope: runtime.config.scopes.join(" "),
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "youtube", authorizationUrl: url.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const token = await requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(runtime, "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: runtime.config.clientId,
          client_secret: runtime.config.clientSecret ?? "",
          code: callback.searchParams.get("code") ?? "",
          grant_type: "authorization_code",
          redirect_uri: runtime.config.redirectUri,
          code_verifier: pkce.verifier,
        }),
      });
      const channels = await requestJson<{ items?: Array<{ id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }> }>(
        runtime,
        `${API}/channels?part=snippet&mine=true`,
        { headers: { authorization: `Bearer ${token.access_token}` } },
      );
      if (!channels.items?.length) throw new Error("YouTube 频道信息缺失");
      for (const channel of channels.items) {
        await saveOfficialAccount(runtime, {
          providerAccountId: channel.id,
          displayName: channel.snippet?.title ?? channel.id,
          avatarUrl: channel.snippet?.thumbnails?.default?.url,
          credential: {
            kind: "oauth",
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: token.expires_in ? new Date(runtime.now().getTime() + token.expires_in * 1000).toISOString() : undefined,
            scope: token.scope,
          },
        });
      }
      return { authenticated: true };
    },
    listAccounts: () => listOfficialAccounts(runtime),
    publish: async (request: PlatformPublishRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const video = request.assets.find((asset) => asset.kind === "video");
      if (!video) throw new Error("YouTube 视频资产缺失");
      const asset = await readOfficialAsset(runtime, video.url);
      const initUrl = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
      initUrl.search = new URLSearchParams({ uploadType: "resumable", part: "snippet,status", notifySubscribers: "false" }).toString();
      const init = await runtime.fetch(initUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${account.credential.accessToken}`,
          "content-type": "application/json",
          "x-upload-content-length": String(asset.bytes.byteLength),
          "x-upload-content-type": asset.contentType,
        },
        body: JSON.stringify({
          snippet: {
            title: request.title?.trim() || "Untitled",
            description: request.description ?? "",
            tags: request.topics ?? [],
            categoryId: "22",
          },
          status: {
            privacyStatus: privacy(request),
            ...(request.scheduledAt ? { publishAt: request.scheduledAt } : {}),
          },
        }),
      });
      if (!init.ok) throw new Error(`YouTube 上传初始化失败 (${init.status})`);
      const uploadUrl = init.headers.get("location");
      if (!uploadUrl) throw new Error("YouTube 上传地址缺失");
      const uploaded = await runtime.fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": asset.contentType, "content-length": String(asset.bytes.byteLength) },
        body: asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer,
      });
      if (!uploaded.ok) throw new Error(`YouTube 视频上传失败 (${uploaded.status})`);
      const result = await uploaded.json() as { id?: string };
      if (!result.id) throw new Error("YouTube 视频 ID 缺失");
      return {
        taskId: result.id,
        providerTaskId: result.id,
        status: "success",
        progress: 100,
        resultUrl: `https://www.youtube.com/watch?v=${result.id}`,
      };
    },
    poll: async (request: PlatformTaskRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const result = await requestJson<{ items?: Array<{ id: string; status?: { uploadStatus?: string; failureReason?: string } }> }>(
        runtime,
        `${API}/videos?part=status&id=${encodeURIComponent(request.taskId)}`,
        { headers: { authorization: `Bearer ${account.credential.accessToken}` } },
      );
      const video = result.items?.[0];
      if (!video) throw new Error("YouTube 视频任务不存在");
      if (video.status?.uploadStatus === "failed" || video.status?.uploadStatus === "rejected") {
        return {
          taskId: request.taskId,
          providerTaskId: request.taskId,
          status: "failure",
          progress: 100,
          error: { code: "youtube-upload-failed", message: video.status.failureReason ?? "YouTube 上传失败", retryable: false },
        };
      }
      const done = video.status?.uploadStatus === "uploaded" || video.status?.uploadStatus === "processed";
      return { taskId: request.taskId, providerTaskId: request.taskId, status: done ? "success" : "running", progress: done ? 100 : 75 };
    },
    cancel: async (request: PlatformTaskRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const response = await runtime.fetch(`${API}/videos?id=${encodeURIComponent(request.taskId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (!response.ok) throw new Error(`YouTube 视频删除失败 (${response.status})`);
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "canceled", progress: 100 };
    },
  };
}
