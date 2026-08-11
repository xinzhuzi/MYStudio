import { Button } from "@/components/ui/button";
import { buildProjectFileUrl } from "@/lib/artifacts/ref-preview-loader";
import { isStoryboardReadyForVideoWorkflow } from "@/lib/studio/video-workflow/chapter-run-request";
import type { ToonflowWorkbenchAssetMedia } from "@/lib/studio/workbench-view-model";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ScriptPlan } from "@/types/studio";
import { createRemotionAudioBindingFingerprint, createRemotionChapterManifestFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import type {
  RemotionChapterAudioBindingV2,
  RemotionChapterManifestV2,
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,
} from "@/types/remotion-workspace";
import { Film } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NativeRemotionStudioHost } from "./NativeRemotionStudioHost";
import { VisualContinuityReviewPanel } from "./VisualContinuityReviewPanel";
import { useEditingWorkbenchActions } from "./useEditingWorkbenchActions";
import { selectFirstStoryboard, useFirstShotPreviewActions } from "./use-first-shot-preview-actions";
import { useRemotionQueueScope } from "./useRemotionQueueScope";
import type { RemotionQueueScopeState } from "./useRemotionQueueScope";
import { toast } from "sonner";
import { VideoWorkflowReviewPanel } from "./VideoWorkflowReviewPanel";
import type { VideoUseDerivedInputPolicy, VideoUseStoryboardSourcePolicy } from "@rendering/contracts/video-workflow";

