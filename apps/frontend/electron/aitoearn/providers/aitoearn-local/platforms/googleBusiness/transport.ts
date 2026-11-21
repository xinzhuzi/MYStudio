import type { PlatformAdapterTransport, PlatformPublishAsset, PlatformPublishRequest } from "../platform-adapter";
import { assertOAuthCallback, createOAuthState, createPkcePair } from "../official/oauth-state";
import {
  getOfficialAccount,
  listOfficialAccounts,
  requestJson,
  requireHttpsAssetUrl,
  requireProviderAccountId,
  saveOfficialAccount,
  type OfficialTransportRuntime,
} from "../official/transport-runtime";

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LOCAL_POSTS_API = "https://mybusiness.googleapis.com/v4";

/** Local Posts 正文与图片数量上限（Google Business Profile v4 契约）。 */
const MAX_SUMMARY_LENGTH = 1500;
const MAX_PHOTOS = 10;

interface GoogleBusinessAccount {
  name?: string;
  accountName?: string;
  type?: string;
}

interface GoogleBusinessLocation {
  name?: string;
  title?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
  };
}

interface LocalPost {
  name?: string;
  searchUrl?: string;
  state?: string;
}

function localPostName(value: string): string {
  if (!/^accounts\/[^/]+\/locations\/[^/]+\/localPosts\/[^/]+$/.test(value)) {
    throw new Error("Google 商家资料帖子资源名无效");
  }
  return value;
}

function httpsResultUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function summary(request: PlatformPublishRequest): string {
  const value = [
    request.title?.trim(),
    request.description?.trim(),
    ...(request.topics ?? []).map((topic) => (topic.startsWith("#") ? topic : `#${topic}`)),
  ].filter((part): part is string => Boolean(part)).join("\n\n");
  if (!value) throw new Error("Google 商家资料发布需要标题或正文");
  if (value.length > MAX_SUMMARY_LENGTH) throw new Error(`Google 商家资料正文不能超过 ${MAX_SUMMARY_LENGTH} 个字符`);
  return value;
}

function publicMediaUrl(url: string): string {
  try {
    return requireHttpsAssetUrl(url);
  } catch {
    throw new Error("Google 商家资料要求平台可拉取的公网 HTTPS 媒体 URL");
  }
}

function mediaItem(asset: PlatformPublishAsset, mediaFormat: "PHOTO" | "VIDEO") {
  return { mediaFormat, sourceUrl: publicMediaUrl(asset.url) };
}

function postMedia(request: PlatformPublishRequest) {
  if (request.contentType === "video") {
    const video = request.assets.find((asset) => asset.kind === "video");
    if (!video) throw new Error("Google 商家资料视频发布需要视频资产");
    return [mediaItem(video, "VIDEO")];
  }
  const images = request.assets.filter((asset) => asset.kind === "image");
  if (!images.length) throw new Error("Google 商家资料图文发布需要图片资产");
  return images.slice(0, MAX_PHOTOS).map((image) => mediaItem(image, "PHOTO"));
}

