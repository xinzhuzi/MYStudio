import type { StoryboardItem } from "@/types/studio";
import type { CinematicStoryboardItem } from "./cinematic-preset";
import { validateStoryboardCinematic } from "./cinematic-preset";

const STORYBOARD_STATES = new Set<StoryboardItem["state"]>([
  "idle",
  "queued",
  "rendering",
  "ready",
  "failed",
]);

const CANONICAL_STORYBOARD_FIELDS = [
  "id",
  "sourceId",
  "revision",
  "episodeId",
  "index",
  "trackKey",
  "trackId",
  "duration",
  "prompt",
  "videoDesc",
  "assetIds",
  "mediaRef",
  "keyframes",
  "imageWorkflowId",
  "imageWorkflowNodeId",
  "shouldGenerateImage",
  "audioRef",
  "state",
  "reason",
  "emotion",
  "orientation",
  "spatialRelation",
  "associateAssetsNames",
  "lines",
  "speaker",
  "speakerId",
  "line",
  "ttsSpokenText",
  "durationTarget",
  "voiceStyle",
  "requiresFixedVoice",
  "ttsGenerationId",
  "ttsBackend",
  "ttsMocked",
  "ttsWarning",
  "ttsEmotionCapability",
  "voiceProfileId",
  "voiceMatch",
  "sound",
  "shotSemantics",
  "styleContractVersion",
  "cinematic",
] as const;

type CanonicalStoryboardField = (typeof CANONICAL_STORYBOARD_FIELDS)[number];

export function formatStoryboardJson(items: StoryboardItem[]): string {
  return JSON.stringify(items.map(projectCanonicalStoryboardItem), null, 2);
}

export function formatJsonDocument(raw: string): { value?: string; error?: string } {
  try {
    return { value: JSON.stringify(JSON.parse(raw) as unknown, null, 2) };
  } catch (error) {
    return { error: `JSON 解析失败: ${error instanceof Error ? error.message : "语法错误"}` };
  }
}

export function formatRemotionStoryboardJson(input: {
  projectId?: string;
  episodeId: string;
  items: StoryboardItem[];
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    source: "mystudio-remotion-shot-plan",
    projectId: input.projectId,
    chapterId: input.episodeId,
    compositionId: "StoryboardShot",
    shots: input.items
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((item) => ({
        shotId: item.id,
        sourceId: item.sourceId,
        sourceRevision: item.revision,
        index: item.index,
        revision: item.outputVersion ?? 0,
        state: item.state,
        stale: item.stale ?? false,
        duration: item.duration,
        sourceFingerprint: item.sourceFingerprint,
        media: redactMediaRef(item.mediaRef),
        audio: redactMediaRef(item.audioRef),
        continuity: item.continuityState
          ? {
              groupId: item.continuityState.groupId,
              sceneVersionId: item.continuityState.sceneVersionId,
              sceneViewpointId: item.continuityState.sceneViewpointId,
              inputFingerprint: item.continuityState.inputFingerprint,
            }
          : undefined,
        visualReview: item.visualReview
          ? {
              status: item.visualReview.status,
              reviewer: item.visualReview.reviewer,
              inputFingerprint: item.visualReview.inputFingerprint,
            }
          : undefined,
      })),
  }, null, 2);
}

function redactMediaRef(media: StoryboardItem["mediaRef"] | StoryboardItem["audioRef"]): Record<string, unknown> | undefined {
  if (!media) return undefined;
  return {
    kind: media.kind,
    fileName: media.path.split(/[\\/]/).pop() || media.path,
    contentSha256: media.contentSha256,
    imageWorkflowId: media.imageWorkflowId,
    imageWorkflowNodeId: media.imageWorkflowNodeId,
  };
}

function projectCanonicalStoryboardItem(item: StoryboardItem): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of CANONICAL_STORYBOARD_FIELDS) {
    const value = field === "cinematic"
      ? (item as CinematicStoryboardItem).cinematic
      : item[field as keyof StoryboardItem];
    if (value === undefined) continue;
    if (field === "mediaRef" || field === "audioRef") {
      const media = serializeCanonicalMediaRef(value as StoryboardItem["mediaRef"] | StoryboardItem["audioRef"]);
      if (media) projected[field] = media;
      continue;
    }
    if (field === "keyframes") {
      const frames = serializeCanonicalKeyframes(value as StoryboardItem["keyframes"]);
      if (frames) projected[field] = frames;
      continue;
    }
    if (field === "cinematic") {
      projected[field] = value;
      continue;
    }
    projected[field] = value;
  }
  return projected;
}

