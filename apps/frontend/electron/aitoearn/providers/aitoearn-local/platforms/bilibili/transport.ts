import { createHash, createHmac, randomUUID } from "node:crypto";
import type { PlatformAdapterTransport, PlatformPublishRequest, PlatformTaskRequest } from "../platform-adapter";
import { assertOAuthCallback, createOAuthState } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

const OPEN_BASE = "https://member.bilibili.com";

function signedHeaders(runtime: OfficialTransportRuntime, accessToken: string, body: string, includeContentType = true): Record<string, string> {
  if (!runtime.config.clientSecret) throw new Error("B站 client secret 未配置");
  const contentMd5 = createHash("md5").update(body).digest("hex");
  const values = {
    "x-bili-accesskeyid": runtime.config.clientId,
    "x-bili-content-md5": contentMd5,
    "x-bili-signature-method": "HMAC-SHA256",
    "x-bili-signature-nonce": randomUUID(),
    "x-bili-signature-version": "2.0",
    "x-bili-timestamp": Math.floor(runtime.now().getTime() / 1000).toString(),
  };
  const payload = Object.entries(values).map(([key, value]) => `${key}:${value}`).join("\n");
  return {
    accept: "application/json",
    "access-token": accessToken,
    authorization: createHmac("sha256", runtime.config.clientSecret).update(payload).digest("hex"),
    ...(includeContentType ? { "content-type": "application/json" } : {}),
    ...values,
  };
}

async function signedRequest<T>(
  runtime: OfficialTransportRuntime,
  accessToken: string,
  method: "GET" | "POST",
  pathname: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
  requireData = true,
): Promise<T> {
  const url = new URL(pathname, OPEN_BASE);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const bodyText = body ? JSON.stringify(body) : "";
  const result = await requestJson<{ data?: T }>(runtime, url.toString(), {
    method,
    headers: signedHeaders(runtime, accessToken, bodyText),
    ...(body ? { body: bodyText } : {}),
  });
  if (result.data === undefined && requireData) throw new Error("B站开放平台响应缺少 data");
  return result.data as T;
}

