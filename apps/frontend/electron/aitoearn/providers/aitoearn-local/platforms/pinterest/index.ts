import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";
import { createPinterestTransport } from "./transport";
export { createPinterestTransport } from "./transport";

export const pinterestManifest = getPlatformManifest("pinterest");

export function createPinterestAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(pinterestManifest, transport);
}
export function createPinterestOfficialAdapter(runtime: import("../official/transport-runtime").OfficialTransportRuntime): PlatformAdapter { return createPinterestAdapter(createPinterestTransport(runtime)); }
