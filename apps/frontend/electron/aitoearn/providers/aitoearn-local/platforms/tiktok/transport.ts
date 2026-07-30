import type {
  PlatformAdapterTransport,
  PlatformPublishRequest,
  PlatformTaskInput,
  PlatformTaskRequest,
} from "../platform-adapter";
import { assertOAuthCallback, createOAuthState, createPkcePair } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  requireHttpsAssetUrl,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

const API = "https://open.tiktokapis.com/v2";
const SINGLE_CHUNK_LIMIT = 64 * 1024 * 1024;
const MULTI_CHUNK_SIZE = 10 * 1024 * 1024;

function bearer(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" };
}

function caption(request: PlatformPublishRequest): string {
  return [request.title, request.description, ...(request.topics ?? []).map((topic) => topic.startsWith("#") ? topic : `#${topic}`)]
    .filter(Boolean)
    .join("\n");
}

function mapStatus(taskId: string, status?: string): PlatformTaskInput {
  if (status === "PUBLISH_COMPLETE") return { taskId, providerTaskId: taskId, status: "success", progress: 100 };
  if (status === "FAILED") {
    return {
      taskId,
      providerTaskId: taskId,
      status: "failure",
      progress: 100,
      error: { code: "tiktok-publish-failed", message: "TikTok 发布失败", retryable: false },
    };
  }
  return { taskId, providerTaskId: taskId, status: "running", progress: 50 };
}

export function createTiktokTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      const pkce = createPkcePair();
      const state = createOAuthState();
      const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
      url.search = new URLSearchParams({
        client_key: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        response_type: "code",
        scope: runtime.config.scopes.join(","),
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "tiktok", authorizationUrl: url.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const token = await requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; open_id?: string; scope?: string }>(
        runtime,
        `${API}/oauth/token/`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: runtime.config.clientId,
            client_secret: runtime.config.clientSecret ?? "",
            code: callback.searchParams.get("code") ?? "",
            grant_type: "authorization_code",
            redirect_uri: runtime.config.redirectUri,
            code_verifier: pkce.verifier,
          }),
        },
      );
      const me = await requestJson<{ data?: { user?: { open_id: string; display_name: string; avatar_url?: string } } }>(
        runtime,
        `${API}/user/info/?fields=open_id,display_name,avatar_url`,
        { headers: { authorization: `Bearer ${token.access_token}` } },
      );
      const user = me.data?.user;
      if (!user?.open_id) throw new Error("TikTok 用户信息缺失");
      await saveOfficialAccount(runtime, {
        providerAccountId: user.open_id,
        displayName: user.display_name || user.open_id,
        avatarUrl: user.avatar_url,
        credential: {
          kind: "oauth",
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: token.expires_in ? new Date(runtime.now().getTime() + token.expires_in * 1000).toISOString() : undefined,
          scope: token.scope,
        },
      });
      return { authenticated: true };
    },
    listAccounts: () => listOfficialAccounts(runtime),
    publish: async (request: PlatformPublishRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      if (request.contentType === "image-text") {
        const images = request.assets.filter((asset) => asset.kind === "image").map((asset) => requireHttpsAssetUrl(asset.url));
        if (images.length === 0) throw new Error("TikTok 图文发布至少需要一张 HTTPS 图片");
        const result = await requestJson<{ data?: { publish_id?: string } }>(runtime, `${API}/post/publish/content/init/`, {
          method: "POST",
          headers: bearer(account.credential.accessToken),
          body: JSON.stringify({
            media_type: "PHOTO",
            post_mode: "DIRECT_POST",
            post_info: {
              title: request.title,
              description: caption(request),
              privacy_level: request.visibility === "private" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE",
            },
            source_info: { source: "PULL_FROM_URL", photo_images: images, photo_cover_index: 0 },
          }),
        });
        const taskId = result.data?.publish_id;
        if (!taskId) throw new Error("TikTok 发布任务 ID 缺失");
        return { taskId, providerTaskId: taskId, status: "running", progress: 10 };
      }

      const video = request.assets.find((asset) => asset.kind === "video");
      if (!video) throw new Error("TikTok 视频资产缺失");
      const asset = await readOfficialAsset(runtime, video.url);
      const chunkSize = asset.bytes.byteLength <= SINGLE_CHUNK_LIMIT ? asset.bytes.byteLength : MULTI_CHUNK_SIZE;
      const totalChunkCount = Math.ceil(asset.bytes.byteLength / chunkSize);
      const result = await requestJson<{ data?: { publish_id?: string; upload_url?: string } }>(runtime, `${API}/post/publish/video/init/`, {
        method: "POST",
        headers: bearer(account.credential.accessToken),
        body: JSON.stringify({
          post_info: {
            title: caption(request),
            privacy_level: request.visibility === "private" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE",
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: asset.bytes.byteLength,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
          },
        }),
      });
      const taskId = result.data?.publish_id;
      const uploadUrl = result.data?.upload_url;
      if (!taskId || !uploadUrl) throw new Error("TikTok 上传地址或发布任务 ID 缺失");
      for (let index = 0; index < totalChunkCount; index += 1) {
        const start = index * chunkSize;
        const end = Math.min(asset.bytes.byteLength, start + chunkSize);
        const response = await runtime.fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": asset.contentType,
            "content-length": String(end - start),
            "content-range": `bytes ${start}-${end - 1}/${asset.bytes.byteLength}`,
          },
          body: asset.bytes.slice(start, end),
        });
        if (!response.ok) throw new Error(`TikTok 视频上传失败 (${response.status})`);
      }
      return { taskId, providerTaskId: taskId, status: "running", progress: 25 };
    },
    poll: async (request: PlatformTaskRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const result = await requestJson<{ data?: { status?: string } }>(runtime, `${API}/post/publish/status/fetch/`, {
        method: "POST",
        headers: bearer(account.credential.accessToken),
        body: JSON.stringify({ publish_id: request.taskId }),
      });
      return mapStatus(request.taskId, result.data?.status);
    },
    cancel: async (request: PlatformTaskRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      await requestJson(runtime, `${API}/post/publish/cancel/`, {
        method: "POST",
        headers: bearer(account.credential.accessToken),
        body: JSON.stringify({ publish_id: request.taskId }),
      });
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "canceled", progress: 100 };
    },
  };
}
