import {
  createPlatformAdapter,
  type PlatformAdapter,
  type PlatformAdapterTransport,
} from "../platform-adapter";
import { getPlatformManifest } from "../platform-manifest";

export const wxSphManifest = getPlatformManifest("wxSph");

export function createWxSphAdapter(transport?: PlatformAdapterTransport): PlatformAdapter {
  return createPlatformAdapter(wxSphManifest, transport);
}
