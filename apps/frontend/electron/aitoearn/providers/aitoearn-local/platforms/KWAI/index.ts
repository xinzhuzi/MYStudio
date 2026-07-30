import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const kwaiManifest = getPlatformManifest("KWAI");

export function createKwaiAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(kwaiManifest, transport);
}
