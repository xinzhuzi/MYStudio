import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const tiktokManifest = getPlatformManifest("tiktok");

export function createTiktokAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(tiktokManifest, transport);
}

export { createTiktokTransport } from "./transport";
