import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const facebookManifest = getPlatformManifest("facebook");

export function createFacebookAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(facebookManifest, transport);
}
