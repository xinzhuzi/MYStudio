import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const pinterestManifest = getPlatformManifest("pinterest");

export function createPinterestAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(pinterestManifest, transport);
}
