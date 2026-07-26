import crypto from "node:crypto";
import { MediaBridgeServer } from "./media-bridge-server";
import type { MediaBridgeSession } from "./media-bridge-session";

export interface MediaBridgeClipSource {
  readonly clipId: string;
  readonly absolutePath: string;
}

/**
 * Register resolved clip sources while reusing one opaque capability URL for
 * every identical file path. Remotion can then share its remote-media cache
 * when many timeline clips trim different ranges from the same source video.
 */
export function buildMediaUrlMap(
  server: MediaBridgeServer,
  session: MediaBridgeSession,
  sources: readonly MediaBridgeClipSource[],
): Record<string, string> {
  const urlByPath = new Map<string, string>();
  const urlByClipId: Record<string, string> = {};
  for (const source of sources) {
    if (!source.clipId || Object.prototype.hasOwnProperty.call(urlByClipId, source.clipId)) {
      throw new Error(`媒体桥 clipId 为空或重复: ${source.clipId}`);
    }
    let url = urlByPath.get(source.absolutePath);
    if (!url) {
      const assetId = crypto.randomBytes(32).toString("hex");
      try {
        session.register(assetId, source.absolutePath);
      } catch {
        throw new Error(`片段素材不可服务: ${source.clipId}`);
      }
      const capability = server.buildUrls(session, [assetId])[0];
      if (!capability) {
        throw new Error(`无法创建媒体 capability URL: ${source.clipId}`);
      }
      url = capability.url;
      urlByPath.set(source.absolutePath, url);
    }
    urlByClipId[source.clipId] = url;
  }
  return urlByClipId;
}
