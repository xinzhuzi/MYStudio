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

const API = "https://api.x.com/2";

function text(request: PlatformPublishRequest): string {
  const value = [request.title, request.description, ...(request.topics ?? []).map((topic) => topic.startsWith("#") ? topic : `#${topic}`)]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!value) throw new Error("X（Twitter）发布内容不能为空");
  return value;
}

async function uploadMedia(runtime: OfficialTransportRuntime, accessToken: string, request: PlatformPublishRequest): Promise<string[]> {
  const mediaIds: string[] = [];
  for (const item of request.assets) {
    const asset = await readOfficialAsset(runtime, item.url);
    const initialized = await requestJson<{ data?: { id?: string } }>(runtime, `${API}/media/upload/initialize`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        media_type: asset.contentType,
        total_bytes: asset.bytes.byteLength,
        media_category: item.kind === "video" ? "tweet_video" : "tweet_image",
      }),
    });
    const mediaId = initialized.data?.id;
    if (!mediaId) throw new Error("X（Twitter）媒体 ID 缺失");
    const form = new FormData();
    form.append("segment_index", "0");
    const mediaBody = asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer;
    form.append("media", new Blob([mediaBody], { type: asset.contentType }), asset.filename);
    const append = await runtime.fetch(`${API}/media/upload/${encodeURIComponent(mediaId)}/append`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: form,
    });
    if (!append.ok) throw new Error(`X（Twitter）媒体上传失败 (${append.status})`);
    const finalized = await requestJson<{ data?: { id?: string; processing_info?: { state?: string; error?: { message?: string } } } }>(
      runtime,
      `${API}/media/upload/finalize`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ id: mediaId }),
      },
    );
    if (finalized.data?.processing_info?.state === "failed") {
      throw new Error(finalized.data.processing_info.error?.message ?? "X（Twitter）媒体处理失败");
    }
    mediaIds.push(finalized.data?.id ?? mediaId);
  }
  return mediaIds;
}

export function createTwitterTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      const pkce = createPkcePair();
      const state = createOAuthState();
      const url = new URL("https://twitter.com/i/oauth2/authorize");
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        scope: runtime.config.scopes.join(" "),
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "twitter", authorizationUrl: url.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const tokenHeaders: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      if (runtime.config.clientSecret) {
        tokenHeaders.authorization = `Basic ${Buffer.from(`${runtime.config.clientId}:${runtime.config.clientSecret}`).toString("base64")}`;
      }
      const token = await requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(runtime, `${API}/oauth2/token`, {
        method: "POST",
        headers: tokenHeaders,
        body: new URLSearchParams({
          code: callback.searchParams.get("code") ?? "",
          grant_type: "authorization_code",
          client_id: runtime.config.clientId,
          redirect_uri: runtime.config.redirectUri,
          code_verifier: pkce.verifier,
        }),
      });
      const profile = await requestJson<{ data?: { id?: string; name?: string; username?: string; profile_image_url?: string } }>(
        runtime,
        `${API}/users/me?user.fields=profile_image_url`,
        { headers: { authorization: `Bearer ${token.access_token}` } },
      );
      if (!profile.data?.id) throw new Error("X（Twitter）用户信息缺失");
      await saveOfficialAccount(runtime, {
        providerAccountId: profile.data.id,
        displayName: profile.data.name ?? profile.data.username ?? profile.data.id,
        avatarUrl: profile.data.profile_image_url,
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
      const mediaIds = await uploadMedia(runtime, account.credential.accessToken, request);
      const created = await requestJson<{ data?: { id?: string } }>(runtime, `${API}/tweets`, {
        method: "POST",
        headers: { authorization: `Bearer ${account.credential.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ text: text(request), ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
      });
      const taskId = created.data?.id;
      if (!taskId) throw new Error("X（Twitter）帖子 ID 缺失");
      return { taskId, providerTaskId: taskId, status: "success", progress: 100, resultUrl: `https://x.com/i/status/${taskId}` };
    },
    poll: async (request: PlatformTaskRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const result = await requestJson<{ data?: { id?: string } }>(runtime, `${API}/tweets/${encodeURIComponent(request.taskId)}`, {
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (!result.data?.id) throw new Error("X（Twitter）帖子不存在");
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "success", progress: 100, resultUrl: `https://x.com/i/status/${request.taskId}` };
    },
    cancel: async (request: PlatformTaskRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const response = await runtime.fetch(`${API}/tweets/${encodeURIComponent(request.taskId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (!response.ok) throw new Error(`X（Twitter）帖子删除失败 (${response.status})`);
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "canceled", progress: 100 };
    },
  };
}
