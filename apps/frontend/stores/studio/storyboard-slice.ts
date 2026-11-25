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
  StoryboardImageReview,
  ContinuityAssetVersion,
} from "@/types/studio";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";
import { sha256FromBase64Image } from "@/lib/studio/image-content-hash";
import { createStudioWorkflowId } from "./studio-store-runtime";
import {
  mergeStoryboardReplacement,
  storyboardSourceFingerprint,
  storyboardTextLayerFingerprint,
} from "./studio-store-continuity-helpers";
import {
  createHumanVisualReview,
  createVlmVisualReview,
  markContinuityDependentsStale,
  visualReviewInputFingerprint,
} from "@/lib/studio/visual-continuity";
import {
  normalizeStoryboardKeyframes,
  validateStoryboardKeyframes,
} from "@/lib/studio/keyframes";
import { normalizeH3DurationUs } from "@/lib/studio/h3-duration-us";

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
  /**
   * 图片级人审唯一写入口(1125 硬门):批准/驳回当前分镜图。imageBase64=审核时
   * 实际看到的图片字节(调用点经 readStoryboardImageB64 读盘),action 内计算
   * SHA-256 落库作发车对账指纹。其余任何代码禁止直写 imageReview
   * (updateStoryboard 同 visualReview 一并剥离)。
   */
  reviewStoryboardImage: (
    id: string,
    input: {
      status: "approved" | "rejected";
      /** 具名角色各只出现一次(重复人物门);approved 时必须为 true。 */
      singleAppearancePassed: boolean;
      reasons: string[];
      imageBase64: string;
      evidencePath?: string;
    },
  ) => Promise<void>;
  writeStoryboardVlmReview: (id: string, artifact: VlmReviewArtifactV1, evidencePath?: string) => void;
  bindStoryboardMedia: (
    id: string,
    mediaRef: StoryboardMediaRef,
    /** B1(09-29):video 落账的 ffprobe 实测时长(微秒);先 probe 后调,非法值经守卫拒收。 */
    h3DurationUs?: number,
  ) => void;
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
            if (!previous) {
              return {
                ...item,
                sourceFingerprint:
                  item.sourceFingerprint ?? storyboardSourceFingerprint(item),
              };
            }
            const next: StoryboardItem = { ...previous, ...item };
            // W1(1112 验尸 .trellis/tasks/11-12-storyboard-asset-refchain-repair):
            // toStoryboardItems 产出的文本层条目不含 continuityState/
            // orderedReferenceManifest 键——此前被 {...previous} 静默继承,旧
            // continuity 层随新文本原样带进 next,撕裂(旧锚定 vs 新文本)对
            // 指纹比对不可见。改为:文本层指纹真变了才失效两层(缺失=待生图
            // 回写 landStoryboardContinuity 重建);文本未变的重新保存零扰动
            // (continuity 原样保留,全指纹稳定,不误标脏)。
            if (
              storyboardTextLayerFingerprint(previous)
              !== storyboardTextLayerFingerprint(next)
            ) {
              next.continuityState = item.continuityState;
              next.orderedReferenceManifest = item.orderedReferenceManifest;
            }
            // 1120 复核②修:镜 id 确定性派生(sb-{episodeId}-{index}),重跑分镜表
            // 同 index 恒同 id——新表产物(toStoryboardItems)不含 assetBindings 键,
            // {...previous} 会把旧绑定整体继承到阵容已换的新镜(发车校验旧行仍
            // 可解析有图即放行=「绑定已核」假象)。阵容变了才失效(未变的重新
            // 保存零扰动,与 W1 同纪律);失效后读路按 associateAssetsNames 推导
            // 兼容(resolveStoryboardAssetBindings),重跑绑定重建契约。
            if (
              (previous.associateAssetsNames ?? []).join("\n")
              !== (item.associateAssetsNames ?? []).join("\n")
            ) {
              next.assetBindings = item.assetBindings;
            }
            return mergeStoryboardReplacement(
              previous,
              next,
              "storyboard source changed",
            );
          }),
        ],
      }));
      get().rebuildTracks();
    },

    updateStoryboard: (id: string, updates: Partial<StoryboardItem>): void => {
      const {
        visualReview: _ignoredVisualReview,
        imageReview: _ignoredImageReview,
        ...safeUpdates
      } = updates;
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

    reviewStoryboardImage: async (
      id: string,
      input: {
        status: "approved" | "rejected";
        singleAppearancePassed: boolean;
        reasons: string[];
        imageBase64: string;
        evidencePath?: string;
      },
    ): Promise<void> => {
      const storyboard = get().storyboards.find((item) => item.id === id);
      if (!storyboard) throw new Error(`分镜 ${id} 不存在`);
      if (storyboard.mediaRef?.kind !== "image" || !storyboard.mediaRef.path?.trim()) {
        throw new Error(`分镜 ${id} 没有待人审的分镜图`);
      }
      const reasons = input.reasons.map((reason) => reason.trim()).filter(Boolean);
      if (input.status === "approved" && !input.singleAppearancePassed) {
        throw new Error(`分镜 ${id} 通过人审前必须确认「具名角色各只出现一次」`);
      }
      if (input.status === "rejected" && reasons.length === 0) {
        throw new Error(`分镜 ${id} 驳回时必须填写原因`);
      }
      let contentSha256: string;
      try {
        contentSha256 = await sha256FromBase64Image(input.imageBase64);
      } catch (error) {
        throw new Error(`分镜 ${id} 图片内容指纹计算失败:${(error as Error).message}`);
      }
      const imageReview: StoryboardImageReview = {
        status: input.status,
        reviewedAt: Date.now(),
        reasons,
        singleAppearancePassed: input.status === "approved" ? input.singleAppearancePassed : false,
        contentSha256,
        evidencePath: input.evidencePath?.trim() || undefined,
      };
      set((state) => ({
        storyboards: state.storyboards.map((item) =>
          item.id === id ? { ...item, imageReview } : item,
        ),
      }));
    },

    writeStoryboardVlmReview: (id: string, artifact: VlmReviewArtifactV1, evidencePath?: string): void => {
      const storyboard = get().storyboards.find((item) => item.id === id);
      if (!storyboard) return;
      const visualReview = createVlmVisualReview(storyboard, artifact, evidencePath);
      if (!visualReview) return;
      set((state) => ({
        storyboards: state.storyboards.map((item) => item.id === id ? { ...item, visualReview } : item),
      }));
    },

    bindStoryboardMedia: (
      id: string,
      mediaRef: StoryboardMediaRef,
      h3DurationUs?: number,
    ): void => {
      // B1(09-29):video 落账带真实时长(正整数微秒守卫,非法拒收);换片
      // 时长未知则清空旧值——旧片实测时长不得冒充新片。image/audio 不触碰
      // 该字段(仅 video 镜有意义,types 口径)。
      get().updateStoryboard(id, {
        mediaRef,
        ...(mediaRef.kind === "video" ? { h3DurationUs: normalizeH3DurationUs(h3DurationUs) } : {}),
      });
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
      reason: "backfill" | "generate" | "upscale" | "plan" | "edit",
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
      // I1 首帧镜像:mediaRef 与 keyframes[0] 同源双写(空槽规划不覆盖现有 mediaRef)。
      // H3 视频时代修正(09-14 深审):mediaRef=video 时是「当前视觉资产=成片」,
      // 关键帧操作不得把它打回首帧图(视频只存 videoCandidates,打回=镜状态倒退)
      const firstImage = normalized.find((frame) => frame.mediaRef?.path);
      const updates: Partial<StoryboardItem> = { keyframes: normalized };
      if (firstImage && reason !== "plan" && current.mediaRef?.kind !== "video") {
        updates.mediaRef = firstImage.mediaRef;
        // 媒体落地即 ready(与生图回写 buildStoryboardImageWorkflowPatch 同语义;
        // 回接首跑实证缺口:帧全图而 state=idle 把整镜挡在编译门外)
        updates.state = "ready";
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
