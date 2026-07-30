import {
  createBilibiliAdapter,
} from "./bilibili";
import {
  createDouyinAdapter,
} from "./douyin";
import {
  createFacebookAdapter,
} from "./facebook";
import {
  createInstagramAdapter,
} from "./instagram";
import {
  createKwaiAdapter,
} from "./KWAI";
import {
  createLinkedinAdapter,
} from "./linkedin";
import {
  createPinterestAdapter,
} from "./pinterest";
import {
  createTiktokAdapter,
} from "./tiktok";
import {
  createThreadsAdapter,
} from "./threads";
import {
  createTwitterAdapter,
} from "./twitter";
import {
  createWxGzhAdapter,
} from "./wxGzh";
import {
  createWxSphAdapter,
} from "./wxSph";
import {
  createXhsAdapter,
} from "./xhs";
import {
  createYoutubeAdapter,
} from "./youtube";
import type {
  PlatformAdapter,
  PlatformAdapterTransport,
} from "./platform-adapter";
import {
  PLATFORM_IDS,
  type PlatformId,
  type PlatformManifest,
} from "./platform-types";

type PlatformAdapterFactory = (transport?: PlatformAdapterTransport) => PlatformAdapter;

const PLATFORM_ADAPTER_FACTORIES = {
  tiktok: createTiktokAdapter,
  douyin: createDouyinAdapter,
  xhs: createXhsAdapter,
  wxSph: createWxSphAdapter,
  KWAI: createKwaiAdapter,
  youtube: createYoutubeAdapter,
  bilibili: createBilibiliAdapter,
  twitter: createTwitterAdapter,
  wxGzh: createWxGzhAdapter,
  facebook: createFacebookAdapter,
  instagram: createInstagramAdapter,
  threads: createThreadsAdapter,
  pinterest: createPinterestAdapter,
  linkedin: createLinkedinAdapter,
} as const satisfies Readonly<Record<PlatformId, PlatformAdapterFactory>>;

export interface PlatformAdapterRegistry {
  readonly get: (platformId: PlatformId) => PlatformAdapter | undefined;
  readonly list: () => readonly PlatformManifest[];
}

export function createPlatformAdapterRegistry(
  transports: Partial<Record<PlatformId, PlatformAdapterTransport>> = {},
): PlatformAdapterRegistry {
  const adapters = Object.fromEntries(
    PLATFORM_IDS.map((platformId) => [
      platformId,
      PLATFORM_ADAPTER_FACTORIES[platformId](transports[platformId]),
    ]),
  ) as Record<PlatformId, PlatformAdapter>;

  return {
    get: (platformId) => adapters[platformId],
    list: () => PLATFORM_IDS.map((platformId) => adapters[platformId].manifest),
  };
}
