import type { PlatformAdapterTransport } from "../platform-adapter";
import type { PlatformId } from "../platform-types";
import { createBilibiliTransport } from "../bilibili/transport";
import { createFacebookTransport } from "../facebook/transport";
import { createInstagramTransport } from "../instagram/transport";
import { createLinkedinTransport } from "../linkedin/transport";
import { createPinterestTransport } from "../pinterest/transport";
import { createThreadsTransport } from "../threads/transport";
import { createTiktokTransport } from "../tiktok/transport";
import { createTwitterTransport } from "../twitter/transport";
import { createWxGzhTransport } from "../wxGzh/transport";
import { createYoutubeTransport } from "../youtube/transport";
import type { OAuthWindowRequest } from "./oauth-window";
import { loadOfficialPlatformConfig, OFFICIAL_PLATFORM_IDS, type OfficialPlatformId } from "./platform-config";
import { createOfficialTransportRuntime, type OfficialTransportRuntime } from "./transport-runtime";

const TRANSPORT_FACTORIES = {
  tiktok: createTiktokTransport,
  youtube: createYoutubeTransport,
  bilibili: createBilibiliTransport,
  twitter: createTwitterTransport,
  wxGzh: createWxGzhTransport,
  facebook: createFacebookTransport,
  instagram: createInstagramTransport,
  threads: createThreadsTransport,
  pinterest: createPinterestTransport,
  linkedin: createLinkedinTransport,
} as const satisfies Readonly<Record<OfficialPlatformId, (runtime: OfficialTransportRuntime) => PlatformAdapterTransport>>;

export interface OfficialPlatformTransportsOptions {
  userDataPath: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  authorize?: (request: OAuthWindowRequest) => Promise<URL>;
  now?: () => Date;
  allowedAssetRoots?: () => readonly string[];
}

export interface OfficialPlatformTransports {
  transports: Partial<Record<PlatformId, PlatformAdapterTransport>>;
  configuredPlatforms: readonly OfficialPlatformId[];
}

export function createOfficialPlatformTransports(options: OfficialPlatformTransportsOptions): OfficialPlatformTransports {
  const transports: Partial<Record<PlatformId, PlatformAdapterTransport>> = {};
  const configuredPlatforms: OfficialPlatformId[] = [];
  for (const platformId of OFFICIAL_PLATFORM_IDS) {
    const config = loadOfficialPlatformConfig(platformId, options.env);
    if (!config) continue;
    const runtime = createOfficialTransportRuntime({
      config,
      userDataPath: options.userDataPath,
      fetch: options.fetch,
      authorize: options.authorize,
      now: options.now,
      allowedAssetRoots: options.allowedAssetRoots,
    });
    transports[platformId] = TRANSPORT_FACTORIES[platformId](runtime);
    configuredPlatforms.push(platformId);
  }
  return { transports, configuredPlatforms };
}
