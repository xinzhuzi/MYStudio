import crypto from "node:crypto";
import type { TimelineRenderPlan } from "@/types/editing";
import { buildCompositionProps } from "../composition/build-composition-props";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { buildMediaUrlMap, type MediaBridgeClipSource } from "../media-bridge/media-bridge-source-map";
import type { MediaBridgeSession } from "../media-bridge/media-bridge-session";
import type { RemotionPreviewCreateReply } from "./remotion-preview-ipc";

export interface RemotionPreviewServiceOptions {
  resolveSourcePath: (sourcePath: string) => string;
}

export class RemotionPreviewService {
  private readonly mediaBridge = new MediaBridgeServer();
  private readonly sessions = new Map<string, MediaBridgeSession>();

  constructor(private readonly options: RemotionPreviewServiceOptions) {}

  async create(plan: TimelineRenderPlan): Promise<RemotionPreviewCreateReply> {
    await this.mediaBridge.listen();
    const session = this.mediaBridge.createSession();
    try {
      const mediaSources: MediaBridgeClipSource[] = [];
      for (const clip of plan.clips) {
        if (clip.source.kind === "text") continue;
        if (!clip.source.path) {
          throw new Error(`片段素材路径不可用: ${clip.id}`);
        }
        const sourcePath = this.options.resolveSourcePath(clip.source.path);
        mediaSources.push({ clipId: clip.id, absolutePath: sourcePath });
      }
      const mediaUrlByClipId = buildMediaUrlMap(this.mediaBridge, session, mediaSources);
      const sessionId = crypto.randomUUID();
      const composition = buildCompositionProps(plan, mediaUrlByClipId);
      this.sessions.set(sessionId, session);
      return { sessionId, composition };
    } catch (error) {
      await this.mediaBridge.revokeSession(session).catch(() => undefined);
      throw error;
    }
  }

  async release(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`未找到 Remotion 预览 session: ${sessionId}`);
    }
    this.sessions.delete(sessionId);
    await this.mediaBridge.revokeSession(session);
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
    await this.mediaBridge.close();
  }
}
