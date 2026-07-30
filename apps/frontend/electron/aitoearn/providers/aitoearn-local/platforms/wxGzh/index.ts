import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";
export { createWxGzhTransport } from "./transport";

export const wxGzhManifest = getPlatformManifest("wxGzh");

export function createWxGzhAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(wxGzhManifest, transport);
}
