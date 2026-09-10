import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const instagramManifest = getPlatformManifest("instagram");

export function createInstagramAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(instagramManifest, transport);
}
