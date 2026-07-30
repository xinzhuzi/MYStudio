import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const douyinManifest = getPlatformManifest("douyin");

export function createDouyinAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(douyinManifest, transport);
}
