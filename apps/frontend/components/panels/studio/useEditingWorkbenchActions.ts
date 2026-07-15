import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildChapterEditingProject,
  createTimelineRenderRecord,
  renderChapterEditingProject,
} from "@/lib/studio/editing/chapter-editing-pipeline";
import type { EditingCommand } from "@/lib/studio/editing/command-core";
import {
  parseAssDialogue,
  parseSrt,
  serializeSrt,
} from "@/lib/studio/editing/subtitle-codec";
import { useEditingStore } from "@/stores/editing-store";
import { useProjectStore } from "@/stores/project-store";
import type {
  EditingProjectV1,
  TimelineRenderEvidence,
  TimelineRenderProgress,
} from "@/types/editing";
import type {
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

export interface UseEditingWorkbenchActionsInput {
  projectId?: string;
  episodeId: string;
  projectName: string;
  aspectRatio?: string;
  directorPlan?: ScriptPlan;
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
}

export function useEditingWorkbenchActions(
  input: UseEditingWorkbenchActionsInput,
) {
  const editingProjectId = useEditingStore((state) =>
    input.projectId
      && state.activeProjectId === input.projectId
      && input.episodeId
      ? state.currentEditingProjectIdByEpisode[input.episodeId]
      : undefined,
  );
  const currentProject = useEditingStore((state) =>
    editingProjectId ? state.editingProjects[editingProjectId] : undefined,
  );
  const history = useEditingStore((state) =>
    editingProjectId ? state.historyByEditingProjectId[editingProjectId] : undefined,
  );
  const persistedRenderRecord = useEditingStore((state) =>
    editingProjectId
      ? state.timelineRenderRecordsByEditingProjectId[editingProjectId]
      : undefined,
  );
  const [drafting, setDrafting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderJobId, setRenderJobId] = useState<string>();
  const [renderProgress, setRenderProgress] = useState<TimelineRenderProgress>();
  const [renderEvidence, setRenderEvidence] = useState<TimelineRenderEvidence>();
  const [error, setError] = useState<string>();
  const renderJobIdRef = useRef<string>();

  useEffect(() => {
    useEditingStore.getState().setActiveProjectId(input.projectId ?? null);
  }, [input.projectId]);

  useEffect(() => {
    if (!window.studioRenderer?.onTimelineRenderProgress) return undefined;
    return window.studioRenderer.onTimelineRenderProgress((progress) => {
      if (progress.jobId === renderJobIdRef.current) setRenderProgress(progress);
    });
  }, []);

  const createDraft = useCallback(async (): Promise<EditingProjectV1> => {
    const projectId = input.projectId;
    if (!projectId) throw new Error("请先选择项目再创建剪辑草案");
    if (!input.episodeId) throw new Error("当前工作流缺少 episode ID");
    setDrafting(true);
    setError(undefined);
    try {
      assertProjectActive(projectId);
      const now = Date.now;
      const state = useEditingStore.getState();
      if (state.activeProjectId !== projectId) state.setActiveProjectId(projectId);
      const result = await buildChapterEditingProject({
        ...input,
        projectId,
        existingProjects: Object.values(state.editingProjects).filter(
          (project) =>
            project.projectId === projectId
            && project.episodeId === input.episodeId,
        ),
        runId: uniqueId("auto-edit"),
        editingProjectId: uniqueId(`editing-${input.episodeId}`),
        now,
        onRun: (run) => {
          const saved = useEditingStore.getState().saveAutoEditingRun(run);
          if (!saved.success) throw new Error(saved.issue.message);
        },
      });
      assertProjectActive(projectId);
      if (!result.success) {
        throw new Error(formatDraftFailure(result));
      }
      const committed = useEditingStore.getState().commitAutoEditingResult(
        result.result,
        result.staleEditingProjectIds,
        now(),
      );
      if (!committed.success) throw new Error(committed.issue.message);
      toast.success(result.result.reusedExistingDraft ? "已打开现有剪辑草案" : "一键剪辑草案已生成");
      return useEditingStore.getState().editingProjects[committed.editingProjectId]
        ?? result.result.project;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      toast.error(message);
      throw caught;
    } finally {
      setDrafting(false);
    }
  }, [input]);

  const renderCurrent = useCallback(async () => {
    const projectId = input.projectId;
    if (!projectId) {
      const message = "请先选择项目再渲染";
      setError(message);
      toast.error(message);
      return;
    }
    setRendering(true);
    setError(undefined);
    setRenderEvidence(undefined);
    try {
      assertProjectActive(projectId);
      const project = useEditingStore
        .getState()
        .getCurrentEditingProject(input.episodeId) ?? await createDraft();
      assertProjectActive(projectId);
      const renderer = window.studioRenderer;
      if (!renderer?.renderTimeline) {
        throw new Error("时间线渲染接口仅在桌面应用中可用");
      }
      const jobId = uniqueId("timeline-render");
      renderJobIdRef.current = jobId;
      setRenderJobId(jobId);
      setRenderProgress({ jobId, stage: "validating", ratio: 0 });
      const result = await renderChapterEditingProject({
        project,
        jobId,
        createdAt: Date.now(),
        render: (plan) => renderer.renderTimeline(plan),
      });
      assertProjectActive(projectId);
      if (!result.success) throw new Error(result.error);
      const record = createTimelineRenderRecord(
        project,
        result.evidence,
        Date.now(),
      );
      if (!record.success) {
        throw new Error(record.issues.map((issue) => issue.message).join("；"));
      }
      const saved = useEditingStore
        .getState()
        .saveTimelineRenderRecord(record.value);
      if (!saved.success) throw new Error(saved.issue.message);
      setRenderEvidence(result.evidence);
      toast.success("一键成片完成");
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      toast.error(message);
    } finally {
      renderJobIdRef.current = undefined;
      setRenderJobId(undefined);
      setRenderProgress(undefined);
      setRendering(false);
    }
  }, [createDraft, input.episodeId, input.projectId]);

  const cancelRender = useCallback(async () => {
    if (!renderJobId || !window.studioRenderer?.cancelTimelineRender) return;
    const result = await window.studioRenderer.cancelTimelineRender(renderJobId);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
    }
  }, [renderJobId]);

  const executeCommand = useCallback((command: EditingCommand) => {
    if (!editingProjectId) return false;
    const result = useEditingStore.getState().executeCommand(editingProjectId, command);
    if (result.success) return true;
    setError(result.issue.message);
    toast.error(result.issue.message);
    return false;
  }, [editingProjectId]);

  const importSubtitles = useCallback(async (file: File) => {
    const projectId = input.projectId;
    if (!projectId) throw new Error("请先选择项目再导入字幕");
    const sourceFormat = file.name.toLowerCase().endsWith(".ass") ? "ass"
      : file.name.toLowerCase().endsWith(".srt") ? "srt"
        : undefined;
    if (!sourceFormat) throw new Error("只支持导入 .srt 或 .ass 字幕");
    try {
      assertProjectActive(projectId);
      const parsed = sourceFormat === "ass"
        ? parseAssDialogue(await file.text())
        : parseSrt(await file.text());
      assertProjectActive(projectId);
      if (parsed.cues.length === 0) {
        throw new Error(parsed.warnings[0]?.message ?? "字幕文件没有可导入的 cue");
      }
      const state = useEditingStore.getState();
      const project = state.getCurrentEditingProject(input.episodeId);
      if (!project) throw new Error("请先创建剪辑草案再导入字幕");
      const textTrack = project.tracks.find((track) => track.kind === "text");
      const trackId = textTrack?.id ?? uniqueId("subtitle-track");
      const warningMessages = parsed.warnings.map((warning) => warning.message);
      const sourceFingerprint = `${file.name}:${file.size}:${file.lastModified}`;
      const result = state.executeCommand(project.id, {
        type: "subtitle.replaceTrackCues",
        trackId,
        trackName: "字幕",
        clips: parsed.cues.map((cue, index) => ({
          id: uniqueId(`subtitle-${index + 1}`),
          trackId,
          name: `字幕 ${index + 1}`,
          source: {
            kind: "text",
            text: cue.text,
            evidence: { sourceFingerprint },
          },
          startUs: cue.startUs,
          durationUs: cue.endUs - cue.startUs,
          trimStartUs: 0,
          speed: 1,
          volume: 1,
          muted: false,
          subtitle: {
            sourceFormat,
            ...(warningMessages.length ? { warnings: warningMessages } : {}),
          },
        })),
        issuedAt: Date.now(),
      });
      if (!result.success) throw new Error(result.issue.message);
      if (parsed.warnings.length > 0) {
        toast.success(`已导入 ${parsed.cues.length} 条字幕，${parsed.warnings.length} 条样式警告已安全降级`);
      } else {
        toast.success(`已导入 ${parsed.cues.length} 条字幕`);
      }
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      toast.error(message);
      throw caught;
    }
  }, [input.episodeId, input.projectId]);

  const exportSubtitles = useCallback(async () => {
    const projectId = input.projectId;
    if (!projectId) throw new Error("请先选择项目再导出字幕");
    try {
      assertProjectActive(projectId);
      const project = useEditingStore.getState().getCurrentEditingProject(input.episodeId);
      if (!project) throw new Error("请先创建剪辑草案再导出字幕");
      const cues = project.clips
        .filter((clip) => clip.source.kind === "text" && clip.source.text?.trim())
        .map((clip) => ({
          startUs: clip.startUs,
          endUs: clip.startUs + clip.durationUs,
          text: clip.source.text!.trim(),
        }));
      if (cues.length === 0) throw new Error("当前时间线没有可导出的字幕");
      if (!window.projectFiles?.writeText || !window.electronAPI?.saveFileDialog) {
        throw new Error("字幕导出仅在桌面应用中可用");
      }
      const key = `_p/${projectId}/studio/editing/${project.id}/exports/${input.episodeId}.srt`;
      const saved = await window.projectFiles.writeText(key, serializeSrt(cues));
      assertProjectActive(projectId);
      if (!saved.success || !saved.filePath) throw new Error(saved.error ?? "字幕临时文件写入失败");
      const exported = await window.electronAPI.saveFileDialog({
        localPath: saved.filePath,
        defaultPath: `${safeFileName(project.name)}.srt`,
        filters: [{ name: "SubRip Subtitle", extensions: ["srt"] }],
      });
      assertProjectActive(projectId);
      if (exported.canceled) return;
      if (!exported.success) throw new Error(exported.error ?? "字幕导出失败");
      toast.success("SRT 字幕已导出");
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      toast.error(message);
      throw caught;
    }
  }, [input.episodeId, input.projectId]);

  const undo = useCallback(() => {
    if (!editingProjectId) return;
    const result = useEditingStore.getState().undo(editingProjectId, Date.now());
    if (!result.success) toast.error(result.issue.message);
  }, [editingProjectId]);

  const redo = useCallback(() => {
    if (!editingProjectId) return;
    const result = useEditingStore.getState().redo(editingProjectId, Date.now());
    if (!result.success) toast.error(result.issue.message);
  }, [editingProjectId]);

  return useMemo(() => ({
    currentProject,
    drafting,
    rendering,
    renderProgress,
    renderEvidence:
      renderEvidence ??
      (persistedRenderRecord && currentProject &&
      persistedRenderRecord.editingRevision === currentProject.revision
        ? persistedRenderRecord.evidence
        : undefined),
    error,
    canUndo: Boolean(history?.past.length),
    canRedo: Boolean(history?.future.length),
    createDraft,
    renderCurrent,
    cancelRender,
    executeCommand,
    importSubtitles,
    exportSubtitles,
    undo,
    redo,
  }), [
    cancelRender,
    createDraft,
    currentProject,
    drafting,
    error,
    executeCommand,
    exportSubtitles,
    history?.future.length,
    history?.past.length,
    importSubtitles,
    persistedRenderRecord,
    redo,
    renderCurrent,
    renderEvidence,
    rendering,
    renderProgress,
    undo,
  ]);
}

