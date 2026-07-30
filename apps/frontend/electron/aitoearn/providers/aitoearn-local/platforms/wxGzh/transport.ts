import type { PlatformAdapterTransport, PlatformPublishRequest, PlatformTaskRequest } from "../platform-adapter";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

const API = "https://api.weixin.qq.com/cgi-bin";

async function officialAccessToken(runtime: OfficialTransportRuntime): Promise<{ accessToken: string; expiresIn?: number }> {
  if (!runtime.config.clientSecret) throw new Error("微信公众号 app secret 未配置");
  const url = new URL(`${API}/token`);
  url.search = new URLSearchParams({ grant_type: "client_credential", appid: runtime.config.clientId, secret: runtime.config.clientSecret }).toString();
  const result = await requestJson<{ access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }>(runtime, url.toString());
  if (!result.access_token) throw new Error(result.errmsg ?? "微信公众号 access token 缺失");
  return { accessToken: result.access_token, expiresIn: result.expires_in };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function createWxGzhTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      const token = await officialAccessToken(runtime);
      await saveOfficialAccount(runtime, {
        providerAccountId: runtime.config.clientId,
        displayName: `微信公众号 · ${runtime.config.clientId}`,
        credential: {
          kind: "oauth",
          accessToken: token.accessToken,
          expiresAt: token.expiresIn ? new Date(runtime.now().getTime() + token.expiresIn * 1000).toISOString() : undefined,
        },
      });
      return { authenticated: true };
    },
    listAccounts: () => listOfficialAccounts(runtime),
    publish: async (request: PlatformPublishRequest) => {
      await getOfficialAccount(runtime, request.accountId);
      const cover = request.cover ?? request.assets.find((asset) => asset.kind === "image");
      if (!cover) throw new Error("微信公众号发布需要封面图片");
      const token = await officialAccessToken(runtime);
      const coverAsset = await readOfficialAsset(runtime, cover.url);
      const form = new FormData();
      const coverBody = coverAsset.bytes.buffer.slice(coverAsset.bytes.byteOffset, coverAsset.bytes.byteOffset + coverAsset.bytes.byteLength) as ArrayBuffer;
      form.append("media", new Blob([coverBody], { type: coverAsset.contentType }), coverAsset.filename);
      const uploaded = await runtime.fetch(`${API}/material/add_material?access_token=${encodeURIComponent(token.accessToken)}&type=image`, { method: "POST", body: form });
      if (!uploaded.ok) throw new Error(`微信公众号封面上传失败 (${uploaded.status})`);
      const uploadedBody = await uploaded.json() as { media_id?: string; errmsg?: string };
      if (!uploadedBody.media_id) throw new Error(uploadedBody.errmsg ?? "微信公众号封面 media_id 缺失");

      const draft = await requestJson<{ media_id?: string; errmsg?: string }>(runtime, `${API}/draft/add?access_token=${encodeURIComponent(token.accessToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          articles: [{
            title: request.title?.trim() || "Untitled",
            content: `<p>${escapeHtml(request.description ?? "")}</p>`,
            thumb_media_id: uploadedBody.media_id,
            show_cover_pic: 1,
          }],
        }),
      });
      if (!draft.media_id) throw new Error(draft.errmsg ?? "微信公众号草稿 media_id 缺失");
      const submitted = await requestJson<{ publish_id?: string; errmsg?: string }>(runtime, `${API}/freepublish/submit?access_token=${encodeURIComponent(token.accessToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: draft.media_id }),
      });
      if (!submitted.publish_id) throw new Error(submitted.errmsg ?? "微信公众号 publish_id 缺失");
      return { taskId: submitted.publish_id, providerTaskId: submitted.publish_id, status: "running", progress: 75 };
    },
    poll: async (request: PlatformTaskRequest) => {
      await getOfficialAccount(runtime, request.accountId);
      const token = await officialAccessToken(runtime);
      const result = await requestJson<{ publish_status?: number; article_id?: string; article_url?: string; errmsg?: string }>(runtime, `${API}/freepublish/get?access_token=${encodeURIComponent(token.accessToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publish_id: request.taskId }),
      });
      if (result.publish_status === 0) {
        return { taskId: request.taskId, status: "success", progress: 100, providerTaskId: result.article_id ?? request.taskId, ...(result.article_url ? { resultUrl: result.article_url } : {}) };
      }
      if (result.publish_status !== undefined && result.publish_status >= 2) {
        return {
          taskId: request.taskId,
          status: "failure",
          progress: 100,
          providerTaskId: result.article_id ?? request.taskId,
          error: { code: "wechat-official-publish-failed", message: result.errmsg ?? "微信公众号发布失败", retryable: false },
        };
      }
      return { taskId: request.taskId, status: "running", progress: 90, providerTaskId: request.taskId };
    },
    cancel: async () => { throw new Error("微信公众号发布接口不支持取消已提交任务"); },
  };
}
