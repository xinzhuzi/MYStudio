import type { PlatformAdapterTransport, PlatformPublishRequest } from "../platform-adapter";
import { assertOAuthCallback, createOAuthState } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

const API = "https://api.pinterest.com/v5";

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function createPinterestTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      if (!runtime.config.clientSecret) throw new Error("Pinterest client secret 未配置");
      const state = createOAuthState();
      const authorizeUrl = new URL("https://www.pinterest.com/oauth/");
      authorizeUrl.search = new URLSearchParams({
        client_id: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        scope: runtime.config.scopes.join(","),
        state,
        response_type: "code",
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "pinterest", authorizationUrl: authorizeUrl.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const token = await requestJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>(runtime, `${API}/oauth/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${runtime.config.clientId}:${runtime.config.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: callback.searchParams.get("code") ?? "",
          redirect_uri: runtime.config.redirectUri,
          continuous_refresh: "true",
        }),
      });
      if (!token.access_token) throw new Error("Pinterest access token 缺失");
      const profile = await requestJson<{ id?: string; business_name?: string; username?: string; profile_image?: string }>(runtime, `${API}/user_account`, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!profile.id) throw new Error("Pinterest 用户信息缺失");
      await saveOfficialAccount(runtime, {
        providerAccountId: profile.id,
        displayName: profile.business_name ?? profile.username ?? profile.id,
        avatarUrl: profile.profile_image,
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
      const boardId = typeof request.options?.boardId === "string" ? request.options.boardId.trim() : "";
      if (!boardId) throw new Error("Pinterest 发布需要画板 ID（boardId）");
      const media = request.assets[0];
      if (!media) throw new Error("Pinterest 发布资产缺失");
      let mediaSource: Record<string, string>;
      if (media.kind === "video") {
        const asset = await readOfficialAsset(runtime, media.url);
        const upload = await requestJson<{ media_id?: string; upload_url?: string; upload_parameters?: Record<string, string> }>(runtime, `${API}/media`, {
          method: "POST",
          headers: { authorization: `Bearer ${account.credential.accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ media_type: "video" }),
        });
        if (!upload.media_id || !upload.upload_url || !upload.upload_parameters) throw new Error("Pinterest 视频上传参数缺失");
        const form = new FormData();
        for (const [key, value] of Object.entries(upload.upload_parameters)) form.append(key, value);
        const bytes = asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer;
        form.append("file", new Blob([bytes], { type: asset.contentType }), asset.filename);
        const uploaded = await runtime.fetch(upload.upload_url, { method: "POST", body: form });
        if (!uploaded.ok) throw new Error(`Pinterest 视频上传失败 (${uploaded.status})`);
        let succeeded = false;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const status = await requestJson<{ status?: string }>(runtime, `${API}/media/${encodeURIComponent(upload.media_id)}`, {
            headers: { authorization: `Bearer ${account.credential.accessToken}` },
          });
          if (status.status === "failed") throw new Error("Pinterest 视频处理失败");
          if (status.status === "succeeded") { succeeded = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
        if (!succeeded) throw new Error("Pinterest 视频处理超时");
        mediaSource = { source_type: "video_id", media_id: upload.media_id };
        if (request.cover) mediaSource.cover_image_url = httpsUrl(request.cover.url) ?? "";
      } else {
        const publicUrl = httpsUrl(media.url);
        if (publicUrl) {
          mediaSource = { source_type: "image_url", url: publicUrl };
        } else {
          const asset = await readOfficialAsset(runtime, media.url);
          mediaSource = { source_type: "image_base64", content_type: asset.contentType, data: Buffer.from(asset.bytes).toString("base64") };
        }
      }
      const pin = await requestJson<{ id?: string }>(runtime, `${API}/pins`, {
        method: "POST",
        headers: { authorization: `Bearer ${account.credential.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ board_id: boardId, title: request.title, description: request.description, media_source: mediaSource }),
      });
      if (!pin.id) throw new Error("Pinterest Pin ID 缺失");
      return { taskId: pin.id, providerTaskId: pin.id, status: "success", progress: 100, resultUrl: `https://www.pinterest.com/pin/${pin.id}` };
    },
    poll: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const pin = await requestJson<{ id?: string }>(runtime, `${API}/pins/${encodeURIComponent(request.taskId)}`, {
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (!pin.id) throw new Error("Pinterest Pin 不存在");
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "success", progress: 100, resultUrl: `https://www.pinterest.com/pin/${request.taskId}` };
    },
    cancel: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const response = await runtime.fetch(`${API}/pins/${encodeURIComponent(request.taskId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (!response.ok) throw new Error(`Pinterest Pin 删除失败 (${response.status})`);
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "canceled", progress: 100 };
    },
  };
}
