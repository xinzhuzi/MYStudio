/**
 * Storyboard slice — 从 studio-store.ts 拆出(Child 2 R3 Step 9)。
 *
 * 6 个 storyboard actions。依赖:rebuildTracks(production 域)、updateStoryboard
 * (本 slice)、startMediaTask/finishMediaTask(agent 域)、continuityAssetVersions(读)。
 * 全部通过注入的 get() 访问跨域,行为与原内联实现 1:1 一致。
 */
import type {
  StoryboardItem,
  StoryboardMediaRef,
  StoryboardKeyframe,
  HumanVisualReviewInput,
  ContinuityAssetVersion,
} from "@/types/studio";
import { createStudioWorkflowId } from "./studio-store-runtime";
import {
  mergeStoryboardReplacement,
  storyboardSourceFingerprint,
} from "./studio-store-continuity-helpers";
import {
  createHumanVisualReview,
  markContinuityDependentsStale,
  visualReviewInputFingerprint,
} from "@/lib/studio/visual-continuity";
import {
  normalizeStoryboardKeyframes,
  validateStoryboardKeyframes,
} from "@/lib/studio/keyframes";

/** Storyboard slice 契约。 */
export interface StoryboardSlice {
  storyboards: StoryboardItem[];
  addStoryboard: (item?: Partial<StoryboardItem>) => string;
  replaceStoryboardsForEpisode: (episodeId: string, items: StoryboardItem[]) => void;
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
  /**
   * 关键帧序列唯一写入口(design §1.2):校验 I2~I4 → 写 keyframes +
   * 首帧镜像 mediaRef(I1) → 指纹级联(改帧打回审核/标 stale)→ 媒体任务轨迹。
   * 其他任何地方禁止手拼 keyframes。
   */
  setStoryboardKeyframes: (
    id: string,
    frames: StoryboardKeyframe[],
    reason: "backfill" | "generate" | "upscale" | "plan" | "edit",
  ) => void;
  writeStoryboardAudio: (
    id: string,
    updates: Pick<
      StoryboardItem,
      | "audioRef"
      | "shotAudioBindings"
      | "ttsJob"
      | "ttsGenerationId"
      | "ttsBackend"
      | "ttsMocked"
      | "ttsEmotionCapability"
      | "ttsWarning"
    >,
  ) => void;
  reviewStoryboardHuman: (id: string, review: HumanVisualReviewInput) => void;
  bindStoryboardMedia: (id: string, mediaRef: StoryboardMediaRef) => void;
}

/** slice 能看到的 store 局部视图 + 跨域依赖。 */
interface StoryboardSliceStore {
  storyboards: StoryboardItem[];
  continuityAssetVersions: ContinuityAssetVersion[];
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
  rebuildTracks: () => void;
  startMediaTask: (input: {
    kind: string;
    targetId: string;
    episodeId?: string;
    provider?: string;
    inputFingerprint?: string;
  }) => string;
  finishMediaTask: (
    id: string,
    output?: { outputRef?: string; outputRefs?: string[] },
  ) => void;
}

type SetFn = (
  fn: (state: StoryboardSliceStore) => Partial<StoryboardSliceStore>,
) => void;
type GetFn = () => StoryboardSliceStore;