function serializeCanonicalMediaRef(
  media: StoryboardItem["mediaRef"] | StoryboardItem["audioRef"],
): Record<string, unknown> | undefined {
  if (!media || !isPersistableMediaPath(media.path)) return undefined;
  return {
    kind: media.kind,
    path: media.path,
    ...(media.contentSha256 ? { contentSha256: media.contentSha256 } : {}),
    ...(media.imageWorkflowId ? { imageWorkflowId: media.imageWorkflowId } : {}),
    ...(media.imageWorkflowNodeId ? { imageWorkflowNodeId: media.imageWorkflowNodeId } : {}),
  };
}

/** C3 门禁收口:关键帧序列的 canonical 序列化(逐帧路径走持久化纪律,空槽整帧丢弃) */
function serializeCanonicalKeyframes(frames: StoryboardItem["keyframes"]): unknown[] | undefined {
  if (!frames?.length) return undefined;
  const serialized = frames
    .map((frame) => {
      const media = serializeCanonicalMediaRef(frame.mediaRef);
      if (!media) return undefined;
      return {
        frameId: frame.frameId,
        mediaRef: media,
        inUs: frame.inUs,
        ...(frame.origin ? { origin: frame.origin } : {}),
      };
    })
    .filter((frame) => frame !== undefined);
  return serialized.length ? serialized : undefined;
}

function isPersistableMediaPath(path: string, projectId?: string): boolean {
  const normalized = path.trim();
  if (!normalized) return false;
  if (/^(?:https?|blob|data|file|capability|session):/i.test(normalized)) return false;
  if (/[?&#](?:token|session|auth|access_token)=/i.test(normalized)) return false;
  if (normalized.startsWith("project-file://")) {
    const rest = normalized.slice("project-file://".length);
    const separator = rest.indexOf("/");
    if (separator <= 0 || separator === rest.length - 1) return false;
    let owner = "";
    try {
      owner = decodeURIComponent(rest.slice(0, separator));
    } catch {
      return false;
    }
    if (projectId && owner !== projectId) return false;
    const relativePath = rest.slice(separator + 1).split("/").map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return "";
      }
    });
    return relativePath.every((part) => part && part !== "." && part !== "..");
  }
  if (/(?:^|[\\/])(?:tmp|temp|runtime|cache)(?:[\\/]|$)/i.test(normalized)) return false;
  return true;
}

