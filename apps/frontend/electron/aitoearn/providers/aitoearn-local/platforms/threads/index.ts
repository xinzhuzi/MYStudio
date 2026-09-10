import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const threadsManifest = getPlatformManifest("threads");

export function createThreadsAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(threadsManifest, transport);
}
