import type { PlatformId } from "../platform-types";

export const OFFICIAL_PLATFORM_IDS = [
  "tiktok",
  "youtube",
  "bilibili",
  "twitter",
  "wxGzh",
  "facebook",
  "instagram",
  "threads",
  "pinterest",
  "linkedin",
] as const satisfies readonly PlatformId[];

export type OfficialPlatformId = (typeof OFFICIAL_PLATFORM_IDS)[number];

export interface OfficialPlatformConfig {
  platformId: OfficialPlatformId;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: readonly string[];
}

const ENV_PREFIX = {
  tiktok: "TIKTOK",
  youtube: "YOUTUBE",
  bilibili: "BILIBILI",
  twitter: "TWITTER",
  wxGzh: "WECHAT_OFFICIAL",
  facebook: "FACEBOOK",
  instagram: "INSTAGRAM",
  threads: "THREADS",
  pinterest: "PINTEREST",
  linkedin: "LINKEDIN",
} as const satisfies Record<OfficialPlatformId, string>;

const DEFAULT_SCOPES: Readonly<Record<OfficialPlatformId, readonly string[]>> = {
  tiktok: ["user.info.basic", "video.publish", "video.upload"],
  youtube: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
  bilibili: [],
  twitter: ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"],
  wxGzh: [],
  facebook: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "publish_video"],
  instagram: ["instagram_business_basic", "instagram_business_content_publish"],
  threads: ["threads_basic", "threads_content_publish"],
  pinterest: ["pins:read", "pins:write", "boards:read"],
  linkedin: ["openid", "profile", "email", "w_member_social"],
};

const CLIENT_SECRET_REQUIRED = new Set<OfficialPlatformId>([
  "tiktok",
  "youtube",
  "bilibili",
  "wxGzh",
  "facebook",
  "instagram",
  "threads",
  "pinterest",
  "linkedin",
]);

function required(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
  } catch {
    return false;
  }
}

export function loadOfficialPlatformConfig(
  platformId: OfficialPlatformId,
  env: Readonly<Record<string, string | undefined>> = process.env,
): OfficialPlatformConfig | null {
  const prefix = `MYSTUDIO_SELF_MEDIA_${ENV_PREFIX[platformId]}`;
  const clientId = required(env[`${prefix}_CLIENT_ID`]);
  const redirectUri = required(env[`${prefix}_REDIRECT_URI`])
    ?? (platformId === "wxGzh" ? "http://127.0.0.1/self-media/wechat-official" : null);
  if (!clientId || !redirectUri || !validRedirectUri(redirectUri)) return null;
  const clientSecret = required(env[`${prefix}_CLIENT_SECRET`]) ?? undefined;
  if (CLIENT_SECRET_REQUIRED.has(platformId) && !clientSecret) return null;
  const configuredScopes = (env[`${prefix}_SCOPES`] ?? "")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const scopes = configuredScopes.length ? configuredScopes : [...DEFAULT_SCOPES[platformId]];
  return { platformId, clientId, ...(clientSecret ? { clientSecret } : {}), redirectUri, scopes };
}
