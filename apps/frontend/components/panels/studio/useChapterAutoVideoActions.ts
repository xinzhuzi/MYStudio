import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  buildRoleAudioCandidates,
  createNarratorVoiceTarget,
  planFixedRoleVoices,
  type FixedVoiceTarget,
} from "@/components/panels/assets/role-audio-auto-assign";
import {
  runChapterAutoVideo,
  type ChapterAutoVideoStatus,
} from "@/lib/studio/chapter-auto-video";
import {
  runProductionTrackRender,
} from "@/lib/studio/production-runners";
import {
  buildChapterEditingProject,
  createTimelineRenderRecord,
  renderChapterEditingProject,
} from "@/lib/studio/editing/chapter-editing-pipeline";
import { runStoryboardTtsGeneration } from "@/lib/studio/storyboard-tts-runner";
import {
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { useProjectStore } from "@/stores/project-store";
import { useEditingStore } from "@/stores/editing-store";
import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { TtsSpeakerId, VoiceProfile } from "@/types/tts";
import { latestAgentWork } from "./workflow-helpers";

const INITIAL_STATUS: ChapterAutoVideoStatus = {
  stage: "idle",
  detail: "尚未运行第一章自动成片",
};

export function useChapterAutoVideoActions({
  activeProjectId,
  productionEpisodeId,
  handleProductionNodeAction,
}: {
  activeProjectId?: string;
  productionEpisodeId: string;
  handleProductionNodeAction: (action: {
    id: string;
    targetStage: string;
    userInstruction?: string;
  }) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<ChapterAutoVideoStatus>(INITIAL_STATUS);
  const running = !["idle", "completed", "failed"].includes(status.stage);

  const assertProjectStillActive = useCallback(() => {
    const currentProjectId = useProjectStore.getState().activeProjectId;
    if (!activeProjectId || currentProjectId !== activeProjectId) {
      throw new Error("自动成片期间项目已切换，已停止写回");
    }
  }, [activeProjectId]);

  const handleRunChapterAutoVideo = useCallback(async () => {
    if (running) return;
    if (!activeProjectId) {
      toast.error("未选择项目，无法自动成片");
      return;
    }
    const episodeId = productionEpisodeId;

    try {
      const result = await runChapterAutoVideo({
        episodeId,
        onStatus: setStatus,
        dependencies: {
          ensurePlanning: async () => {
            assertProjectStillActive();
            let store = useStudioStore.getState();
            if (!store.scriptPlans.some((plan) => plan.episodeId === episodeId)) {
              await handleProductionNodeAction({
                id: "generate-director-plan",
                targetStage: "storyboard",
              });
              assertProjectStillActive();
              store = useStudioStore.getState();
              if (!store.scriptPlans.some((plan) => plan.episodeId === episodeId)) {
                throw new Error("导演计划生成失败，自动成片已停止");
              }
            }

            let storyboardTable = latestAgentWork(
              store.agentWorkData,
              "storyboardTable",
              episodeId,
            );
            if (!storyboardTable) {
              await handleProductionNodeAction({
                id: "generate-storyboard-table",
                targetStage: "storyboard",
              });
              assertProjectStillActive();
              store = useStudioStore.getState();
              storyboardTable = latestAgentWork(
                store.agentWorkData,
                "storyboardTable",
                episodeId,
              );
            }
            if (!storyboardTable) {
              throw new Error("动态导演分镜表生成失败，自动成片已停止");
            }
            const parsed = parseStoryboardTable(storyboardTable, episodeId, {
              requireShotSemantics: true,
            });
            if (parsed.errors.length > 0 || parsed.rows.length === 0) {
              throw new Error(
                `动态导演分镜表不可用: ${parsed.errors.join("；") || "没有分镜"}`,
              );
            }
            const characters = store.entityExtractions.find(
              (batch) => batch.episodeId === episodeId,
            )?.characters ?? [];
            const storyboards = toStoryboardItems(
              parsed.rows,
              episodeId,
              characters,
            );
            useStudioStore
              .getState()
              .replaceStoryboardsForEpisode(episodeId, storyboards);
          },
          loadStoryboards: () => useStudioStore.getState().storyboards,
          loadContinuityAssetVersions: () => useStudioStore.getState().continuityAssetVersions,
          ensureFixedVoiceProfiles: async (storyboards) => {
            assertProjectStillActive();
            if (!window.studioAssets?.list) {
              throw new Error("素材读取接口仅在桌面应用中可用");
            }
            if (!window.ttsRuntime?.resolveReferenceAudioPath) {
              throw new Error("固定音色文件校验接口不可用");
            }
            const store = useStudioStore.getState();
            const batch = store.entityExtractions.find(
              (item) => item.episodeId === episodeId,
            );
            if (!batch) throw new Error(`${episodeId} 缺少角色实体`);
            const characterById = new Map(
              batch.characters.map((character) => [character.characterId, character]),
            );
            const speakerIds = [
              ...new Set(
                storyboards
                  .map((storyboard) => storyboard.speakerId)
                  .filter((speakerId): speakerId is TtsSpeakerId => Boolean(speakerId)),
              ),
            ];
            const targets: FixedVoiceTarget[] = speakerIds.map((speakerId) => {
              if (speakerId === "narrator") return createNarratorVoiceTarget();
              const characterId = speakerId.slice("character:".length);
              const character = characterById.get(characterId);
              if (!character) {
                throw new Error(`speaker ${speakerId} 缺少角色实体`);
              }
              const role: StudioAssetSummary = {
                id: characterId,
                source: "manying-local",
                type: "role",
                name: character.name,
                description: character.note || "",
                setting: character.note || "",
              };
              return { speakerId, role };
            });

            const audioAssets = await window.studioAssets.list({
              type: "audio",
              limit: 9999,
            });
            assertProjectStillActive();
            useTtsStore.getState().setActiveProjectId(activeProjectId);
            const ttsState = useTtsStore.getState();
            const plan = await planFixedRoleVoices({
              targets,
              candidates: buildRoleAudioCandidates(
                store.materials,
                audioAssets.items ?? [],
              ),
              bindings: ttsState.projects[activeProjectId]?.bindings ?? {},
              voiceProfiles: ttsState.voiceProfiles,
              resolveReferenceAudioPath: (audioPath) =>
                window.ttsRuntime!.resolveReferenceAudioPath(audioPath),
            });
            if (plan.errors.length > 0) {
              throw new Error(plan.errors.map((item) => item.message).join("；"));
            }
            assertProjectStillActive();
            for (const item of plan.created) {
              const profile = useTtsStore
                .getState()
                .createVoiceProfile(item.draft.profile);
              useTtsStore.getState().bindSpeaker({
                ...item.draft.binding,
                profileId: profile.id,
              });
            }
            const resolvedState = useTtsStore.getState();
            const bindings = resolvedState.projects[activeProjectId]?.bindings ?? {};
            const profiles = {} as Record<TtsSpeakerId, VoiceProfile>;
            for (const speakerId of speakerIds) {
              const binding = bindings[speakerId];
              const profile = binding
                ? resolvedState.voiceProfiles[binding.profileId]
                : undefined;
              if (!profile) throw new Error(`speaker ${speakerId} 缺少固定 profile`);
              profiles[speakerId] = profile;
            }
            return profiles;
          },
          resolveMediaPath: async (mediaPath) => {
            assertProjectStillActive();
            return window.ttsRuntime?.resolveReferenceAudioPath(mediaPath) ?? null;
          },
          generateAudio: (storyboard, profile) =>
            runStoryboardTtsGeneration({ storyboard, profile }),
          writeStoryboardAudio: (storyboardId, result) => {
            assertProjectStillActive();
            useStudioStore.getState().updateStoryboard(storyboardId, {
              audioRef: result.audioRef,
              ttsGenerationId: result.generationId,
              ttsBackend: result.ttsBackend,
              ttsMocked: result.ttsMocked,
              ttsWarning: result.ttsWarning,
            });
          },
          rebuildTracks: () => {
            assertProjectStillActive();
            useStudioStore.getState().rebuildTracks();
          },
          loadTracks: () => useStudioStore.getState().productionTracks,
          loadCandidates: () => useStudioStore.getState().videoCandidates,
          renderTrack: async (track, storyboards) => {
            assertProjectStillActive();
            const studio = useStudioStore.getState();
            const candidateId = studio.addVideoCandidate({
              trackId: track.id,
              provider: "ffmpeg-local",
              state: "rendering",
            });
            try {
              const rendered = await runProductionTrackRender({
                track,
                storyboards,
              });
              assertProjectStillActive();
              useStudioStore.getState().updateVideoCandidate(candidateId, {
                state: "ready",
                filePath: rendered.filePath,
              });
              useStudioStore
                .getState()
                .selectVideoCandidate(track.id, candidateId);
              const candidate = useStudioStore
                .getState()
                .videoCandidates.find((item) => item.id === candidateId);
              if (!candidate) throw new Error(`轨道 ${track.id} 候选写回失败`);
              return candidate;
            } catch (error) {
              useStudioStore.getState().updateVideoCandidate(candidateId, {
                state: "failed",
                errorReason:
                  error instanceof Error ? error.message : String(error),
              });
              throw error;
            }
          },
          createEditingProject: async (storyboards) => {
            const studio = useStudioStore.getState();
            const projectState = useProjectStore.getState();
            const editingState = useEditingStore.getState();
            if (editingState.activeProjectId !== activeProjectId) {
              editingState.setActiveProjectId(activeProjectId);
            }
            const now = Date.now;
            const result = await buildChapterEditingProject({
              projectId: activeProjectId,
              episodeId,
              projectName: projectState.activeProject?.name ?? "漫影工作室",
              aspectRatio:
                studio.seriesBible?.aspectRatio ??
                studio.workflowConfig.platformSpec,
              directorPlan: studio.scriptPlans.find(
                (plan) => plan.episodeId === episodeId,
              ),
              storyboards,
              productionTracks: studio.productionTracks,
              videoCandidates: studio.videoCandidates,
              existingProjects: Object.values(editingState.editingProjects).filter(
                (project) =>
                  project.projectId === activeProjectId &&
                  project.episodeId === episodeId,
              ),
              runId: uniqueId("auto-edit"),
              editingProjectId: uniqueId(`editing-${episodeId}`),
              now,
              onRun: (run) => {
                const saved = useEditingStore.getState().saveAutoEditingRun(run);
                if (!saved.success) throw new Error(saved.issue.message);
              },
            });
            assertProjectStillActive();
            if (!result.success) {
              throw new Error(result.run.error ?? "一键剪辑失败");
            }
            const committed = useEditingStore.getState().commitAutoEditingResult(
              result.result,
              result.staleEditingProjectIds,
              now(),
            );
            if (!committed.success) throw new Error(committed.issue.message);
            return (
              useEditingStore.getState().editingProjects[
                committed.editingProjectId
              ] ?? result.result.project
            );
          },
          renderEditingProject: async (project) => {
            const renderer = window.studioRenderer;
            if (!renderer?.renderTimeline) {
              throw new Error("时间线渲染接口仅在桌面应用中可用");
            }
            const result = await renderChapterEditingProject({
              project,
              jobId: uniqueId("timeline-render"),
              createdAt: Date.now(),
              render: (plan) => renderer.renderTimeline(plan),
            });
            assertProjectStillActive();
            if (!result.success) throw new Error(result.error);
            return result.evidence;
          },
          writeFinalEvidence: (project, evidence) => {
            assertProjectStillActive();
            const record = createTimelineRenderRecord(
              project,
              evidence,
              Date.now(),
            );
            if (!record.success) {
              throw new Error(
                record.issues.map((issue) => issue.message).join("；"),
              );
            }
            const saved = useEditingStore
              .getState()
              .saveTimelineRenderRecord(record.value);
            if (!saved.success) throw new Error(saved.issue.message);
            useStudioStore.getState().saveAgentWorkData(
              "productionPlan",
              [
                `时间线成片输出: ${evidence.path}`,
                `EditingProject: ${project.id}@${project.revision}`,
                `TimelineRenderJob: ${evidence.jobId}`,
                `本地成片输出: ${evidence.path}`,
                `媒体证据: ${JSON.stringify(evidence)}`,
              ].join("\n"),
              episodeId,
            );
          },
        },
      });
      toast.success(`第一章自动成片完成：${result.finalPath}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "第一章自动成片失败");
    }
  }, [
    activeProjectId,
    assertProjectStillActive,
    handleProductionNodeAction,
    productionEpisodeId,
    running,
  ]);

  const handleOpenFinalVideo = useCallback(async () => {
    if (!status.finalPath) return;
    const result = await window.electronAPI?.openPath(status.finalPath);
    if (result && !result.success) {
      toast.error(result.error || "无法打开最终视频");
    }
  }, [status.finalPath]);

  return {
    chapterAutoVideoStatus: status,
    chapterAutoVideoRunning: running,
    handleRunChapterAutoVideo,
    handleOpenFinalVideo,
  };
}

function uniqueId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