export function validateStoryboardJson(raw: string, episodeId: string, projectId?: string): { items?: StoryboardItem[]; error?: string } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) { return { error: `JSON 解析失败: ${error instanceof Error ? error.message : "语法错误"}` }; }
  if (!Array.isArray(value) || value.length === 0) return { error: "必须是非空分镜数组" };
  const ids = new Set<string>(); const indexes = new Set<number>();
  const items: StoryboardItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { error: "分镜记录必须是对象" };
    const unknownFields = Object.keys(item).filter((field) => !CANONICAL_STORYBOARD_FIELDS.includes(field as CanonicalStoryboardField));
    if (unknownFields.length) return { error: `分镜存在不可编辑字段: ${unknownFields.join(", ")}` };
    const shot = item as Partial<StoryboardItem>;
    if (typeof shot.id !== "string" || !shot.id) return { error: "分镜 id 必须存在" };
    if (shot.sourceId !== undefined && (typeof shot.sourceId !== "string" || !shot.sourceId.trim())) {
      return { error: `分镜 ${shot.id} sourceId 无效` };
    }
    if (shot.revision !== undefined && (!Number.isInteger(shot.revision) || (shot.revision as number) < 1)) {
      return { error: `分镜 ${shot.id} revision 无效` };
    }
    if (ids.has(shot.id)) return { error: `重复分镜 id: ${shot.id}` }; ids.add(shot.id);
    if (shot.episodeId !== episodeId) return { error: `分镜 ${shot.id} 不属于当前章节` };
    if (!Number.isInteger(shot.index) || (shot.index as number) < 1 || indexes.has(shot.index as number)) return { error: `分镜 ${shot.id} 序号无效或重复` }; indexes.add(shot.index as number);
    if (typeof shot.duration !== "number" || !Number.isFinite(shot.duration) || shot.duration <= 0 || shot.duration > 3600) return { error: `分镜 ${shot.id} 时长无效` };
    if (!STORYBOARD_STATES.has(shot.state as StoryboardItem["state"])) return { error: `分镜 ${shot.id} 状态无效` };
    if (typeof shot.trackKey !== "string" || typeof shot.trackId !== "string") return { error: `分镜 ${shot.id} 轨道信息无效` };
    if (typeof shot.prompt !== "string" || typeof shot.videoDesc !== "string") return { error: `分镜 ${shot.id} 提示词字段无效` };
    if (!Array.isArray(shot.assetIds) || shot.assetIds.some((assetId) => typeof assetId !== "string")) return { error: `分镜 ${shot.id} 资产引用无效` };
    const cinematic = (shot as Partial<CinematicStoryboardItem>).cinematic;
    const cinematicError = validateStoryboardCinematic(cinematic);
    if (cinematicError) return { error: `分镜 ${shot.id} ${cinematicError}` };
    for (const [field, media] of [["mediaRef", shot.mediaRef], ["audioRef", shot.audioRef]] as const) {
      if (media === undefined) continue;
      if (!media || typeof media !== "object" || !["image", "video", "audio"].includes(media.kind) || typeof media.path !== "string" || !media.path.trim()) {
        return { error: `分镜 ${shot.id} ${field} 媒体引用无效` };
      }
      if (!isPersistableMediaPath(media.path, projectId)) {
        return { error: `分镜 ${shot.id} ${field} 路径包含运行时 URL、凭据或临时路径` };
      }
    }
    if (shot.keyframes !== undefined) {
      if (!Array.isArray(shot.keyframes) || shot.keyframes.length === 0 || shot.keyframes.length > 4) {
        return { error: `分镜 ${shot.id} keyframes 须为 1..4 帧数组` };
      }
      if (shot.keyframes[0].inUs !== 0) {
        return { error: `分镜 ${shot.id} keyframes 首帧 inUs 须为 0` };
      }
      const frameIds = new Set<string>();
      for (let frameIndex = 0; frameIndex < shot.keyframes.length; frameIndex += 1) {
        const frame = shot.keyframes[frameIndex];
        if (!frame || typeof frame !== "object" || typeof frame.frameId !== "string" || !frame.frameId.trim()) {
          return { error: `分镜 ${shot.id} 第 ${frameIndex + 1} 帧 frameId 无效` };
        }
        if (frameIds.has(frame.frameId)) {
          return { error: `分镜 ${shot.id} frameId 重复: ${frame.frameId}` };
        }
        frameIds.add(frame.frameId);
        if (typeof frame.inUs !== "number" || !Number.isFinite(frame.inUs) || frame.inUs < 0) {
          return { error: `分镜 ${shot.id} 第 ${frameIndex + 1} 帧 inUs 无效` };
        }
        if (frameIndex > 0 && frame.inUs <= shot.keyframes[frameIndex - 1].inUs) {
          return { error: `分镜 ${shot.id} keyframes inUs 须严格递增` };
        }
        const media = frame.mediaRef;
        if (media === undefined) continue;
        if (
          !media
          || typeof media !== "object"
          || !["image", "video", "audio"].includes(media.kind)
          || typeof media.path !== "string"
          || !media.path.trim()
        ) {
          return { error: `分镜 ${shot.id} 第 ${frameIndex + 1} 帧媒体引用无效` };
        }
        if (!isPersistableMediaPath(media.path, projectId)) {
          return { error: `分镜 ${shot.id} 第 ${frameIndex + 1} 帧路径包含运行时 URL、凭据或临时路径` };
        }
      }
    }
    items.push(projectCanonicalStoryboardItem(shot as StoryboardItem) as unknown as StoryboardItem);
  }
  return { items };
}