/** storyboard slice 的 action 实现。 */
export function createStoryboardSliceActions(set: SetFn, get: GetFn) {
  return {
    addStoryboard: (item: Partial<StoryboardItem> = {}): string => {
      const id = item.id ?? createStudioWorkflowId("sb");
      const storyboard: StoryboardItem = {
        id,
        episodeId: item.episodeId ?? "episode-1",
        index: item.index ?? get().storyboards.length + 1,
        trackKey: item.trackKey ?? `track-${get().storyboards.length + 1}`,
        trackId: item.trackId ?? "",
        duration: item.duration ?? 5,
        prompt: item.prompt ?? "",
        videoDesc: item.videoDesc ?? "",
        assetIds: item.assetIds ?? [],
        mediaRef: item.mediaRef,
        imageWorkflowId: item.imageWorkflowId,
        imageWorkflowNodeId: item.imageWorkflowNodeId,
        shouldGenerateImage: item.shouldGenerateImage,
        sourceEvidence: item.sourceEvidence,
        orderedReferenceManifest: item.orderedReferenceManifest,
        shotSemantics: item.shotSemantics,
        continuityState: item.continuityState,
        visualReview: item.visualReview,
        audioRef: item.audioRef,
        state: item.state ?? "idle",
        reason: item.reason,
        stale: item.stale,
        staleReason: item.staleReason,
        staleSince: item.staleSince,
        sourceRunId: item.sourceRunId,
        sourceFingerprint: item.sourceFingerprint ?? storyboardSourceFingerprint(item),
        outputVersion: item.outputVersion,
        emotion: item.emotion,
        orientation: item.orientation,
        spatialRelation: item.spatialRelation,
        associateAssetsNames: item.associateAssetsNames,
        lines: item.lines,
        speakerId: item.speakerId,
        sound: item.sound,
      };
      set((state) => ({ storyboards: [...state.storyboards, storyboard] }));
      get().rebuildTracks();
      return id;
    },

    replaceStoryboardsForEpisode: (
      episodeId: string,
      items: StoryboardItem[],
    ): void => {
      set((state) => ({
        storyboards: [
          ...state.storyboards.filter((item) => item.episodeId !== episodeId),
          ...items.map((item) => {
            const previous =
              state.storyboards.find((current) => current.id === item.id) ??
              state.storyboards.find(
                (current) =>
                  current.episodeId === episodeId && current.index === item.index,
              );
            return previous
              ? mergeStoryboardReplacement(
                  previous,
                  { ...previous, ...item },
                  "storyboard source changed",
                )
              : {
                  ...item,
                  sourceFingerprint:
                    item.sourceFingerprint ?? storyboardSourceFingerprint(item),
                };
          }),
        ],
      }));
      get().rebuildTracks();
    },

    updateStoryboard: (id: string, updates: Partial<StoryboardItem>): void => {
      const { visualReview: _ignoredVisualReview, ...safeUpdates } = updates;
      if (Object.keys(safeUpdates).length === 0) return;
      const previous = get().storyboards.find((item) => item.id === id);
      const previousReviewFingerprint = previous
        ? visualReviewInputFingerprint(previous)
        : undefined;
      set((state) => ({
        storyboards: state.storyboards.map((item) =>
          item.id === id
            ? mergeStoryboardReplacement(
                item,
                { ...item, ...safeUpdates },
                "storyboard source changed",
              )
            : item,
        ),
      }));
      const current = get().storyboards.find((item) => item.id === id);
      if (
        previousReviewFingerprint &&
        current &&
        previousReviewFingerprint !== visualReviewInputFingerprint(current)
      ) {
        set((state) => ({
          storyboards: markContinuityDependentsStale(
            state.storyboards.map((item) =>
              item.id === id && item.visualReview
                ? {
                    ...item,
                    visualReview: {
                      ...item.visualReview,
                      status: "pending" as const,
                      reasons: ["分镜画面或连续性输入已变化，必须重新审核"],
                    },
                  }
                : item,
            ),
            id,
          ),
        }));
      }
      get().rebuildTracks();
    },

    writeStoryboardAudio: (
      id: string,
      updates: Partial<StoryboardItem>,
    ): void => {
      set((state) => ({
        storyboards: state.storyboards.map((item) =>
          item.id === id ? { ...item, ...updates } : item,
        ),
      }));
      get().rebuildTracks();
    },

    reviewStoryboardHuman: (
      id: string,
      reviewInput: HumanVisualReviewInput,
    ): void => {
      const storyboard = get().storyboards.find((item) => item.id === id);
      if (!storyboard) throw new Error(`分镜 ${id} 不存在`);
      const visualReview = createHumanVisualReview(
        storyboard,
        reviewInput,
        get().continuityAssetVersions,
      );
      set((state) => ({
        storyboards: state.storyboards.map((item) =>
          item.id === id ? { ...item, visualReview } : item,
        ),
      }));
    },

    bindStoryboardMedia: (id: string, mediaRef: StoryboardMediaRef): void => {
      get().updateStoryboard(id, { mediaRef });
      // I1 镜像维护:绑新图(超分换轨等)时同步首帧,防 mediaRef 与 keyframes[0] 分叉
      const current = get().storyboards.find((item) => item.id === id);
      if (mediaRef.kind === "image" && current?.keyframes?.length) {
        const patched = current.keyframes.map((frame, index) =>
          index === 0 ? { ...frame, mediaRef } : frame,
        );
        set((state) => ({
          storyboards: state.storyboards.map((item) =>
            item.id === id ? { ...item, keyframes: patched } : item,
          ),
        }));
      }
      const storyboard = get().storyboards.find((item) => item.id === id);
      const taskId = get().startMediaTask({
        kind: mediaRef.kind === "audio" ? "ttsAudio" : "storyboardImage",
        targetId: id,
        episodeId: storyboard?.episodeId,
        provider: mediaRef.kind,
        inputFingerprint: storyboard
          ? storyboardSourceFingerprint(storyboard)
          : undefined,
      });
      get().finishMediaTask(taskId, {
        outputRef: mediaRef.path,
        outputRefs: [
          mediaRef.path,
          mediaRef.imageWorkflowId,
          mediaRef.imageWorkflowNodeId,
        ].filter((ref): ref is string => Boolean(ref)),
      });
    },

    setStoryboardKeyframes: (
      id: string,
      frames: StoryboardKeyframe[],
      reason,
    ): void => {
      const current = get().storyboards.find((item) => item.id === id);
      if (!current) return;
      const normalized = normalizeStoryboardKeyframes(frames);
      const shotDurationUs =
        (current.durationTarget ?? current.duration ?? 0) * 1_000_000 || undefined; // 秒→µs
      const issues = validateStoryboardKeyframes(normalized, {
        shotDurationUs,
        // 建槽与增量生成允许空槽(帧逐个补齐是合法中间态);回接/超分/编辑必须全有图
        allowEmptySlots: reason === "plan" || reason === "generate",
      });
      if (issues.length) {
        throw new Error(`关键帧序列非法(${reason}):${issues.join(";")}`);
      }
      // I1 首帧镜像:mediaRef 与 keyframes[0] 同源双写(空槽规划不覆盖现有 mediaRef)
      const firstImage = normalized.find((frame) => frame.mediaRef?.path);
      const updates: Partial<StoryboardItem> = { keyframes: normalized };
      if (firstImage && reason !== "plan") {
        updates.mediaRef = firstImage.mediaRef;
      }
      get().updateStoryboard(id, updates);
      const storyboard = get().storyboards.find((item) => item.id === id);
      if (storyboard) {
        const taskId = get().startMediaTask({
          kind: "storyboardImage",
          targetId: id,
          episodeId: storyboard.episodeId,
          provider: "keyframes",
          inputFingerprint: storyboardSourceFingerprint(storyboard),
        });
        get().finishMediaTask(taskId, {
          outputRefs: storyboard.keyframes
            ?.map((frame) => frame.mediaRef?.path)
            .filter((path): path is string => Boolean(path)),
        });
      }
    },
  };
}
