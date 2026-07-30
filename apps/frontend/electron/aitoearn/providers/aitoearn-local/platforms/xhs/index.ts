import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const xhsManifest = getPlatformManifest("xhs");

export function createXhsAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(xhsManifest, transport);
}