function assertProjectActive(projectId: string) {
  if (useProjectStore.getState().activeProjectId !== projectId) {
    throw new Error("项目已切换，剪辑操作已停止写回");
  }
}

function formatDraftFailure(
  result: Extract<
    Awaited<ReturnType<typeof buildChapterEditingProject>>,
    { success: false }
  >,
) {
  const failure = result.adapterFailure;
  if (!failure) return result.run.error ?? "一键剪辑失败";
  const details = [
    failure.episodeMissing ? `缺少 episode ${result.run.episodeId}` : "",
    failure.missingVisualStoryboardIds.length
      ? `缺画面: ${failure.missingVisualStoryboardIds.join(", ")}`
      : "",
    failure.missingAudioStoryboardIds.length
      ? `缺口播: ${failure.missingAudioStoryboardIds.join(", ")}`
      : "",
    failure.invalidDurationStoryboardIds.length
      ? `时长无效: ${failure.invalidDurationStoryboardIds.join(", ")}`
      : "",
    failure.invalidVoiceDurationStoryboardIds.length
      ? `口播时长无效: ${failure.invalidVoiceDurationStoryboardIds.join(", ")}`
      : "",
  ].filter(Boolean);
  return details.join("；") || result.run.error || "一键剪辑失败";
}

function uniqueId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "timeline-subtitles";
}
