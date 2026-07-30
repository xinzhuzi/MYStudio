import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";
import { createInstagramTransport } from "./transport";
export { createInstagramTransport } from "./transport";

export const instagramManifest = getPlatformManifest("instagram");

export function createInstagramAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(instagramManifest, transport);
}
export function createInstagramOfficialAdapter(runtime: import("../official/transport-runtime").OfficialTransportRuntime): PlatformAdapter { return createInstagramAdapter(createInstagramTransport(runtime)); }
