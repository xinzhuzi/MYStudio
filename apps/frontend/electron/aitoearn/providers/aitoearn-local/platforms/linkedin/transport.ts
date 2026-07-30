import type { PlatformAdapterTransport, PlatformPublishRequest } from "../platform-adapter";
import { assertOAuthCallback, createOAuthState } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  readOfficialAsset,
  requestJson,
  requireProviderAccountId,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

const REST = "https://api.linkedin.com/rest";

function restHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "linkedin-version": "202605",
    "x-restli-protocol-version": "2.0.0",
  };
}

function commentary(request: PlatformPublishRequest): string {
  return [request.title, request.description, ...(request.topics ?? []).map((topic) => topic.startsWith("#") ? topic : `#${topic}`)]
    .filter(Boolean)
    .join("\n");
}

async function createPost(
  runtime: OfficialTransportRuntime,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await runtime.fetch(`${REST}/posts`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`LinkedIn 帖子创建失败 (${response.status})`);
  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) as { id?: string; activity?: string } : {};
  const postId = parsed.id ?? parsed.activity ?? response.headers.get("x-restli-id") ?? undefined;
  if (!postId) throw new Error("LinkedIn 帖子 ID 缺失");
  return postId;
}

export function createLinkedinTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
  return {
    authenticate: async () => {
      if (!runtime.config.clientSecret) throw new Error("LinkedIn client secret 未配置");
      const state = createOAuthState();
      const authorizeUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
      authorizeUrl.search = new URLSearchParams({
        response_type: "code",
        client_id: runtime.config.clientId,
        redirect_uri: runtime.config.redirectUri,
        scope: runtime.config.scopes.join(" "),
        state,
      }).toString();
      const callback = assertOAuthCallback(
        (await runtime.authorize({ platformId: "linkedin", authorizationUrl: authorizeUrl.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const token = await requestJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>(runtime, "https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: callback.searchParams.get("code") ?? "",
          redirect_uri: runtime.config.redirectUri,
          client_id: runtime.config.clientId,
          client_secret: runtime.config.clientSecret,
        }),
      });
      if (!token.access_token) throw new Error("LinkedIn access token 缺失");
      const profile = await requestJson<{ sub?: string; name?: string; given_name?: string; family_name?: string; picture?: string }>(runtime, "https://api.linkedin.com/v2/userinfo", {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!profile.sub) throw new Error("LinkedIn 用户信息缺失");
      await saveOfficialAccount(runtime, {
        providerAccountId: profile.sub,
        displayName: profile.name ?? ([profile.given_name, profile.family_name].filter(Boolean).join(" ") || profile.sub),
        avatarUrl: profile.picture,
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
      if (request.visibility && request.visibility !== "public") throw new Error("LinkedIn 当前只支持公开发布");
      const account = await getOfficialAccount(runtime, request.accountId);
      const ownerUrn = `urn:li:person:${requireProviderAccountId(account)}`;
      let content: Record<string, unknown> | undefined;
      if (request.contentType === "video") {
        const video = request.assets.find((asset) => asset.kind === "video");
        if (!video) throw new Error("LinkedIn 视频资产缺失");
        const asset = await readOfficialAsset(runtime, video.url);
        const initialized = await requestJson<{ value?: { video?: string; uploadToken?: string; uploadInstructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }> } }>(runtime, `${REST}/videos?action=initializeUpload`, {
          method: "POST",
          headers: restHeaders(account.credential.accessToken),
          body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn, fileSizeBytes: asset.bytes.byteLength } }),
        });
        const videoUrn = initialized.value?.video;
        const uploadToken = initialized.value?.uploadToken;
        const instructions = initialized.value?.uploadInstructions ?? [];
        if (!videoUrn || !uploadToken || instructions.length === 0) throw new Error("LinkedIn 视频上传参数缺失");
        const uploadedPartIds: string[] = [];
        for (const instruction of instructions) {
          const part = asset.bytes.slice(instruction.firstByte, instruction.lastByte + 1);
          const response = await runtime.fetch(instruction.uploadUrl, {
            method: "PUT",
            headers: { "content-type": "application/octet-stream", "content-length": String(part.byteLength) },
            body: part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer,
          });
          if (!response.ok) throw new Error(`LinkedIn 视频上传失败 (${response.status})`);
          const etag = response.headers.get("etag");
          if (etag) uploadedPartIds.push(etag);
        }
        await requestJson(runtime, `${REST}/videos?action=finalizeUpload`, {
          method: "POST",
          headers: restHeaders(account.credential.accessToken),
          body: JSON.stringify({ finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds } }),
        });
        content = { media: { id: videoUrn } };
      } else {
        const imageUrns: string[] = [];
        for (const image of request.assets.filter((asset) => asset.kind === "image")) {
          const asset = await readOfficialAsset(runtime, image.url);
          const initialized = await requestJson<{ value?: { uploadUrl?: string; image?: string } }>(runtime, `${REST}/images?action=initializeUpload`, {
            method: "POST",
            headers: restHeaders(account.credential.accessToken),
            body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
          });
          if (!initialized.value?.uploadUrl || !initialized.value.image) throw new Error("LinkedIn 图片上传参数缺失");
          const response = await runtime.fetch(initialized.value.uploadUrl, {
            method: "PUT",
            headers: { "content-type": "application/octet-stream", "content-length": String(asset.bytes.byteLength) },
            body: asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer,
          });
          if (!response.ok) throw new Error(`LinkedIn 图片上传失败 (${response.status})`);
          imageUrns.push(initialized.value.image);
        }
        if (imageUrns.length) content = { multiImage: { images: imageUrns.map((id) => ({ id })) } };
      }
      const postId = await createPost(runtime, account.credential.accessToken, {
        author: ownerUrn,
        commentary: commentary(request),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        ...(content ? { content } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      });
      return { taskId: postId, providerTaskId: postId, status: "success", progress: 100 };
    },
    poll: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      await requestJson(runtime, `${REST}/posts/${encodeURIComponent(request.taskId)}`, { headers: restHeaders(account.credential.accessToken) });
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "success", progress: 100 };
    },
    cancel: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const response = await runtime.fetch(`${REST}/posts/${encodeURIComponent(request.taskId)}`, { method: "DELETE", headers: restHeaders(account.credential.accessToken) });
      if (!response.ok) throw new Error(`LinkedIn 帖子删除失败 (${response.status})`);
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "canceled", progress: 100 };
    },
  };
}
