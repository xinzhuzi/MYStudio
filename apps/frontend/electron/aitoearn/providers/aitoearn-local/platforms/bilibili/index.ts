import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";
export { createBilibiliTransport } from "./transport";

export const bilibiliManifest = getPlatformManifest("bilibili");

export function createBilibiliAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(bilibiliManifest, transport);
}
