import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const twitterManifest = getPlatformManifest("twitter");

export function createTwitterAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(twitterManifest, transport);
}

export { createTwitterTransport } from "./transport";
