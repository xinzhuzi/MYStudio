import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";
import { createFacebookTransport } from "./transport";
export { createFacebookTransport } from "./transport";
export type { OfficialTransportRuntime } from "../official/transport-runtime";

export const facebookManifest = getPlatformManifest("facebook");

export function createFacebookAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(facebookManifest, transport);
}
export function createFacebookOfficialAdapter(runtime: import("../official/transport-runtime").OfficialTransportRuntime): PlatformAdapter { return createFacebookAdapter(createFacebookTransport(runtime)); }