export function createBilibiliTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      const state = createOAuthState();
      const url = new URL("https://account.bilibili.com/pc/account-pc/auth/oauth");
      url.search = new URLSearchParams({ client_id: runtime.config.clientId, gourl: runtime.config.redirectUri, state }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "bilibili", authorizationUrl: url.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const tokenResult = await requestJson<{ data?: { access_token?: string; refresh_token?: string; expires_in?: number } }>(runtime, "https://api.bilibili.com/x/account-oauth2/v1/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: runtime.config.clientId,
          client_secret: runtime.config.clientSecret ?? "",
          grant_type: "authorization_code",
          code: callback.searchParams.get("code") ?? "",
        }),
      });
      const token = tokenResult.data;
      if (!token?.access_token) throw new Error("B站 access token 缺失");
      const user = await signedRequest<{ openid?: string; name?: string; face?: string }>(runtime, token.access_token, "GET", "/arcopen/fn/user/account/info");
      if (!user.openid) throw new Error("B站用户信息缺失");
      await saveOfficialAccount(runtime, {
        providerAccountId: user.openid,
        displayName: user.name ?? user.openid,
        avatarUrl: user.face,
        credential: {
          kind: "oauth",
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: token.expires_in ? new Date(runtime.now().getTime() + token.expires_in * 1000).toISOString() : undefined,
        },
      });
      return { authenticated: true };
    },
    listAccounts: () => listOfficialAccounts(runtime),
    publish: async (request: PlatformPublishRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const video = request.assets.find((asset) => asset.kind === "video");
      if (!video) throw new Error("B站视频资产缺失");
      const tid = Number(request.options?.tid);
      if (!Number.isInteger(tid) || tid <= 0) throw new Error("B站发布需要有效的分区 ID（tid）");
      const asset = await readOfficialAsset(runtime, video.url);
      const upload = await signedRequest<{ upload_token?: string }>(runtime, account.credential.accessToken, "POST", "/arcopen/fn/archive/video/init", {
        name: asset.filename,
        utype: "0",
      });
      if (!upload.upload_token) throw new Error("B站 upload token 缺失");
      const chunkSize = 100 * 1024 * 1024;
      const partCount = Math.max(1, Math.ceil(asset.bytes.byteLength / chunkSize));
      for (let index = 0; index < partCount; index += 1) {
        const start = index * chunkSize;
        const end = Math.min(asset.bytes.byteLength, start + chunkSize);
        const uploadUrl = new URL("https://openupos.bilivideo.com/video/v2/part/upload");
        uploadUrl.search = new URLSearchParams({ upload_token: upload.upload_token, part_number: String(index + 1) }).toString();
        const response = await runtime.fetch(uploadUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "content-length": String(end - start) },
          body: asset.bytes.slice(start, end),
        });
        if (!response.ok) throw new Error(`B站视频分片上传失败 (${response.status})`);
      }
      await signedRequest(runtime, account.credential.accessToken, "POST", "/arcopen/fn/archive/video/complete", undefined, { upload_token: upload.upload_token }, false);

      let cover: string | undefined;
      if (request.cover) {
        const coverAsset = await readOfficialAsset(runtime, request.cover.url);
        const form = new FormData();
        const coverBody = coverAsset.bytes.buffer.slice(coverAsset.bytes.byteOffset, coverAsset.bytes.byteOffset + coverAsset.bytes.byteLength) as ArrayBuffer;
        form.append("file", new Blob([coverBody], { type: coverAsset.contentType }), coverAsset.filename);
        const response = await runtime.fetch(`${OPEN_BASE}/arcopen/fn/archive/cover/upload`, {
          method: "POST",
          headers: signedHeaders(runtime, account.credential.accessToken, "", false),
          body: form,
        });
        if (!response.ok) throw new Error(`B站封面上传失败 (${response.status})`);
        const result = await response.json() as { data?: { url?: string } };
        cover = result.data?.url;
        if (!cover) throw new Error("B站封面 URL 缺失");
      }

      const submitted = await signedRequest<{ resource_id?: string }>(
        runtime,
        account.credential.accessToken,
        "POST",
        "/arcopen/fn/archive/add-by-utoken",
        {
          title: request.title?.trim() || "Untitled",
          tid,
          tag: request.topics?.join(",") ?? "",
          copyright: 1,
          no_reprint: 0,
          desc: request.description ?? "",
          ...(cover ? { cover } : {}),
        },
        { upload_token: upload.upload_token },
      );
      if (!submitted.resource_id) throw new Error("B站稿件 ID 缺失");
      return { taskId: submitted.resource_id, providerTaskId: submitted.resource_id, status: "running", progress: 75 };
    },
    poll: async (request: PlatformTaskRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const result = await signedRequest<{ resource_id?: string; addit_info?: { state?: number; state_desc?: string } }>(
        runtime,
        account.credential.accessToken,
        "GET",
        "/arcopen/fn/archive/view",
        undefined,
        { resource_id: request.taskId },
      );
      const state = result.addit_info?.state;
      if (state === 0) return { taskId: request.taskId, providerTaskId: result.resource_id ?? request.taskId, status: "success", progress: 100 };
      if (state === -1) return { taskId: request.taskId, providerTaskId: result.resource_id ?? request.taskId, status: "running", progress: 90 };
      return {
        taskId: request.taskId,
        providerTaskId: result.resource_id ?? request.taskId,
        status: "failure",
        progress: 100,
        error: { code: "bilibili-review-failed", message: result.addit_info?.state_desc ?? "B站稿件审核未通过", retryable: false },
      };
    },
    cancel: async () => { throw new Error("B站开放平台未提供稿件取消接口"); },
  };
}
