import crypto from "node:crypto";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import {
  projectStoryboardShotCompositionProps,
  validateRemotionShotPlan,
} from "@/lib/studio/remotion/shot-plan";
import type { StoryboardShotCompositionProps } from "../composition/composition-props";
import { buildCompositionProps, validateSubtitleAuthorityForTimeline } from "../composition/build-composition-props";
import { MediaBridgeServer } from "../media-bridge/media-bridge-server";
import { buildMediaUrlMap, type MediaBridgeClipSource } from "../media-bridge/media-bridge-source-map";
import type { MediaBridgeSession } from "../media-bridge/media-bridge-session";
import type { RemotionPreviewCreateReply } from "./remotion-preview-ipc";

export interface RemotionPreviewServiceOptions {
  resolveSourcePath: (sourcePath: string) => string;
}

export interface RemotionShotPreviewCreateReply {
  sessionId: string;
  composition: StoryboardShotCompositionProps;
}

export class RemotionPreviewService {
  private readonly mediaBridge = new MediaBridgeServer();
  private readonly sessions = new Map<string, MediaBridgeSession>();

  constructor(private readonly options: RemotionPreviewServiceOptions) {}

  async create(plan: TimelineRenderPlan): Promise<RemotionPreviewCreateReply> {
    const authorityValidation = validateSubtitleAuthorityForTimeline(plan);
    if (!authorityValidation.success) {
      throw new Error(authorityValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }
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

  async createShot(plan: RemotionShotPlanV1): Promise<RemotionShotPreviewCreateReply> {
    const validated = await validateRemotionShotPlan(plan);
    if (!validated.success) {
      throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }
    await this.mediaBridge.listen();
    const session = this.mediaBridge.createSession();
    try {
      const references = [
        validated.value.shot.visualSource,
        ...validated.value.shot.audioBindings.map((binding) => binding.source),
      ];
      const uniqueReferences = [...new Map(references.map((reference) => [referenceKey(reference), reference])).values()];
      const sources: MediaBridgeClipSource[] = uniqueReferences.map((reference) => ({
        clipId: referenceKey(reference),
        absolutePath: this.options.resolveSourcePath(toProjectFileUrl(reference.projectId, reference.relativePath)),
      }));
      const urls = buildMediaUrlMap(this.mediaBridge, session, sources);
      const projection = projectStoryboardShotCompositionProps(
        validated.value,
        (reference) => {
          const url = urls[referenceKey(reference)];
          if (!url) throw new Error(`shot 素材 capability 缺失: ${reference.relativePath}`);
          return url;
        },
      );
      if (!projection.success) {
        throw new Error(projection.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      }
      const sessionId = crypto.randomUUID();
      this.sessions.set(sessionId, session);
      return { sessionId, composition: projection.value };
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

function referenceKey(reference: { kind: string; projectId: string; relativePath: string; contentSha256: string }): string {
  return `${reference.kind}:${reference.projectId}:${reference.relativePath}:${reference.contentSha256}`;
}

function toProjectFileUrl(projectId: string, relativePath: string): string {
  const encodedPath = relativePath.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `project-file://${encodeURIComponent(projectId)}/${encodedPath}`;
}