export function createGoogleBusinessTransport(runtime: OfficialTransportRuntime): PlatformAdapterTransport {
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
        (await runtime.authorize({ platformId: "googleBusiness", authorizationUrl: url.toString(), redirectUri: runtime.config.redirectUri, expectedState: state })).toString(),
        runtime.config.redirectUri,
        state,
      );
      const token = await requestJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }>(runtime, "https://oauth2.googleapis.com/token", {
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
      if (!token.access_token) throw new Error("Google 商家资料 access token 缺失");
      const headers = { authorization: `Bearer ${token.access_token}` };
      const credential = {
        kind: "oauth" as const,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_in ? new Date(runtime.now().getTime() + token.expires_in * 1000).toISOString() : undefined,
        scope: token.scope,
      };

      const accounts: GoogleBusinessAccount[] = [];
      let accountPageToken: string | undefined;
      do {
        const pageUrl = new URL(`${ACCOUNTS_API}/accounts`);
        if (accountPageToken) pageUrl.searchParams.set("pageToken", accountPageToken);
        const page = await requestJson<{ accounts?: GoogleBusinessAccount[]; nextPageToken?: string }>(runtime, pageUrl.toString(), { headers });
        accounts.push(...(page.accounts ?? []));
        accountPageToken = page.nextPageToken;
      } while (accountPageToken);

      let saved = 0;
      for (const account of accounts) {
        if (!account.name || account.type === "USER_GROUP" || account.type === "ORGANIZATION") continue;
        let locationPageToken: string | undefined;
        do {
          const locationUrl = new URL(`${BUSINESS_API}/${account.name}/locations`);
          locationUrl.searchParams.set("readMask", "name,title,storefrontAddress");
          if (locationPageToken) locationUrl.searchParams.set("pageToken", locationPageToken);
          const page = await requestJson<{ locations?: GoogleBusinessLocation[]; nextPageToken?: string }>(runtime, locationUrl.toString(), { headers });
          for (const location of page.locations ?? []) {
            if (!location.name) continue;
            await saveOfficialAccount(runtime, {
              providerAccountId: location.name.startsWith("accounts/") ? location.name : `${account.name}/${location.name}`,
              displayName: [account.accountName, location.title].filter((part): part is string => Boolean(part)).join(" · ") || location.name,
              credential,
            });
            saved += 1;
          }
          locationPageToken = page.nextPageToken;
        } while (locationPageToken);
      }
      if (saved === 0) throw new Error("Google 商家资料授权账号下没有可用营业地点");
      return { authenticated: true };
    },
    listAccounts: () => listOfficialAccounts(runtime),
    publish: async (request: PlatformPublishRequest) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const locationName = requireProviderAccountId(account);
      const post = await requestJson<LocalPost>(runtime, `${LOCAL_POSTS_API}/${locationName}/localPosts`, {
        method: "POST",
        headers: { authorization: `Bearer ${account.credential.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          languageCode: "zh-CN",
          summary: summary(request),
          topicType: "STANDARD",
          media: postMedia(request),
        }),
      });
      if (!post.name) throw new Error("Google 商家资料帖子 ID 缺失");
      if (post.state === "REJECTED") {
        return {
          taskId: post.name,
          providerTaskId: post.name,
          status: "failure",
          progress: 100,
          error: { code: "google-business-post-rejected", message: "Google 商家资料拒绝了该帖子", retryable: false },
        };
      }
      const resultUrl = httpsResultUrl(post.searchUrl);
      return { taskId: post.name, providerTaskId: post.name, status: "success", progress: 100, ...(resultUrl ? { resultUrl } : {}) };
    },
    poll: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const post = await requestJson<LocalPost>(runtime, `${LOCAL_POSTS_API}/${localPostName(request.taskId)}`, {
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (post.state === "REJECTED") {
        return {
          taskId: request.taskId,
          providerTaskId: request.taskId,
          status: "failure",
          progress: 100,
          error: { code: "google-business-post-rejected", message: "Google 商家资料拒绝了该帖子", retryable: false },
        };
      }
      const live = post.state === "LIVE";
      const resultUrl = httpsResultUrl(post.searchUrl);
      return {
        taskId: request.taskId,
        providerTaskId: request.taskId,
        status: live ? "success" : "running",
        progress: live ? 100 : 75,
        ...(live && resultUrl ? { resultUrl } : {}),
      };
    },
    cancel: async (request) => {
      const account = await getOfficialAccount(runtime, request.accountId);
      const response = await runtime.fetch(`${LOCAL_POSTS_API}/${localPostName(request.taskId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${account.credential.accessToken}` },
      });
      if (!response.ok) throw new Error(`Google 商家资料帖子删除失败 (${response.status})`);
      return { taskId: request.taskId, providerTaskId: request.taskId, status: "canceled", progress: 100 };
    },
  };
}
