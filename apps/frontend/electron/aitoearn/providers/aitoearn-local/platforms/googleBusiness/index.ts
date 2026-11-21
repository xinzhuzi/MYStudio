import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const googleBusinessManifest = getPlatformManifest("googleBusiness");

export function createGoogleBusinessAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(googleBusinessManifest, transport);
}

export { createGoogleBusinessTransport } from "./transport";
