import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";
import { createLinkedinTransport } from "./transport";
export { createLinkedinTransport } from "./transport";

export const linkedinManifest = getPlatformManifest("linkedin");

export function createLinkedinAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(linkedinManifest, transport);
}
export function createLinkedinOfficialAdapter(runtime: import("../official/transport-runtime").OfficialTransportRuntime): PlatformAdapter { return createLinkedinAdapter(createLinkedinTransport(runtime)); }
