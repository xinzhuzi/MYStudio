import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const youtubeManifest = getPlatformManifest("youtube");

export function createYoutubeAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(youtubeManifest, transport);
}

export { createYoutubeTransport } from "./transport";