export function WorkbenchTab(props: {
  projectId?: string;
  projectName?: string;
  episodeId?: string;
  directorPlan?: ScriptPlan;
  aspectRatio?: string;
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"];
  remotionShotSlots?: RemotionCurrentSlotV1[];
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
  const [chapterManifest, setChapterManifest] = useState<RemotionChapterManifestV2 | null>(null);
  const [chapterAudioStatus, setChapterAudioStatus] = useState("未读取");
  const [chapterAudioBusy, setChapterAudioBusy] = useState(false);
  const [chapterAudioError, setChapterAudioError] = useState<string | null>(null);
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
  }, [chapterId, props.projectId]);
  useEffect(() => {
    void refreshChapterManifest();
  }, [refreshChapterManifest]);
  const writeSharedAudio = useCallback(async (
    binding: RemotionChapterAudioBindingV2,
  ) => {
    const bridge = window.remotionChapterManifest;
    const current = chapterManifest;
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
  }, [chapterId, chapterManifest, props.projectId]);
  const importSharedAudio = useCallback(async (role: "bgm" | "ambience") => {
    const bridge = window.remotionChapterManifest;
    const picker = window.studioAssets?.selectAudioFile;
    if (!bridge || !picker || !props.projectId) {
      setChapterAudioError("音频导入 bridge 不可用");
      return;
    }
    const sourcePath = await picker();
    if (!sourcePath || !chapterManifest) return;
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
    } catch (error) {
      setChapterAudioError(error instanceof Error ? error.message : String(error));
    } finally {
      setChapterAudioBusy(false);
    }
  }, [chapterId, chapterManifest, props.projectId, writeSharedAudio]);
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
  const importShotSfx = useCallback(async (shotId: string) => {
    const bridge = window.remotionChapterManifest;
    const picker = window.studioAssets?.selectAudioFile;
    const current = chapterManifest;
    const storyboard = props.storyboards.find((item) => item.id === shotId);
    if (!bridge || !picker || !props.projectId || !current || !storyboard) {
      setChapterAudioError("当前分镜缺少音频导入所需的 bridge、manifest 或身份");
      return;
    }
    const sourcePath = await picker();
    if (!sourcePath) return;
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
  }, [chapterId, chapterManifest, props.projectId, props.storyboards]);
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
      <VisualContinuityReviewPanel
        storyboards={props.storyboards}
        continuityAssetVersions={continuityAssetVersions}
        onReview={reviewStoryboardHuman}
        onReviewAsset={reviewContinuityAssetVersionHuman}
      />
      <section
        aria-label="video-use 章节执行"
        className="rounded-lg border border-cyan-300/30 bg-cyan-300/[0.06] px-4 py-3 text-xs"
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
          <span
            className="pb-2 text-muted-foreground"
            data-video-use-revision={editing.videoUseRevision ? String(editing.videoUseRevision) : ""}
            data-video-use-input-sha={editing.videoUseInputSha ?? ""}
          >
            输入指纹 {editing.videoUseInputSha ? `${editing.videoUseInputSha.slice(0, 12)}…` : "-"}
          </span>
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
        <div className="flex items-center justify-between"><span className="font-semibold">章节共享音频（BGM / 环境）</span><span className="text-muted-foreground">{chapterAudioStatus}{chapterManifest ? ` · 修订 ${chapterManifest.revision}` : ""}</span></div>
        <p className="mt-1 text-muted-foreground">非时间线配置：{chapterManifest?.sharedAudioBindings.length ?? 0} 条共享音频绑定。voice/SFX 已烘入 StoryboardShot MP4；BGM/环境声只由 ChapterVideo 统一混入。编辑仍由原生 Remotion Studio 负责。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["bgm", "ambience"] as const).map((role) => (
            <Button key={role} size="sm" variant="outline" disabled={!chapterManifest || chapterAudioBusy} onClick={() => { void importSharedAudio(role); }}>
              导入{role === "bgm" ? "BGM" : "环境声"}
            </Button>
          ))}
        </div>
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
                  <input className="h-7 rounded border border-border bg-background px-2 text-foreground" type="number" min="0" step={String(step)} defaultValue={Number(value).toFixed(3)} onBlur={(event) => { const parsed = Number(event.currentTarget.value); if (Number.isFinite(parsed)) void updateSharedAudio(binding, (toPatch as (value: number) => Partial<RemotionChapterAudioBindingV2>)(parsed)); }} />
                </label>
              ))}
              {[
                ["淡入(s)", binding.fadeInUs / 1_000_000, (value: number) => ({ fadeInUs: Math.round(value * 1_000_000) })],
                ["淡出(s)", binding.fadeOutUs / 1_000_000, (value: number) => ({ fadeOutUs: Math.round(value * 1_000_000) })],
                ["包络增益", binding.envelope[0]?.gain ?? 1, (value: number) => ({ envelope: [{ timeUs: 0, gain: value }, { timeUs: binding.durationUs, gain: value }] })],
              ].map(([label, value, toPatch]) => (
                <label key={String(label)} className="grid gap-1 text-[10px] text-muted-foreground">
                  {String(label)}
                  <input className="h-7 rounded border border-border bg-background px-2 text-foreground" type="number" min="0" step="0.01" defaultValue={Number(value).toFixed(3)} onBlur={(event) => { const parsed = Number(event.currentTarget.value); if (Number.isFinite(parsed)) void updateSharedAudio(binding, (toPatch as (value: number) => Partial<RemotionChapterAudioBindingV2>)(parsed)); }} />
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <input type="checkbox" checked={binding.ducking.enabled} onChange={(event) => { void updateSharedAudio(binding, { ducking: { ...binding.ducking, enabled: event.currentTarget.checked } }); }} />
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
      <section aria-label="首镜横屏预览" data-first-shot-preview className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-xs">
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
          直接使用当前章节 S01 的真实画面与 voice/SFX 绑定，通过 Remotion 队列生成项目内单镜 MP4，不需要终端命令。
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
        <p className="mt-1 text-muted-foreground">voice/TTS 与 SFX 只进入对应 StoryboardShot MP4；章节共享 BGM/环境声不会重复烘入单镜。</p>
        <div className="mt-3 space-y-2">
          {currentChapterStoryboards.map((storyboard) => {
            const job = selectCurrentShotJobForStoryboard(storyboard, queueScope.jobs, queueScope.currentShotSlots);
            const currentSlot = remotionShotSlots.find((slot) => slot.target.kind === "shot"
              && slot.target.chapterId === chapterId
              && slot.target.shotId === storyboard.id
              && slot.target.shotRevision === Math.max(1, storyboard.outputVersion ?? 1));
            const voice = storyboard.shotAudioBindings?.find((binding) => binding.role === "voice");
            const sfx = storyboard.shotAudioBindings?.find((binding) => binding.role === "sfx");
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
                  <div className="truncate font-medium">S{String(storyboard.index).padStart(2, "0")} · {storyboard.videoDesc || storyboard.prompt || storyboard.id}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    TTS {voice?.ttsInputFingerprint ? "已绑定" : "缺失"} · SFX {sfx ? "已绑定" : "未引用"} · revision {storyboard.outputVersion ?? 1}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" disabled={!chapterManifest || chapterAudioBusy} onClick={() => { void importShotSfx(storyboard.id); }}>导入 SFX</Button>
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
          <div className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-xs text-cyan-100">
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
    </div>
  );
}

export function isCurrentChapterReady(
  episodeId: string,
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"],
  slots: RemotionCurrentSlotV1[],
  storyboardSourcePolicy: VideoUseStoryboardSourcePolicy = "current-ready",
) {
  const currentStoryboards = storyboards.filter((storyboard) => storyboard.episodeId === episodeId);
  return currentStoryboards.length > 0
    && countCurrentShotSlots(episodeId, currentStoryboards, slots, storyboardSourcePolicy) === currentStoryboards.length;
}

/**
 * The workbench must create an EditingProject from the direct, chapter-scoped
 * queue read. Props only keep standalone renderer tests usable before the
 * desktop bridge has answered; a loaded empty/error scope remains fail-closed.
 */
export function resolveWorkbenchRemotionShotSlots(
  queueScope: Pick<RemotionQueueScopeState, "loaded" | "currentShotSlots">,
  fallbackSlots?: RemotionCurrentSlotV1[],
): RemotionCurrentSlotV1[] {
  return queueScope.loaded ? queueScope.currentShotSlots : fallbackSlots ?? [];
}

export function countCurrentShotSlots(
  episodeId: string,
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"],
  slots: RemotionCurrentSlotV1[],
  storyboardSourcePolicy: VideoUseStoryboardSourcePolicy = "current-ready",
) {
  const currentStoryboards = storyboards.filter((storyboard) => storyboard.episodeId === episodeId);
  return currentStoryboards.filter((storyboard) => isStoryboardReadyForVideoWorkflow(storyboard, storyboardSourcePolicy) && slots.some((slot) => slot.target.kind === "shot"
    && slot.target.chapterId === episodeId
    && slot.target.shotId === storyboard.id
    && slot.target.shotRevision === Math.max(1, storyboard.outputVersion ?? 1)
    && slot.job.status === "succeeded")).length;
}

export function selectCurrentShotJobForStoryboard(
  storyboard: ReturnType<typeof useStudioStore.getState>["storyboards"][number],
  jobs: RemotionRenderJobV1[],
  slots: RemotionCurrentSlotV1[],
): RemotionRenderJobV1 | undefined {
  const revision = Math.max(1, storyboard.outputVersion ?? 1);
  const currentSlot = slots.find((slot) => slot.target.kind === "shot"
    && slot.target.chapterId === storyboard.episodeId
    && slot.target.shotId === storyboard.id
    && slot.target.shotRevision === revision);
  if (currentSlot) return currentSlot.job;
  return jobs
    .filter((item) => item.target.kind === "shot"
      && item.target.chapterId === storyboard.episodeId
      && item.target.shotId === storyboard.id
      && item.target.shotRevision === revision)
    .slice()
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))[0];
}

function formatFirstShotStatus(status: RemotionRenderJobV1["status"]): string {
  switch (status) {
    case "queued":
    case "running":
      return status === "queued" ? "排队中" : "渲染中";
    case "succeeded":
      return "已生成";
    case "failed":
      return "生成失败";
    case "canceled":
      return "已取消";
    case "stale":
      return "已过期";
    case "blocked":
      return "已阻塞";
    case "ready":
      return "待执行";
    case "pending":
      return "待准备";
    default:
      return status;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function filterProjectItems<T extends { projectId?: string }>(
  items: T[],
  projectId: string | null,
) {
  return projectId ? items.filter((item) => item.projectId === projectId) : items;
}

export function buildWorkbenchAssetMediaMap(
  characters: ReturnType<typeof useCharacterLibraryStore.getState>["characters"],
  scenes: ReturnType<typeof useSceneStore.getState>["scenes"],
  propsItems: ReturnType<typeof usePropsLibraryStore.getState>["items"],
): Record<string, ToonflowWorkbenchAssetMedia> {
  const entries: Record<string, ToonflowWorkbenchAssetMedia> = {};
  for (const character of characters) {
    const path =
      character.thumbnailUrl ??
      character.views.find((view) => view.imageUrl)?.imageUrl ??
      character.referenceImages?.[0];
    if (path) {
      entries[character.id] = {
        id: character.id,
        name: character.name,
        fileType: "image",
        path,
        prompt: character.visualTraits || character.description,
      };
    }
    for (const variation of character.variations ?? []) {
      entries[variation.id] = {
        id: variation.id,
        name: variation.name,
        fileType: "image",
        path: variation.referenceImage,
        prompt: variation.visualPromptZh || variation.visualPrompt,
        parentAssetId: character.id,
        parentAssetName: character.name,
        state: variation.name,
        reason: variation.stageDescription || variation.ageDescription,
        imageWorkflowId: variation.imageWorkflowId,
        imageWorkflowTarget: {
          kind: "asset",
          assetType: "character",
          parentId: character.id,
          id: variation.id,
        },
      };
    }
  }
  for (const scene of scenes) {
    const path =
      scene.referenceImage ??
      scene.referenceImageBase64 ??
      getOptionalStringField(scene, "contactSheetImage");
    entries[scene.id] = {
      id: scene.id,
      name: scene.viewpointName || scene.name,
      fileType: "image",
      path,
      prompt: scene.visualPrompt || scene.location || scene.atmosphere,
      parentAssetId: scene.parentSceneId,
      parentAssetName: scene.parentSceneId
        ? scenes.find((item) => item.id === scene.parentSceneId)?.name
        : undefined,
      state: scene.viewpointName,
      reason: scene.notes || scene.spatialLayout,
      imageWorkflowId: scene.imageWorkflowId,
      imageWorkflowTarget: scene.parentSceneId
        ? {
            kind: "asset",
            assetType: "scene",
            parentId: scene.parentSceneId,
            id: scene.id,
          }
        : undefined,
    };
  }
  for (const item of propsItems) {
    entries[item.id] = {
      id: item.id,
      name: item.category || item.name,
      fileType: "image",
      path: item.imageUrl,
      prompt: item.visualPrompt || item.description,
      parentAssetId: item.parentId,
      parentAssetName: item.parentId
        ? propsItems.find((prop) => prop.id === item.parentId)?.name
        : undefined,
      state: item.category,
      reason: item.description,
      imageWorkflowId: item.imageWorkflowId,
      imageWorkflowTarget: item.parentId
        ? {
            kind: "asset",
            assetType: "prop",
            parentId: item.parentId,
            id: item.id,
          }
        : undefined,
    };
  }
  return entries;
}

function getOptionalStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}
