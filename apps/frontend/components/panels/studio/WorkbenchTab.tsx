import { Button } from "@/components/ui/button";
import { buildProjectFileUrl } from "@/lib/artifacts/ref-preview-loader";
import { getCinematicPresetShortLabel, getStoryboardCinematic } from "@/lib/studio/cinematic-preset";
import { comfyImageUrlToB64, runComfyExecute, persistComfyAudio } from "@/lib/assist/image-studio/comfy-execute";
import { unwrapComfyApiGraph } from "@/lib/assist/image-studio/comfy-workflow-import";
import { getComfyWorkflowLibraryTransport } from "@/lib/assist/image-studio/comfy-workflow-library";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ScriptPlan } from "@/types/studio";
import { createRemotionAudioBindingFingerprint, createRemotionChapterManifestFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import type { RemotionChapterAudioBindingV2, RemotionChapterManifestV2, RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import { Film } from "lucide-react";
import * as abcjs from "abcjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { NativeRemotionStudioHost } from "./NativeRemotionStudioHost";
import { SfxGenerateDialog } from "./SfxGenerateDialog";
import { VisualContinuityReviewPanel } from "./VisualContinuityReviewPanel";
import {
  YUE2_BGM_BATCH_COUNT_OPTIONS,
  YUE2_BGM_LYRICS_IRON,
  bgmBatchInitialState,
  formatBgmBatchDuration,
  formatBgmBatchProgress,
  generateBgmBatch,
  type BgmBatchCandidate,
  type BgmBatchCount,
  type BgmBatchState,
} from "./bgm-batch";
import {
  YUE2_ABC_API_WORKFLOW_ID,
  YUE2_BGM_RENDER_API_WORKFLOW_ID,
  bgmScoreInitialState,
  bgmScoreReducer,
  generateBgmScore,
  isRenderableAbc,
  isScoreBusy,
  renderBgmByScore,
  type BgmScoreState,
} from "./bgm-score";
import {
  YUE2_COVER_API_WORKFLOW_ID,
  bgmCoverInitialState,
  bgmCoverReducer,
  formatBgmCoverHint,
  generateBgmCover,
  toBgmCoverAssetOptions,
  type BgmCoverState,
} from "./bgm-cover";
import { useEditingWorkbenchActions } from "./useEditingWorkbenchActions";
import { selectFirstStoryboard, useFirstShotPreviewActions } from "./use-first-shot-preview-actions";
import { useRemotionQueueScope } from "./useRemotionQueueScope";
import { useSceneSegmentExport } from "./useSceneSegmentExport";
import { SceneSegmentExportDialog, SceneSegmentExportProgress } from "./SceneSegmentExportDialog";
import { toast } from "sonner";
import { VideoWorkflowReviewPanel } from "./VideoWorkflowReviewPanel";
import { ShotProductionOverview } from "./ShotProductionOverview";
import type { VideoUseDerivedInputPolicy, VideoUseStoryboardSourcePolicy } from "@rendering/contracts/video-workflow";
import { countCurrentShotSlots, formatFirstShotStatus, isCurrentChapterReady, resolveWorkbenchRemotionShotSlots, selectCurrentShotJobForStoryboard, summarizeSubtitleAuthority } from "./workbench-status";

/** 库内 YuE2 BGM API 工作流(repo 源只读 id;桥模板格式,画布侧栏不可见)。 */
const YUE2_BGM_API_WORKFLOW_ID = "repo:3_声音/Yue2/yue2-bgm-纯音乐-lora版.api.json";
/** 09-20 实弹定稿的纯音乐构图默认值(风格与歌词五标签铁律,照库工作流原值)。 */
const YUE2_BGM_STYLE_DEFAULT = "guzheng and bamboo flute, serene traditional chinese instrumental, pentatonic, slow 65 bpm, cinematic ambience";

export function WorkbenchTab(props: {
  projectId?: string;
  projectName?: string;
  episodeId?: string;
  directorPlan?: ScriptPlan;
  aspectRatio?: string;
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  remotionShotSlots?: RemotionCurrentSlotV1[];
  /** 返回工作流节点图(单镜生产/工作台阶段顶部「返回节点图」按钮) */
  onBackToCanvas?: () => void;
  /** Legacy fixture compatibility; formal UI never reads these fields. */
  tracks?: ReturnType<typeof useStudioStore.getState>["productionTracks"];
  candidates?: ReturnType<typeof useStudioStore.getState>["videoCandidates"];
}) {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const reviewStoryboardHuman = useStudioStore((state) => state.reviewStoryboardHuman);
  const continuityAssetVersions = useStudioStore((state) => state.continuityAssetVersions);
  const reviewContinuityAssetVersionHuman = useStudioStore((state) => state.reviewContinuityAssetVersionHuman);
  const chapterId = props.episodeId ?? "episode-1";
  const queueScope = useRemotionQueueScope(props.projectId ?? activeProjectId ?? undefined, chapterId);
  const [sceneSegmentDialogOpen, setSceneSegmentDialogOpen] = useState(false);
  const [sceneSegmentSelection, setSceneSegmentSelection] = useState<Set<number>>(new Set());
  const sceneSegmentExport = useSceneSegmentExport({
    projectId: props.projectId ?? activeProjectId ?? undefined,
    chapterId,
    queueJobs: queueScope.jobs,
  });
  const remotionShotSlots = resolveWorkbenchRemotionShotSlots(queueScope, props.remotionShotSlots);
  const [videoUseStoryboardSourcePolicy, setVideoUseStoryboardSourcePolicy] = useState<VideoUseStoryboardSourcePolicy>("current-ready");
  const editing = useEditingWorkbenchActions({
    projectId: props.projectId ?? activeProjectId ?? undefined,
    projectName: props.projectName ?? "漫影工作室项目",
    episodeId: props.episodeId ?? "episode-1",
    directorPlan: props.directorPlan,
    aspectRatio: props.aspectRatio,
    storyboards: props.storyboards,
    remotionShotSlots,
    storyboardSourcePolicy: videoUseStoryboardSourcePolicy,
  });
  const chapterReady = isCurrentChapterReady(
    chapterId,
    props.storyboards,
    remotionShotSlots,
    videoUseStoryboardSourcePolicy,
  );
  const currentChapterStoryboards = props.storyboards
    .filter((storyboard) => storyboard.episodeId === chapterId)
    .slice()
    .sort((left, right) => left.index - right.index);
  const currentChapterSlotCount = countCurrentShotSlots(chapterId, props.storyboards, remotionShotSlots, videoUseStoryboardSourcePolicy);
  const subtitleAuthoritySummary = summarizeSubtitleAuthority(currentChapterStoryboards);
  const firstShotPreview = useFirstShotPreviewActions({
    projectId: props.projectId ?? activeProjectId ?? undefined,
    chapterId,
    storyboards: props.storyboards,
    continuityAssetVersions: continuityAssetVersions,
  });
  const firstStoryboard = selectFirstStoryboard(props.storyboards, chapterId);
  const firstShotRevision = Math.max(1, firstStoryboard?.outputVersion ?? 1);
  const firstShotJob = firstStoryboard
    ? selectCurrentShotJobForStoryboard(firstStoryboard, queueScope.jobs, queueScope.currentShotSlots)
    : undefined;
  const firstShotSlot = firstStoryboard
    ? queueScope.currentShotSlots.find((slot) => slot.target.kind === "shot" && slot.target.shotId === firstStoryboard.id && slot.target.shotRevision === firstShotRevision)
    : undefined;
  const firstShotOutputRequestVersion = useRef(0);
  const [firstShotAbsoluteOutputPath, setFirstShotAbsoluteOutputPath] = useState<string>();
  const [firstShotOutputPathError, setFirstShotOutputPathError] = useState<string>();
  const [videoUseMode, setVideoUseMode] = useState<"editable-edl" | "flat-shot-mp4">("editable-edl");
  const [videoUseDerivedInputPolicy, setVideoUseDerivedInputPolicy] = useState<VideoUseDerivedInputPolicy>("reject");
  const hyperFramesReady = editing.hyperFramesState === "accepted" || editing.hyperFramesState === "noop";
  const remotionHostReady = Boolean(
    editing.currentProject
    && chapterReady
    && editing.videoUseState === "accepted"
    && hyperFramesReady,
  );
  useEffect(() => {
    const requestVersion = ++firstShotOutputRequestVersion.current;
    const projectId = props.projectId ?? activeProjectId ?? undefined;
    const relativeOutputPath = firstShotSlot?.outputPath;
    setFirstShotAbsoluteOutputPath(undefined);
    setFirstShotOutputPathError(undefined);
    if (!relativeOutputPath) return;
    const resolveAbsolutePath = window.projectFiles?.getAbsolutePath;
    if (!projectId || !resolveAbsolutePath) {
      setFirstShotOutputPathError("当前环境无法解析首镜输出路径");
      return;
    }
    const projectFileUrl = buildProjectFileUrl(projectId, `remotion/${relativeOutputPath}`);
    void resolveAbsolutePath(projectFileUrl).then((absolutePath) => {
      if (requestVersion !== firstShotOutputRequestVersion.current) return;
      if (absolutePath) setFirstShotAbsoluteOutputPath(absolutePath);
      else setFirstShotOutputPathError("首镜 current slot 文件不存在或路径无效");
    }).catch((error) => {
      if (requestVersion !== firstShotOutputRequestVersion.current) return;
      setFirstShotOutputPathError(error instanceof Error ? error.message : String(error));
    });
  }, [activeProjectId, firstShotSlot?.outputPath, props.projectId]);
  const [chapterManifest, setChapterManifestState] = useState<RemotionChapterManifestV2 | null>(null);
  // 09-20 竞态修复:manifest 写入一律经 ref 取最新快照——分钟级 BGM 生成等长任务结束时,
  // 旧闭包携带的 chapterManifest 可能已过时,用它打乐观锁必然 revision_conflict(生成音频成孤儿)。
  const chapterManifestRef = useRef<RemotionChapterManifestV2 | null>(null);
  const setChapterManifest = useCallback((next: RemotionChapterManifestV2 | null) => {
    chapterManifestRef.current = next;
    setChapterManifestState(next);
  }, []);
  const [chapterAudioStatus, setChapterAudioStatus] = useState("未读取");
  const [chapterAudioBusy, setChapterAudioBusy] = useState(false);
  const [chapterAudioError, setChapterAudioError] = useState<string | null>(null);
  const [sfxGenerateTarget, setSfxGenerateTarget] = useState<{ shotId: string; label: string } | null>(null);
  const manifestRequestVersion = useRef(0);
  const refreshChapterManifest = useCallback(async () => {
    const requestVersion = ++manifestRequestVersion.current;
    const bridge = window.remotionChapterManifest;
    const projectId = props.projectId;
    if (!bridge || !projectId) {
      setChapterManifest(null);
      setChapterAudioStatus("桌面 bridge 不可用");
      return;
    }
    try {
      const reply = await bridge.read({ projectId, chapterId });
      if (requestVersion !== manifestRequestVersion.current) return;
      if (reply.status === "ready") {
        setChapterManifest(reply.manifest);
        setChapterAudioStatus("已加载");
      } else {
        setChapterManifest(null);
        setChapterAudioStatus("未配置");
      }
      setChapterAudioError(null);
    } catch (error) {
      setChapterAudioStatus("读取失败");
      setChapterAudioError(error instanceof Error ? error.message : String(error));
    }
  }, [chapterId, props.projectId, setChapterManifest]);
  useEffect(() => {
    void refreshChapterManifest();
  }, [refreshChapterManifest]);

  // 三段链路日志包导出: Remotion evidence + video-use + HyperFrames + 诊断日志.
  const [logBundleExporting, setLogBundleExporting] = useState(false);
  const exportLogBundle = useCallback(async () => {
    const bridge = window.videoPipelineLogBundle;
    const projectId = props.projectId;
    if (!bridge || !projectId) {
      toast.error("日志包导出仅在桌面应用中可用");
      return;
    }
    setLogBundleExporting(true);
    try {
      const result = await bridge.export({ projectId, chapterId });
      if (result.success && result.path) {
        toast.success(`制作日志包已导出: ${result.path}`);
      } else {
        toast.error(result.error ?? "日志包导出失败");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "日志包导出失败");
    } finally {
      setLogBundleExporting(false);
    }
  }, [chapterId, props.projectId]);
  const writeSharedAudio = useCallback(async (
    binding: RemotionChapterAudioBindingV2,
  ) => {
    const bridge = window.remotionChapterManifest;
    // 写时取 ref 最新快照:长任务旧闭包不得用陈旧 revision 打乐观锁
    const current = chapterManifestRef.current;
    if (!bridge || !props.projectId || !current) throw new Error("当前章节缺少可写的 V2 manifest");
    setChapterAudioBusy(true);
    try {
      const next: RemotionChapterManifestV2 = {
        ...current,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        sharedAudioBindings: [
          ...current.sharedAudioBindings.filter((item) => item.role !== binding.role),
          binding,
        ],
        manifestFingerprint: "",
      };
      next.manifestFingerprint = await createRemotionChapterManifestFingerprint(next);
      await bridge.write({
        projectId: props.projectId,
        chapterId,
        expectedRevision: current.revision,
        manifest: next,
      });
      setChapterManifest(next);
      setChapterAudioStatus("已保存");
      await window.remotionStudio?.closeSession(props.projectId);
    } finally {
      setChapterAudioBusy(false);
    }
  }, [chapterId, props.projectId, setChapterManifest]);
  // 把一个绝对路径的音频经 importAudio 绑定为章级共享音频(文件选择器与本地生成分镜共用)。
  // 返回是否绑定成功(批量抽卡点选绑定据此决定是否清结果;其余调用方忽略返回值)。
  const bindSharedAudioFromPath = useCallback(async (role: "bgm" | "ambience", sourcePath: string): Promise<boolean> => {
    const bridge = window.remotionChapterManifest;
    if (!bridge || !props.projectId || !chapterManifestRef.current) {
      setChapterAudioError("音频导入 bridge 不可用");
      return false;
    }
    setChapterAudioBusy(true);
    try {
      const imported = await bridge.importAudio({ projectId: props.projectId, chapterId, role, sourcePath });
      const durationUs = imported.durationUs;
      const binding: RemotionChapterAudioBindingV2 = {
        schemaVersion: 2,
        bindingId: `${role}:${imported.source.contentSha256.slice(0, 16)}`,
        bindingFingerprint: "",
        projectId: props.projectId,
        chapterId,
        source: imported.source,
        sourceFingerprint: imported.source.contentSha256,
        sourceDurationUs: durationUs,
        sourceStartUs: 0,
        chapterStartUs: 0,
        durationUs,
        volume: role === "bgm" ? 0.25 : 0.2,
        fadeInUs: 120_000,
        fadeOutUs: 400_000,
        envelope: [{ timeUs: 0, gain: 1 }, { timeUs: durationUs, gain: 1 }],
        renderScope: "chapter",
        role,
        ducking: {
          enabled: role === "bgm",
          reductionDb: -12,
          attackUs: 120_000,
          releaseUs: 400_000,
        },
      };
      binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
      await writeSharedAudio(binding);
      setChapterAudioError(null);
      return true;
    } catch (error) {
      setChapterAudioError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setChapterAudioBusy(false);
    }
  }, [chapterId, props.projectId, writeSharedAudio]);
  const importSharedAudio = useCallback(async (role: "bgm" | "ambience") => {
    const picker = window.studioAssets?.selectAudioFile;
    if (!picker) {
      setChapterAudioError("音频导入 bridge 不可用");
      return;
    }
    const sourcePath = await picker();
    if (!sourcePath) return;
    await bindSharedAudioFromPath(role, sourcePath);
  }, [bindSharedAudioFromPath]);
  // 本地生成 BGM(09-20 YuE2 接线):库取 API 工作流 → /comfy/execute(音频长任务)
  // → writeBinary 落项目 → 复用 importAudio(role:"bgm")+writeSharedAudio 绑定链。
  // 整段生成期间置 chapterAudioBusy=true:锁住同节点的导入/绑定/数值编辑等 manifest 写入口,
  // 防止分钟级窗口内并发改版(绑定本身也改走 ref 最新快照,双保险)。
  const [bgmPanelOpen, setBgmPanelOpen] = useState(false);
  const [bgmStyle, setBgmStyle] = useState(YUE2_BGM_STYLE_DEFAULT);
  const [bgmLyrics, setBgmLyrics] = useState(YUE2_BGM_LYRICS_IRON);
  const [bgmGenerating, setBgmGenerating] = useState(false);
  const [bgmProgress, setBgmProgress] = useState<string | null>(null);
  const generateLocalBgm = useCallback(async () => {
    if (!props.projectId) {
      setChapterAudioError("缺少项目身份,无法生成 BGM");
      return;
    }
    const style = bgmStyle.trim();
    if (!style) {
      setChapterAudioError("请先填写 BGM 风格描述");
      return;
    }
    setBgmGenerating(true);
    setChapterAudioBusy(true);
    setBgmProgress("准备执行…");
    try {
      const transport = getComfyWorkflowLibraryTransport();
      if (!transport) throw new Error("工作流库通道不可用(需在桌面应用内使用)");
      const workflowText = await transport.content(YUE2_BGM_API_WORKFLOW_ID);
      const parsed = unwrapComfyApiGraph(JSON.parse(workflowText));
      if (!parsed.ok) throw new Error(parsed.error);
      // UI 面 PrimitiveNode「一处改两节点同源」在 API 面的内联承接:两节点注入同值。
      const lyrics = bgmLyrics.trim() || YUE2_BGM_LYRICS_IRON;
      const result = await runComfyExecute(
        {
          graph: parsed.graph,
          inputs: {
            strings: { "22.style": style, "23.style": style, "22.lyrics": lyrics, "23.lyrics": lyrics },
            images: [],
          },
          timeoutS: 1200,
        },
        (progress) => setBgmProgress(progress.message),
        { pollTimeoutMs: 1_230_000 },
      );
      const audio = result.audios?.[0];
      if (!audio) throw new Error("工作流已完成但没有输出音频(缺 SaveAudio 类输出节点?)");
      setBgmProgress("写入项目并绑定本章 BGM…");
      const saved = await persistComfyAudio(audio.b64, audio.filename ?? "bgm.flac");
      await bindSharedAudioFromPath("bgm", saved.filePath);
      setBgmPanelOpen(false);
      setBgmProgress(null);
      toast.success("本地 BGM 已生成并绑定到本章");
    } catch (error) {
      setChapterAudioError(error instanceof Error ? error.message : String(error));
      setBgmProgress(null);
    } finally {
      setBgmGenerating(false);
      setChapterAudioBusy(false);
    }
  }, [bgmLyrics, bgmStyle, bindSharedAudioFromPath, props.projectId]);
  // 批量抽卡(N 连抽,09-20):复用单发的库取工作流/execute/persistComfyAudio/绑定链全机制,
  // 差异只在「逐首串行提交 + 派生种子(42+序号)+ 结果落列表待点选」。
  // 与单发互斥:全程共用 bgmGenerating + chapterAudioBusy(单发按钮/抽卡按钮/manifest 写入口同锁);
  // 生成期不关面板(用户要看着「第 i/N 首」进度),完成后停留列表页等点选。
  const [bgmBatchCount, setBgmBatchCount] = useState<BgmBatchCount>(4);
  const [bgmBatch, setBgmBatchState] = useState<BgmBatchState>(bgmBatchInitialState);
  const generateLocalBgmBatch = useCallback(async () => {
    if (!props.projectId) {
      setChapterAudioError("缺少项目身份,无法生成 BGM");
      return;
    }
    const style = bgmStyle.trim();
    if (!style) {
      setChapterAudioError("请先填写 BGM 风格描述");
      return;
    }
    setBgmGenerating(true);
    setChapterAudioBusy(true);
    setBgmProgress("准备执行…");
    try {
      const transport = getComfyWorkflowLibraryTransport();
      if (!transport) throw new Error("工作流库通道不可用(需在桌面应用内使用)");
      const finalState = await generateBgmBatch(
        { workflowId: YUE2_BGM_API_WORKFLOW_ID, style, lyrics: bgmLyrics, count: bgmBatchCount },
        {
          fetchWorkflowText: (workflowId) => transport.content(workflowId),
          execute: runComfyExecute,
          persistAudio: persistComfyAudio,
          onProgress: (progress) => setBgmProgress(progress.message),
          onStateChange: (next) => setBgmBatchState(next),
        },
      );
      if (finalState.phase === "selecting") {
        toast.success(`批量抽卡完成:已产出 ${finalState.candidates.length} 首,点选一首绑定本章 BGM`);
      }
      if (finalState.error) setChapterAudioError(finalState.error);
      setBgmProgress(null);
    } catch (error) {
      // 编排器不抛错;这里只兜底传输层之外的意外,busy 释放统一走 finally。
      setChapterAudioError(error instanceof Error ? error.message : String(error));
      setBgmProgress(null);
    } finally {
      setBgmGenerating(false);
      setChapterAudioBusy(false);
    }
  }, [bgmBatchCount, bgmLyrics, bgmStyle, props.projectId]);
  // 点选一首候选绑定为本章 BGM:绑定成功才清抽卡结果(失败保留列表供重选/重试)。
  const bindBgmBatchCandidate = useCallback(async (candidate: BgmBatchCandidate) => {
    const bound = await bindSharedAudioFromPath("bgm", candidate.filePath);
    if (bound) {
      setBgmBatchState(bgmBatchInitialState);
      toast.success(`抽卡曲目(种子 ${candidate.seed})已绑定到本章 BGM`);
    }
  }, [bindSharedAudioFromPath]);
  // 先出谱→改谱→按谱渲染(09-20):出谱走 ABC-only 工作流(texts[0] 内联回带),
  // 谱文本进可编辑 textarea + abcjs 谱面预览;按谱渲染复用 BGM api 工作流注入
  // 22.abc(链接位改字面量),渲染产物走 persistComfyAudio+绑定链(与单发同机制)。
  // 与单发/抽卡互斥:全程共用 bgmGenerating + chapterAudioBusy(同锁)。
  const [bgmScore, setBgmScoreState] = useState<BgmScoreState>(bgmScoreInitialState);
  const scorePreviewRef = useRef<HTMLDivElement | null>(null);
  const runBgmScore = useCallback(async () => {
    if (!props.projectId) {
      setChapterAudioError("缺少项目身份,无法生成 BGM");
      return;
    }
    const style = bgmStyle.trim();
    if (!style) {
      setChapterAudioError("请先填写 BGM 风格描述");
      return;
    }
    setBgmGenerating(true);
    setChapterAudioBusy(true);
    setBgmProgress("准备出谱…");
    setBgmScoreState((current) => bgmScoreReducer(current, { type: "score-start" }));
    try {
      const transport = getComfyWorkflowLibraryTransport();
      if (!transport) throw new Error("工作流库通道不可用(需在桌面应用内使用)");
      const abcText = await generateBgmScore(
        { workflowId: YUE2_ABC_API_WORKFLOW_ID, style, lyrics: bgmLyrics },
        {
          fetchWorkflowText: (workflowId) => transport.content(workflowId),
          execute: runComfyExecute,
          onProgress: (message) => setBgmProgress(message),
        },
      );
      setBgmScoreState((current) => bgmScoreReducer(current, { type: "score-done", abcText }));
      setBgmProgress(null);
      toast.success("乐谱已生成:可在下方编辑谱文本,再按谱渲染绑定");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBgmScoreState((current) => bgmScoreReducer(current, { type: "fail", error: message }));
      setChapterAudioError(message);
      setBgmProgress(null);
    } finally {
      setBgmGenerating(false);
      setChapterAudioBusy(false);
    }
  }, [bgmLyrics, bgmStyle, props.projectId]);
  const runBgmRenderByScore = useCallback(async () => {
    if (!props.projectId) {
      setChapterAudioError("缺少项目身份,无法生成 BGM");
      return;
    }
    const style = bgmStyle.trim();
    const abc = bgmScore.abcText;
    if (!style) {
      setChapterAudioError("请先填写 BGM 风格描述");
      return;
    }
    if (!isRenderableAbc(abc)) {
      setChapterAudioError("谱文本为空,先出谱或粘贴一段 ABC 谱再渲染");
      return;
    }
    setBgmGenerating(true);
    setChapterAudioBusy(true);
    setBgmProgress("准备按谱渲染…");
    setBgmScoreState((current) => bgmScoreReducer(current, { type: "render-start" }));
    try {
      const transport = getComfyWorkflowLibraryTransport();
      if (!transport) throw new Error("工作流库通道不可用(需在桌面应用内使用)");
      const lyrics = bgmLyrics.trim() || YUE2_BGM_LYRICS_IRON;
      const audio = await renderBgmByScore(
        { workflowId: YUE2_BGM_RENDER_API_WORKFLOW_ID, style, lyrics, abc: abc.trim() },
        {
          fetchWorkflowText: (workflowId) => transport.content(workflowId),
          execute: runComfyExecute,
          onProgress: (message) => setBgmProgress(message),
        },
      );
      setBgmProgress("写入项目并绑定本章 BGM…");
      const saved = await persistComfyAudio(audio.b64, audio.filename ?? "bgm.flac");
      await bindSharedAudioFromPath("bgm", saved.filePath);
      setBgmScoreState((current) => bgmScoreReducer(current, { type: "render-done" }));
      setBgmProgress(null);
      toast.success("按谱渲染完成,已绑定到本章 BGM");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBgmScoreState((current) => bgmScoreReducer(current, { type: "fail", error: message }));
      setChapterAudioError(message);
      setBgmProgress(null);
    } finally {
      setBgmGenerating(false);
      setChapterAudioBusy(false);
    }
  }, [bgmLyrics, bgmScore.abcText, bgmStyle, bindSharedAudioFromPath, props.projectId]);
  // abcjs 谱面预览(editing/error 态且谱文本非空时渲染;解析失败清容器不阻断编辑)。
  const scoreAbcText = bgmScore.abcText;
  useEffect(() => {
    const container = scorePreviewRef.current;
    if (!container) return;
    container.innerHTML = "";
    if (!isRenderableAbc(scoreAbcText)) return;
    try {
      abcjs.renderAbc(container, scoreAbcText, { responsive: "resize" });
    } catch {
      container.innerHTML = ""; // 改坏的谱:预览降级为空,textarea 仍可继续编辑
    }
  }, [scoreAbcText]);
  // 翻唱·记谱线(09-20):项目内音频资产选参考曲 → SheetSage2 记谱(mode=melody 保旋律)
  // → YuE2GenerateMusic(mode=melody)新风格重渲 → persistComfyAudio 落项目 → 绑定本章 BGM。
  // 参考曲上传走 /comfy/execute 的 images 注入口(LoadAudio;引擎 /upload/image 对音频字节
  // 安全);与单发/抽卡/出谱互斥:全程共用 chapterAudioBusy,另以 coverGenerating 自锁。
  const [bgmCover, setBgmCoverState] = useState<BgmCoverState>(bgmCoverInitialState);
  const [coverStyle, setCoverStyle] = useState(YUE2_BGM_STYLE_DEFAULT);
  const [coverLyrics, setCoverLyrics] = useState("");
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverProgress, setCoverProgress] = useState<string | null>(null);
  const loadBgmCoverAssets = useCallback(async () => {
    setBgmCoverState(bgmCoverReducer(bgmCoverInitialState, { type: "load-assets" }));
    const lister = window.studioAssets?.list;
    if (!lister) {
      setBgmCoverState((current) => bgmCoverReducer(current, { type: "fail", error: "资产库通道不可用(需在桌面应用内使用)" }));
      return;
    }
    try {
      const reply = await lister({ type: "audio", limit: 200 });
      const assets = toBgmCoverAssetOptions(reply.items ?? []);
      setBgmCoverState((current) => bgmCoverReducer(current, { type: "assets-loaded", assets }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBgmCoverState((current) => bgmCoverReducer(current, { type: "fail", error: message }));
    }
  }, []);
  // 面板展开且未列举过时自动拉一次参考曲清单(idle 态幂等守卫)。
  const coverPanelPhase = bgmCover.phase;
  useEffect(() => {
    if (bgmPanelOpen && coverPanelPhase === "idle") void loadBgmCoverAssets();
  }, [bgmPanelOpen, coverPanelPhase, loadBgmCoverAssets]);
  const generateLocalBgmCover = useCallback(async () => {
    if (!props.projectId) {
      setChapterAudioError("缺少项目身份,无法生成翻唱");
      return;
    }
    const asset = bgmCover.assets.find((item) => item.id === bgmCover.selectedAssetId);
    if (!asset) {
      setChapterAudioError("请先选择翻唱参考曲(项目内音频资产)");
      return;
    }
    const style = coverStyle.trim();
    if (!style) {
      setChapterAudioError("请先填写翻唱新风格描述");
      return;
    }
    setCoverGenerating(true);
    setChapterAudioBusy(true);
    setCoverProgress("准备执行…");
    try {
      const transport = getComfyWorkflowLibraryTransport();
      if (!transport) throw new Error("工作流库通道不可用(需在桌面应用内使用)");
      const finalState = await generateBgmCover(
        { workflowId: YUE2_COVER_API_WORKFLOW_ID, style, lyrics: coverLyrics, asset },
        {
          fetchWorkflowText: (workflowId) => transport.content(workflowId),
          // comfyImageUrlToB64 名为 Image 实为通用读址通道:project-file:// / asset-file:// → 纯 b64。
          readAudioB64: comfyImageUrlToB64,
          execute: runComfyExecute,
          persistAudio: persistComfyAudio,
          // 基线=组件现态的清单+选择:onStateChange 是整体回推,不带基线会把组件的
          // 参考曲清单与选中项清空(生成期下拉失实、done 后按钮被锁死须手动重选)。
          initialState: { ...bgmCoverInitialState, assets: bgmCover.assets, selectedAssetId: bgmCover.selectedAssetId },
          onProgress: (message) => setCoverProgress(message),
          onStateChange: (next) => setBgmCoverState(next),
        },
      );
      if (finalState.phase === "done" && finalState.result) {
        setCoverProgress("写入项目并绑定本章 BGM…");
        const bound = await bindSharedAudioFromPath("bgm", finalState.result.filePath);
        if (bound) toast.success("翻唱已生成并绑定到本章 BGM");
      }
      if (finalState.error) setChapterAudioError(finalState.error);
      setCoverProgress(null);
    } catch (error) {
      // 编排器不抛错;这里只兜底传输层之外的意外,busy 释放统一走 finally。
      setChapterAudioError(error instanceof Error ? error.message : String(error));
      setCoverProgress(null);
    } finally {
      setCoverGenerating(false);
      setChapterAudioBusy(false);
    }
  }, [bgmCover.assets, bgmCover.selectedAssetId, bindSharedAudioFromPath, coverLyrics, coverStyle, props.projectId]);
  const updateSharedAudio = useCallback(async (
    binding: RemotionChapterAudioBindingV2,
    patch: Partial<RemotionChapterAudioBindingV2>,
  ) => {
    try {
      const next = { ...binding, ...patch, bindingFingerprint: "" };
      next.bindingFingerprint = await createRemotionAudioBindingFingerprint(next);
      await writeSharedAudio(next);
      setChapterAudioError(null);
    } catch (error) {
      setChapterAudioError(error instanceof Error ? error.message : String(error));
    }
  }, [writeSharedAudio]);
  const handleShotQueueAction = useCallback(async (job: RemotionRenderJobV1, action: "retry" | "cancel") => {
    const queue = window.remotionQueue;
    if (!queue) return;
    setChapterAudioBusy(true);
    try {
      if (action === "retry") await queue.retry(job.jobId);
      else await queue.cancel(job.jobId);
      setChapterAudioError(null);
    } catch (error) {
      setChapterAudioError(error instanceof Error ? error.message : String(error));
    } finally {
      setChapterAudioBusy(false);
    }
  }, []);
  // 把一个绝对路径的 WAV 经 importAudio 绑定为分镜 sfx(本地生成与文件选择共用)。
  const bindShotSfxFromPath = useCallback(async (shotId: string, sourcePath: string) => {
    const bridge = window.remotionChapterManifest;
    const current = chapterManifestRef.current;
    const storyboard = props.storyboards.find((item) => item.id === shotId);
    if (!bridge || !props.projectId || !current || !storyboard) {
      setChapterAudioError("当前分镜缺少音频导入所需的 bridge、manifest 或身份");
      return;
    }
    setChapterAudioBusy(true);
    try {
      const imported = await bridge.importAudio({ projectId: props.projectId, chapterId, shotId, role: "sfx", sourcePath });
      const targetShot = current.shots.find((shot) => shot.shotId === shotId);
      if (!targetShot) throw new Error("当前章节 manifest 缺少目标分镜");
      const shotRevision = Math.max(1, targetShot.revision);
      const binding = {
        schemaVersion: 2 as const,
        bindingId: `sfx:${shotId}:${imported.source.contentSha256.slice(0, 16)}`,
        bindingFingerprint: "",
        renderScope: "shot" as const,
        projectId: props.projectId,
        chapterId,
        shotId,
        shotRevision,
        role: "sfx" as const,
        source: imported.source,
        sourceFingerprint: imported.source.contentSha256,
        sourceDurationUs: imported.durationUs,
        sourceStartUs: 0,
        shotStartUs: 0,
        durationUs: imported.durationUs,
        volume: 1,
        fadeInUs: 0,
        fadeOutUs: 0,
        envelope: [{ timeUs: 0, gain: 1 }, { timeUs: imported.durationUs, gain: 1 }],
      };
      binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
      const next: RemotionChapterManifestV2 = {
        ...current,
        revision: current.revision + 1,
        updatedAt: Date.now(),
        shots: current.shots.map((shot) => shot.shotId === shotId
          ? { ...shot, revision: shotRevision, audioBindings: [...shot.audioBindings.filter((item) => item.role !== "sfx"), binding] }
          : shot),
        manifestFingerprint: "",
      };
      next.manifestFingerprint = await createRemotionChapterManifestFingerprint(next);
      await bridge.write({ projectId: props.projectId, chapterId, expectedRevision: current.revision, manifest: next });
      setChapterManifest(next);
      useStudioStore.getState().updateStoryboard(shotId, {
        shotAudioBindings: [...(storyboard.shotAudioBindings ?? []).filter((item) => item.role !== "sfx"), binding],
      });
      await window.remotionStudio?.closeSession(props.projectId);
      setChapterAudioError(null);
    } catch (error) {
      setChapterAudioError(error instanceof Error ? error.message : String(error));
    } finally {
      setChapterAudioBusy(false);
    }
  }, [chapterId, props.projectId, props.storyboards, setChapterManifest]);

  const importShotSfx = useCallback(async (shotId: string) => {
    const picker = window.studioAssets?.selectAudioFile;
    if (!picker) {
      setChapterAudioError("当前分镜缺少音频导入所需的 bridge、manifest 或身份");
      return;
    }
    const sourcePath = await picker();
    if (!sourcePath) return;
    await bindShotSfxFromPath(shotId, sourcePath);
  }, [bindShotSfxFromPath]);
  const openSfxGenerate = useCallback((shotId: string, label: string) => {
    setSfxGenerateTarget({ shotId, label });
  }, []);
  const closeSfxGenerate = useCallback(() => {
    setSfxGenerateTarget(null);
  }, []);
  const handleSfxGenerated = useCallback(async (wavPath: string) => {
    const target = sfxGenerateTarget;
    if (!target) return;
    await bindShotSfxFromPath(target.shotId, wavPath);
  }, [bindShotSfxFromPath, sfxGenerateTarget]);
  const openFirstShotVideo = useCallback(async () => {
    const outputPath = firstShotAbsoluteOutputPath;
    if (!outputPath || !window.electronAPI?.openPath) {
      toast.error("首镜视频尚未生成或当前环境不支持打开本地文件");
      return;
    }
    const result = await window.electronAPI.openPath(outputPath);
    if (!result.success) toast.error(result.error || "无法打开首镜视频");
  }, [firstShotAbsoluteOutputPath]);
  const showFirstShotFolder = useCallback(async () => {
    const outputPath = firstShotAbsoluteOutputPath;
    if (!outputPath || !window.electronAPI?.showItemInFolder) {
      toast.error("首镜视频尚未生成或当前环境不支持显示文件夹");
      return;
    }
    const result = await window.electronAPI.showItemInFolder(outputPath);
    if (!result.success) toast.error(result.error || "无法显示首镜视频所在文件夹");
  }, [firstShotAbsoluteOutputPath]);
  return (
    <div className="space-y-3" data-studio-workbench>
      <ShotProductionOverview
        projectId={props.projectId ?? activeProjectId ?? undefined}
        storyboards={currentChapterStoryboards}
        jobs={queueScope.jobs}
        currentShotSlots={queueScope.currentShotSlots}
        queueLoading={queueScope.loading}
        onBackToCanvas={props.onBackToCanvas}
      />
      <VisualContinuityReviewPanel
        storyboards={props.storyboards}
        continuityAssetVersions={continuityAssetVersions}
        onReview={reviewStoryboardHuman}
        onReviewAsset={reviewContinuityAssetVersionHuman}
      />
      <section
        aria-label="video-use 章节执行"
        className="rounded-lg border border-info/30 bg-info/20/[0.06] px-4 py-3 text-xs"
        data-video-use-preview
        data-video-use-status={editing.applying ? "applying" : editing.videoUseState}
        data-video-use-mode={videoUseMode}
        data-video-use-derived-input-policy={videoUseDerivedInputPolicy}
        data-video-use-storyboard-source-policy={videoUseStoryboardSourcePolicy}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">第一阶段：video-use 章节预览</span>
          <span className="text-muted-foreground">
            {editing.videoUseBusy ? "执行中" : editing.applying ? "正在应用" : editing.videoUseState === "pending" ? `待确认 · revision ${editing.videoUseRevision ?? "-"}` : editing.videoUseState === "blocked" ? "已阻塞" : editing.videoUseState === "accepted" ? "已应用" : "未执行"}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">先消费已完成的 Remotion StoryboardShot 和本地 TTS，执行原文对齐、EDL、字幕时间、调色、preview 与自评；确认前不会生成正式章节视频。</p>
        <div className="mt-2 rounded border border-border bg-muted/20 px-2 py-1.5 text-[11px]" data-subtitle-authority-summary>
          <span className="font-medium text-foreground">字幕归属：{subtitleAuthoritySummary.label}</span>
          <span className="ml-2 text-muted-foreground">{subtitleAuthoritySummary.detail}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-muted-foreground">
            分镜来源
            <select
              className="h-8 rounded border border-border bg-background px-2 text-foreground"
              value={videoUseStoryboardSourcePolicy}
              data-video-use-storyboard-source-policy-select
              onChange={(event) => setVideoUseStoryboardSourcePolicy(event.currentTarget.value as VideoUseStoryboardSourcePolicy)}
            >
              <option value="current-ready">仅使用当前未过期分镜（默认）</option>
              <option value="reuse-existing">复用已有分镜（跳过付费重生成，仍需确认）</option>
            </select>
          </label>
          <label className="grid gap-1 text-muted-foreground">
            交接模式
            <select
              className="h-8 rounded border border-border bg-background px-2 text-foreground"
              value={videoUseMode}
              data-video-use-mode-select
              onChange={(event) => setVideoUseMode(event.currentTarget.value as "editable-edl" | "flat-shot-mp4")}
            >
              <option value="editable-edl">editable-edl（默认）</option>
              <option value="flat-shot-mp4">flat-shot-mp4（高级）</option>
            </select>
          </label>
          <label className="grid gap-1 text-muted-foreground">
            时长不匹配处理
            <select
              className="h-8 rounded border border-border bg-background px-2 text-foreground"
              value={videoUseDerivedInputPolicy}
              data-video-use-derived-input-policy-select
              onChange={(event) => setVideoUseDerivedInputPolicy(event.currentTarget.value as VideoUseDerivedInputPolicy)}
            >
              <option value="reject">不派生，直接阻塞（默认）</option>
              <option value="pad-video-to-audio">允许生成可追溯派生视频</option>
            </select>
          </label>
          <Button
            size="sm"
            data-video-use-run
            disabled={!chapterReady || editing.videoUseBusy || editing.applying || editing.videoUseState === "pending"}
            onClick={() => { void editing.runVideoUse(videoUseMode, videoUseDerivedInputPolicy, videoUseStoryboardSourcePolicy).catch(() => undefined); }}
          >
            {editing.videoUseBusy ? "正在运行…" : editing.videoUseState === "blocked" ? "重试 video-use" : "运行 video-use 预览"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-export-log-bundle
            disabled={!chapterReady || logBundleExporting}
            onClick={() => { void exportLogBundle(); }}
          >
            {logBundleExporting ? "正在导出…" : "导出制作日志包"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-scene-segment-export
            disabled={!chapterReady || !sceneSegmentExport.editingRevision || sceneSegmentExport.exporting}
            title={sceneSegmentExport.sceneError ?? (sceneSegmentExport.editingRevision ? "按场分段导出（Remotion 范围渲染）" : "需先完成 video-use 验收")}
            onClick={() => {
              if (sceneSegmentExport.sceneError) {
                toast.error(sceneSegmentExport.sceneError);
                return;
              }
              setSceneSegmentSelection(new Set(sceneSegmentExport.scenes.map((scene) => scene.sceneNo)));
              setSceneSegmentDialogOpen(true);
            }}
          >
            按场分段导出
          </Button>
          <SceneSegmentExportDialog
            open={sceneSegmentDialogOpen}
            onOpenChange={setSceneSegmentDialogOpen}
            scenes={sceneSegmentExport.scenes}
            selection={sceneSegmentSelection}
            onSelectionChange={setSceneSegmentSelection}
            exporting={sceneSegmentExport.exporting}
            onStart={(selected) => {
              setSceneSegmentDialogOpen(false);
              void sceneSegmentExport.exportScenes(selected);
            }}
          />
          <SceneSegmentExportProgress items={sceneSegmentExport.pendingJobStatuses} />
          {/* 指纹值仅作测试/探针数据钩子,不对用户展示(2026-08-26 裁定:界面不出现指纹类术语) */}
          <span
            className="sr-only"
            data-video-use-revision={editing.videoUseRevision ? String(editing.videoUseRevision) : ""}
            data-video-use-input-sha={editing.videoUseInputSha ?? ""}
          />
        </div>
        <output
          className="sr-only"
          data-hyperframes-status={editing.hyperFramesState}
          data-hyperframes-accepted={String(editing.hyperFramesState === "accepted")}
          data-hyperframes-noop={String(editing.hyperFramesState === "noop")}
          data-hyperframes-blocked={String(editing.hyperFramesState === "blocked")}
        >
          HyperFrames {editing.hyperFramesState}
        </output>
        {!chapterReady ? <p className="mt-2 text-muted-foreground">需先完成本章{videoUseStoryboardSourcePolicy === "reuse-existing" ? "可复用" : "未过期的"} Remotion StoryboardShot current slot。</p> : null}
        {editing.error ? <p className="mt-2 text-destructive" role="alert">{editing.error}</p> : null}
      </section>
      <VideoWorkflowReviewPanel
        projectId={props.projectId ?? activeProjectId ?? undefined}
        chapterId={chapterId}
        revision={editing.videoUseRevision}
        onAccepted={async () => { await editing.applyVideoWorkflow(); }}
      />
      <section aria-label="章节共享音频配置" className="rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <div className="flex items-center justify-between"><span className="font-semibold">章节共享音频（BGM / 环境）</span><span className="text-muted-foreground">{chapterAudioStatus}{chapterManifest ? ` · 第 ${chapterManifest.revision} 版` : ""}</span></div>
        <p className="mt-1 text-muted-foreground">音频配置：{chapterManifest?.sharedAudioBindings.length ?? 0} 条全章共享音频。旁白配音和音效已压进每条单镜 MP4；背景音乐、环境声只在全章成片里统一混入。编辑仍在原生 Remotion Studio。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["bgm", "ambience"] as const).map((role) => (
            <Button key={role} size="sm" variant="outline" disabled={!chapterManifest || chapterAudioBusy} onClick={() => { void importSharedAudio(role); }}>
              导入{role === "bgm" ? "BGM" : "环境声"}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            data-bgm-local-generate
            disabled={!chapterManifest || chapterAudioBusy || bgmGenerating}
            title="走本地 ComfyUI 引擎 YuE2 生成整曲纯音乐并自动绑定为本章 BGM"
            onClick={() => setBgmPanelOpen((open) => !open)}
          >
            {bgmGenerating ? "BGM 生成中…" : "本地生成 BGM"}
          </Button>
        </div>
        {bgmPanelOpen ? (
          <div className="mt-3 grid gap-2 rounded-md border border-border/70 bg-background/30 p-3" data-bgm-generate-panel>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              风格 style(英文逗号描述,如默认的古筝竹笛仙侠氛围)
              <textarea
                className="min-h-16 rounded border border-border bg-background px-2 py-1 text-foreground"
                data-bgm-style-input
                disabled={bgmGenerating}
                value={bgmStyle}
                onChange={(event) => setBgmStyle(event.currentTarget.value)}
              />
            </label>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              歌词槽(纯音乐铁律:五标签逐行;加词、加时间分段或改单行 [instrumental] 会退回出人声)
              <textarea
                className="min-h-16 rounded border border-border bg-background px-2 py-1 font-mono text-foreground"
                data-bgm-lyrics-input
                disabled={bgmGenerating}
                value={bgmLyrics}
                onChange={(event) => setBgmLyrics(event.currentTarget.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" data-bgm-generate-run disabled={bgmGenerating || chapterAudioBusy} onClick={() => { void generateLocalBgm(); }}>
                {bgmGenerating ? "生成中(整曲分钟级,请勿重启应用)…" : "开始生成并绑定"}
              </Button>
              <Button size="sm" variant="ghost" disabled={bgmGenerating} onClick={() => setBgmPanelOpen(false)}>收起</Button>
              {bgmProgress && bgmBatch.phase !== "generating" && bgmScore.phase !== "scoring" && bgmScore.phase !== "rendering" ? <span className="text-muted-foreground" data-bgm-generate-progress>{bgmProgress}</span> : null}
            </div>
            {/* 先出谱行(09-20):出谱→改谱(abcjs 预览)→按谱渲染绑定;与单发/抽卡共用 bgmGenerating/chapterAudioBusy,生成期互斥。 */}
            <div className="flex flex-wrap items-center gap-2" data-bgm-score-row>
              <Button
                size="sm"
                variant="outline"
                data-bgm-score-run
                disabled={isScoreBusy(bgmScore, bgmGenerating || chapterAudioBusy)}
                title="先只跑 YuE2GenerateABC 出 ABC 乐谱(不出音频);谱文本可编辑,改完再按谱渲染"
                onClick={() => { void runBgmScore(); }}
              >
                {bgmScore.phase === "scoring" ? "出谱中(LLM 秒~分钟级)…" : "先出谱(生成乐谱)"}
              </Button>
              {bgmScore.abcText !== null ? (
                <>
                  <Button
                    size="sm"
                    data-bgm-score-render
                    disabled={isScoreBusy(bgmScore, bgmGenerating || chapterAudioBusy) || !isRenderableAbc(bgmScore.abcText)}
                    title="复用 BGM 工作流,把当前谱文本直喂 YuE2GenerateMusic 渲染整曲并绑定本章"
                    onClick={() => { void runBgmRenderByScore(); }}
                  >
                    {bgmScore.phase === "rendering" ? "按谱渲染中(整曲分钟级,请勿重启应用)…" : "按谱渲染并绑定"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isScoreBusy(bgmScore, bgmGenerating || chapterAudioBusy)}
                    onClick={() => setBgmScoreState(bgmScoreInitialState)}
                  >
                    清空乐谱
                  </Button>
                </>
              ) : null}
              {bgmScore.phase === "scoring" || bgmScore.phase === "rendering" ? (
                <span className="text-muted-foreground" data-bgm-score-progress>{bgmProgress ?? "引擎执行中…"}</span>
              ) : null}
            </div>
            {bgmScore.abcText !== null ? (
              <div className="grid gap-2" data-bgm-score-editor>
                <label className="grid gap-1 text-[11px] text-muted-foreground">
                  ABC 谱文本(可编辑;出谱产物原样带回,改谱后按谱渲染用你改后的版本)
                  <textarea
                    className="min-h-40 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground"
                    data-bgm-score-abc-input
                    disabled={isScoreBusy(bgmScore, bgmGenerating || chapterAudioBusy)}
                    spellCheck={false}
                    value={bgmScore.abcText}
                    onChange={(event) => setBgmScoreState((current) => bgmScoreReducer(current, { type: "abc-edit", abcText: event.currentTarget.value }))}
                  />
                </label>
                <div className="rounded border border-border/70 bg-background/40 p-2" data-bgm-score-preview>
                  <div className="mb-1 text-[10px] text-muted-foreground">谱面预览(abcjs;解析失败时留空,不影响文本编辑)</div>
                  <div ref={scorePreviewRef} className="overflow-x-auto text-foreground" />
                </div>
                {bgmScore.error ? <p className="text-destructive" data-bgm-score-error>{bgmScore.error}</p> : null}
              </div>
            ) : null}
            {/* 批量抽卡行:N 连抽(2/4/8);与单发共用 bgmGenerating/chapterAudioBusy,生成期互斥。 */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                抽卡张数 N(种子=42+序号,同题同派生可复现)
                <select
                  className="h-8 rounded border border-border bg-background px-2 text-foreground"
                  data-bgm-batch-count-select
                  disabled={bgmGenerating}
                  value={bgmBatchCount}
                  onChange={(event) => {
                    const next = Number(event.currentTarget.value);
                    if ((YUE2_BGM_BATCH_COUNT_OPTIONS as readonly number[]).includes(next)) {
                      setBgmBatchCount(next as BgmBatchCount);
                    }
                  }}
                >
                  {YUE2_BGM_BATCH_COUNT_OPTIONS.map((count) => (
                    <option key={count} value={count}>{count} 连抽</option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                data-bgm-batch-run
                disabled={bgmGenerating || chapterAudioBusy}
                title="逐首串行生成 N 个候选(派生种子 42+序号),完成后点选一首绑定本章 BGM"
                onClick={() => { void generateLocalBgmBatch(); }}
              >
                {bgmBatch.phase === "generating" ? `${formatBgmBatchProgress(bgmBatch)} · 抽卡中…` : `批量抽卡 ${bgmBatchCount} 连抽`}
              </Button>
              {bgmBatch.phase === "generating" ? (
                <span className="text-muted-foreground" data-bgm-batch-progress>
                  {formatBgmBatchProgress(bgmBatch)}{bgmProgress ? ` · ${bgmProgress}` : ""}
                </span>
              ) : null}
            </div>
            {bgmBatch.phase === "selecting" ? (
              <div className="grid gap-1.5" data-bgm-batch-results>
                <span className="text-[11px] text-muted-foreground" data-bgm-batch-summary>{formatBgmBatchProgress(bgmBatch)}</span>
                {bgmBatch.candidates.map((candidate, index) => (
                  <div
                    key={`${candidate.seed}-${candidate.filePath}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 bg-background/40 px-2 py-1.5"
                    data-bgm-batch-candidate
                    data-bgm-batch-candidate-seed={String(candidate.seed)}
                  >
                    <span className="min-w-0 truncate font-mono text-[11px]" data-bgm-batch-candidate-name>
                      #{index + 1} · {candidate.filename} · {formatBgmBatchDuration(candidate.durationSeconds)} · 种子 {candidate.seed}
                    </span>
                    <Button size="sm" variant="outline" data-bgm-batch-pick disabled={chapterAudioBusy} onClick={() => { void bindBgmBatchCandidate(candidate); }}>
                      绑定为本章 BGM
                    </Button>
                  </div>
                ))}
                <div>
                  <Button size="sm" variant="ghost" disabled={chapterAudioBusy} onClick={() => setBgmBatchState(bgmBatchInitialState)}>清空抽卡结果</Button>
                </div>
              </div>
            ) : null}
            {/* 翻唱·记谱线(09-20):项目内音频资产选参考曲 → SheetSage2 记谱保旋律(melody)→ 新风格重渲绑定;
                与单发/抽卡/出谱共用 chapterAudioBusy 互斥,coverGenerating 自锁。 */}
            <div className="grid gap-2 rounded-md border border-border/70 bg-background/40 p-3" data-bgm-cover-panel>
              <span className="text-[11px] font-medium">翻唱(参考曲记谱保旋律 → 新风格重渲)</span>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-[11px] text-muted-foreground">
                  参考曲(项目内音频资产)
                  <select
                    className="h-8 w-64 rounded border border-border bg-background px-2 text-foreground"
                    data-bgm-cover-asset-select
                    disabled={coverGenerating || chapterAudioBusy || bgmGenerating || bgmCover.assets.length === 0}
                    value={bgmCover.selectedAssetId ?? ""}
                    onChange={(event) => setBgmCoverState((current) => bgmCoverReducer(current, { type: "select-asset", assetId: event.currentTarget.value || null }))}
                  >
                    <option value="">{bgmCover.assets.length === 0 ? (bgmCover.phase === "loading-assets" ? "列举中…" : "暂无可选音频资产") : "选择参考曲…"}</option>
                    {bgmCover.assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>{asset.name}</option>
                    ))}
                  </select>
                </label>
                <Button size="sm" variant="ghost" data-bgm-cover-refresh disabled={coverGenerating || chapterAudioBusy || bgmGenerating} onClick={() => { void loadBgmCoverAssets(); }}>
                  刷新资产
                </Button>
                {formatBgmCoverHint(bgmCover) ? <span className="text-[11px] text-muted-foreground" data-bgm-cover-hint>{formatBgmCoverHint(bgmCover)}</span> : null}
              </div>
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                新风格 style(翻唱的新编曲;参考曲只保旋律,风格照此重渲)
                <textarea
                  className="min-h-16 rounded border border-border bg-background px-2 py-1 text-foreground"
                  data-bgm-cover-style-input
                  disabled={coverGenerating}
                  value={coverStyle}
                  onChange={(event) => setCoverStyle(event.currentTarget.value)}
                />
              </label>
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                歌词(可选;要唱的新词。留空=纯音乐翻唱,回退五标签铁律)
                <textarea
                  className="min-h-16 rounded border border-border bg-background px-2 py-1 font-mono text-foreground"
                  data-bgm-cover-lyrics-input
                  disabled={coverGenerating}
                  value={coverLyrics}
                  onChange={(event) => setCoverLyrics(event.currentTarget.value)}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  data-bgm-cover-run
                  disabled={coverGenerating || chapterAudioBusy || bgmGenerating || !bgmCover.selectedAssetId}
                  title="SheetSage2 把参考曲转 ABC 谱(melody 档保旋律)→ YuE2 按新风格重渲整曲并绑定本章 BGM"
                  onClick={() => { void generateLocalBgmCover(); }}
                >
                  {coverGenerating ? "翻唱生成中(记谱+重渲分钟级,请勿重启应用)…" : "生成翻唱并绑定"}
                </Button>
                {coverProgress ? <span className="text-muted-foreground" data-bgm-cover-progress>{coverProgress}</span> : null}
                {bgmCover.phase === "done" && bgmCover.result ? (
                  <span className="text-[11px] text-muted-foreground" data-bgm-cover-result>
                    已产出 {bgmCover.result.filename}{bgmCover.result.durationSeconds !== null ? ` · ${formatBgmBatchDuration(bgmCover.result.durationSeconds)}` : ""}
                  </span>
                ) : null}
              </div>
              {bgmCover.error ? <p className="text-destructive" data-bgm-cover-error>{bgmCover.error}</p> : null}
            </div>
            <p className="text-[10px] text-muted-foreground">走本地 ComfyUI 引擎 YuE2(LoRA 纯音乐构图·单发种子 42 固定·抽卡种子=42+序号·flac);引擎未运行会自动拉起,整曲生成约数分钟。单发完成后自动写入本章 BGM 轨;抽卡完成后在上方列表点选一首绑定,未选中的曲目文件仍留在项目内可后续手动导入。先出谱=只跑记谱(LLM 出 ABC 谱,秒~分钟级),谱文本可编辑并实时预览谱面;按谱渲染=把当前谱文本直喂 YuE2GenerateMusic 出整曲并绑定,与单发/抽卡同锁互斥。翻唱=SheetSage2 记谱(参考曲上传引擎 input/)保旋律,YuE2 按新风格重渲绑定,与单发/抽卡/出谱同锁互斥。</p>
          </div>
        ) : null}
        {chapterManifest?.sharedAudioBindings.map((binding) => (
          <div key={binding.bindingId} className="mt-3 grid gap-2 rounded-md border border-border/70 bg-background/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{binding.role === "bgm" ? "BGM" : "环境声"} · {binding.bindingId}</span>
              <span className="text-[10px] text-muted-foreground">仅 chapter-scoped · 未烘入单镜</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["源起点(s)", binding.sourceStartUs / 1_000_000, (value: number) => ({ sourceStartUs: Math.round(value * 1_000_000) }), 0],
                ["章节起点(s)", binding.chapterStartUs / 1_000_000, (value: number) => ({ chapterStartUs: Math.round(value * 1_000_000) }), 0],
                ["时长(s)", binding.durationUs / 1_000_000, (value: number) => ({ durationUs: Math.round(value * 1_000_000) }), 0.001],
                ["音量", binding.volume, (value: number) => ({ volume: value }), 0.01],
              ].map(([label, value, toPatch, step]) => (
                <label key={String(label)} className="grid gap-1 text-[10px] text-muted-foreground">
                  {String(label)}
                  <input className="h-7 rounded border border-border bg-background px-2 text-foreground" type="number" min="0" step={String(step)} disabled={chapterAudioBusy} defaultValue={Number(value).toFixed(3)} onBlur={(event) => { const parsed = Number(event.currentTarget.value); if (Number.isFinite(parsed)) void updateSharedAudio(binding, (toPatch as (value: number) => Partial<RemotionChapterAudioBindingV2>)(parsed)); }} />
                </label>
              ))}
              {[
                ["淡入(s)", binding.fadeInUs / 1_000_000, (value: number) => ({ fadeInUs: Math.round(value * 1_000_000) })],
                ["淡出(s)", binding.fadeOutUs / 1_000_000, (value: number) => ({ fadeOutUs: Math.round(value * 1_000_000) })],
                ["包络增益", binding.envelope[0]?.gain ?? 1, (value: number) => ({ envelope: [{ timeUs: 0, gain: value }, { timeUs: binding.durationUs, gain: value }] })],
              ].map(([label, value, toPatch]) => (
                <label key={String(label)} className="grid gap-1 text-[10px] text-muted-foreground">
                  {String(label)}
                  <input className="h-7 rounded border border-border bg-background px-2 text-foreground" type="number" min="0" step="0.01" disabled={chapterAudioBusy} defaultValue={Number(value).toFixed(3)} onBlur={(event) => { const parsed = Number(event.currentTarget.value); if (Number.isFinite(parsed)) void updateSharedAudio(binding, (toPatch as (value: number) => Partial<RemotionChapterAudioBindingV2>)(parsed)); }} />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input type="checkbox" checked={binding.ducking.enabled} disabled={chapterAudioBusy} onChange={(event) => { void updateSharedAudio(binding, { ducking: { ...binding.ducking, enabled: event.currentTarget.checked } }); }} />
              对白 ducking
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1 text-[10px] text-muted-foreground">
                对白 ducking reduction(dB)
                <input
                  aria-label="对白 ducking reduction(dB)"
                  className="h-7 rounded border border-border bg-background px-2 text-foreground"
                  type="number"
                  min="-60"
                  max="0"
                  step="0.5"
                  disabled={chapterAudioBusy}
                  defaultValue={binding.ducking.reductionDb}
                  onBlur={(event) => {
                    const parsed = Number(event.currentTarget.value);
                    if (Number.isFinite(parsed)) void updateSharedAudio(binding, { ducking: { ...binding.ducking, reductionDb: parsed } });
                  }}
                />
              </label>
              <label className="grid gap-1 text-[10px] text-muted-foreground">
                对白 ducking attack(ms)
                <input
                  aria-label="对白 ducking attack(ms)"
                  className="h-7 rounded border border-border bg-background px-2 text-foreground"
                  type="number"
                  min="0"
                  step="1"
                  disabled={chapterAudioBusy}
                  defaultValue={binding.ducking.attackUs / 1000}
                  onBlur={(event) => {
                    const parsed = Number(event.currentTarget.value);
                    if (Number.isFinite(parsed)) void updateSharedAudio(binding, { ducking: { ...binding.ducking, attackUs: Math.round(parsed * 1000) } });
                  }}
                />
              </label>
              <label className="grid gap-1 text-[10px] text-muted-foreground">
                对白 ducking release(ms)
                <input
                  aria-label="对白 ducking release(ms)"
                  className="h-7 rounded border border-border bg-background px-2 text-foreground"
                  type="number"
                  min="0"
                  step="1"
                  disabled={chapterAudioBusy}
                  defaultValue={binding.ducking.releaseUs / 1000}
                  onBlur={(event) => {
                    const parsed = Number(event.currentTarget.value);
                    if (Number.isFinite(parsed)) void updateSharedAudio(binding, { ducking: { ...binding.ducking, releaseUs: Math.round(parsed * 1000) } });
                  }}
                />
              </label>
            </div>
          </div>
        ))}
        {chapterAudioError ? <p className="mt-2 text-destructive">{chapterAudioError}</p> : null}
      </section>
      <section aria-label="首镜横屏预览" data-first-shot-preview className="rounded-lg border border-info/20 bg-info/20/[0.06] px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold">首镜横屏预览</span>
            <span className="ml-2 text-muted-foreground">StoryboardShot · 1920×1080 · 30fps</span>
          </div>
          <span className="text-muted-foreground" data-first-shot-preview-status>
            {firstShotJob ? formatFirstShotStatus(firstShotJob.status) : "尚未提交"}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">
          直接使用当前章节 S01 的真实画面与配音、音效，通过 Remotion 队列生成项目内单镜 MP4，不需要终端命令。
        </p>
        {firstStoryboard ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 bg-background/30 p-2">
            <div className="min-w-0">
              <div className="truncate font-medium">S01 · {firstStoryboard.videoDesc || firstStoryboard.prompt || firstStoryboard.id}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {firstStoryboard.id} · {firstStoryboard.durationTarget ?? firstStoryboard.duration}s · voice {firstStoryboard.shotAudioBindings?.some((binding) => binding.role === "voice") ? "已绑定" : "缺失"}
              </div>
            </div>
            <Button
              size="sm"
              data-first-shot-preview-action
              onClick={() => { void firstShotPreview.generateFirstShotPreview(); }}
              disabled={firstShotPreview.busy || firstShotJob?.status === "queued" || firstShotJob?.status === "running"}
            >
              {firstShotPreview.busy ? "正在提交…" : "生成首镜横屏预览"}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-destructive">当前章节没有 index=1 的首镜分镜，已停止提交。</p>
        )}
        {firstShotPreview.error ? <p className="mt-2 text-destructive">{firstShotPreview.error}</p> : null}
        {firstShotJob?.error ? <p className="mt-2 text-destructive">{firstShotJob.error.message}</p> : null}
        {firstShotSlot?.outputPath ? (
          <div className="mt-3 rounded border border-border/70 bg-background/40 p-2">
            <div className="text-[10px] text-muted-foreground">当前槽位输出路径</div>
            <code className="mt-1 block break-all text-[10px] text-foreground" data-first-shot-preview-output>
              {firstShotAbsoluteOutputPath ?? "正在定位输出文件…"}
            </code>
            {firstShotOutputPathError ? <p className="mt-1 text-destructive">{firstShotOutputPathError}</p> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" disabled={!firstShotAbsoluteOutputPath} onClick={() => { void openFirstShotVideo(); }}>打开视频</Button>
              <Button size="sm" variant="outline" disabled={!firstShotAbsoluteOutputPath} onClick={() => { void showFirstShotFolder(); }}>在文件夹中显示</Button>
            </div>
          </div>
        ) : null}
      </section>
      <section aria-label="分镜音频操作" className="rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">分镜音频状态与操作</span>
          <span className="text-muted-foreground">{queueScope.loading ? "读取队列…" : `${props.storyboards.length} 个分镜`}</span>
        </div>
        <p className="mt-1 text-muted-foreground">旁白配音与音效只进入对应的单镜 MP4；全章共享的背景音乐、环境声不会重复压进单镜。</p>
        <div className="mt-3 space-y-2">
          {currentChapterStoryboards.map((storyboard) => {
            const job = selectCurrentShotJobForStoryboard(storyboard, queueScope.jobs, queueScope.currentShotSlots);
            const currentSlot = remotionShotSlots.find((slot) => slot.target.kind === "shot"
              && slot.target.chapterId === chapterId
              && slot.target.shotId === storyboard.id
              && slot.target.shotRevision === Math.max(1, storyboard.outputVersion ?? 1));
            const voice = storyboard.shotAudioBindings?.find((binding) => binding.role === "voice");
            const sfx = storyboard.shotAudioBindings?.find((binding) => binding.role === "sfx");
            const cinematicLabel = getCinematicPresetShortLabel(
              getStoryboardCinematic(storyboard)?.preset,
            );
            return (
              <div
                key={storyboard.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 bg-background/30 p-2"
                data-storyboard-shot-current-slot
                data-storyboard-shot-id={storyboard.id}
                data-storyboard-shot-revision={String(Math.max(1, storyboard.outputVersion ?? 1))}
                data-storyboard-shot-slot-status={currentSlot?.job.status ?? "missing"}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate font-medium">S{String(storyboard.index).padStart(2, "0")} · {storyboard.videoDesc || storyboard.prompt || storyboard.id}</div>
                    {cinematicLabel ? (
                      <span
                        className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                        data-cinematic-badge
                        data-cinematic-preset={cinematicLabel}
                      >
                        cinematic · {cinematicLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    旁白配音 {voice?.ttsInputFingerprint ? "已绑定" : "缺失"} · 音效 {sfx ? "已绑定" : "未添加"} · 第 {storyboard.outputVersion ?? 1} 版
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" disabled={!chapterManifest || chapterAudioBusy} onClick={() => { void importShotSfx(storyboard.id); }}>导入音效</Button>
                  <Button size="sm" variant="outline" disabled={!chapterManifest || chapterAudioBusy} onClick={() => openSfxGenerate(storyboard.id, `#${storyboard.index + 1}`)}>生成音效</Button>
                  {job && (job.status === "failed" || job.status === "canceled" || job.status === "stale") ? (
                    <Button size="sm" variant="outline" disabled={chapterAudioBusy} onClick={() => { void handleShotQueueAction(job, "retry"); }}>重试分镜</Button>
                  ) : null}
                  {job && (job.status === "queued" || job.status === "running") ? (
                    <Button size="sm" variant="outline" disabled={chapterAudioBusy} onClick={() => { void handleShotQueueAction(job, "cancel"); }}>取消分镜</Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {remotionHostReady && editing.currentProject ? (
        <div
          data-remotion-handoff
          data-remotion-host-readiness="ready"
          data-remotion-current-slot-count={String(currentChapterSlotCount)}
          data-remotion-current-slot-ready={String(chapterReady)}
        >
          <NativeRemotionStudioHost
            projectId={editing.currentProject.projectId}
            chapterId={editing.currentProject.episodeId}
            revision={editing.currentProject.revision}
          />
        </div>
      ) : (
        <section
          aria-label="Remotion 章节工作台准备"
          className="rounded-lg border border-border bg-card p-4"
          data-remotion-handoff
          data-remotion-host-readiness="blocked"
          data-remotion-current-slot-count={String(currentChapterSlotCount)}
          data-remotion-current-slot-ready={String(chapterReady)}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Film className="h-4 w-4" />
            原生 Remotion Studio 章节工作台
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            当前章节仍在 video-use / HyperFrames 门禁之前。完成 video-use 预览、用户确认与 overlay/no-op 应用后，系统才会加载原生 Remotion Studio。
          </p>
          <div className="mt-3 rounded-md border border-info/20 bg-info/20/[0.06] px-3 py-2 text-xs text-info">
            分镜物料 → <strong>StoryboardShot</strong> 单镜 MP4 → video-use → 用户确认 → HyperFrames overlay/no-op → 原生 Remotion Studio → <strong>ChapterVideo</strong>
          </div>
          {editing.videoUseState === "accepted" && editing.hyperFramesState === "blocked" ? (
            <Button className="mt-4" disabled={editing.applying} onClick={() => { void editing.applyVideoWorkflow().catch(() => undefined); }}>
              {editing.applying ? "正在重试应用…" : "重试 HyperFrames / 工程应用"}
            </Button>
          ) : null}
          {!chapterReady ? (
            <p className="mt-3 text-xs text-muted-foreground">
              已验证单镜槽位：{currentChapterSlotCount}/{props.storyboards.filter((storyboard) => storyboard.episodeId === (props.episodeId ?? "episode-1")).length}；全部成功后才能进入章节工作台。
            </p>
          ) : null}
        </section>
      )}
      <SfxGenerateDialog
        open={sfxGenerateTarget !== null}
        shotLabel={sfxGenerateTarget?.label ?? ""}
        onOpenChange={(open) => { if (!open) closeSfxGenerate(); }}
        onGenerated={handleSfxGenerated}
      />
    </div>
  );
}



export { buildWorkbenchAssetMediaMap, countCurrentShotSlots, formatFirstShotStatus, getOptionalStringField, isCurrentChapterReady, resolveWorkbenchRemotionShotSlots, selectCurrentShotJobForStoryboard, summarizeSubtitleAuthority } from "./workbench-status";
