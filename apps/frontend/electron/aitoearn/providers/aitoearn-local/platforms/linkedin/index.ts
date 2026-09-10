import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const linkedinManifest = getPlatformManifest("linkedin");

export function createLinkedinAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(linkedinManifest, transport);
}
