import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";
import { createThreadsTransport } from "./transport";
export { createThreadsTransport } from "./transport";

export const threadsManifest = getPlatformManifest("threads");

export function createThreadsAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(threadsManifest, transport);
}
export function createThreadsOfficialAdapter(runtime: import("../official/transport-runtime").OfficialTransportRuntime): PlatformAdapter { return createThreadsAdapter(createThreadsTransport(runtime)); }
