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
import { buildRemotionShotPlans } from "@/lib/studio/remotion/remotion-shot-plan-builder";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import { createReadyShotJob } from "@rendering/plugins/remotion/queue/remotion-render-queue";
import { runStoryboardTtsGeneration } from "@/lib/studio/storyboard-tts-runner";
import {
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
import type { TtsSpeakerId, VoiceProfile } from "@/types/tts";
import { latestAgentWork } from "./workflow-helpers";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";

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
  const running = !["idle", "completed", "failed", "blocked"].includes(status.stage);

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
        projectId: activeProjectId,
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
            const studioAssets = getStudioAssetsBridge();
            if (!studioAssets?.list) {
              throw new Error("素材读取接口仅在桌面应用中可用");
            }
            const ttsRuntime = getTtsRuntimeBridge();
            if (!ttsRuntime?.resolveReferenceAudioPath) {
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

            const audioAssets = await studioAssets.list({
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
                ttsRuntime.resolveReferenceAudioPath(audioPath),
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
            if (mediaPath.startsWith("project-file://")) {
              return window.projectFiles?.getAbsolutePath(mediaPath) ?? null;
            }
            return getTtsRuntimeBridge()?.resolveReferenceAudioPath(mediaPath) ?? null;
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
          enqueueRemotionShots: async ({ projectId, chapterId, storyboards }) => {
            const runtime = await window.remotionRuntime?.workspaceRuntime?.();
            const queue = window.remotionQueue;
            if (!runtime || !queue?.enqueueShot) {
              throw new Error("Remotion workspace runtime 或持久队列接口不可用");
            }
            const studio = useStudioStore.getState();
            const firstChapter = studio.novelChapters
              .slice()
              .sort((left, right) => left.index - right.index)[0]?.id;
            const plans = await buildRemotionShotPlans({
              projectId,
              chapterId,
              chapterRevision: 1,
              renderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
              storyboards,
              requireHumanApproval: !firstChapter || firstChapter === chapterId,
              continuityPolicy: "required",
              assetVersions: studio.continuityAssetVersions,
            });
            const jobs: RemotionRenderJobV1[] = [];
            const blockedShotIds = plans.success ? [] : [...plans.blockedShotIds];
            for (const plan of plans.plans) {
              const job = await createReadyShotJob({
                plan,
                bundleContentHash: runtime.bundleContentHash,
                templateVersion: runtime.templateVersion,
                remotionVersion: runtime.remotionVersion,
              });
              const result = await queue.enqueueShot({ job, plan });
              if (result.accepted || result.reason === "already-succeeded" || result.reason === "duplicate-active") {
                jobs.push(result.job);
              } else {
                blockedShotIds.push(plan.shot.shotId);
              }
            }
            return { jobs, blockedShotIds };
          },
        },
      });
      if (result.queueStatus === "blocked") {
        toast.error(`Remotion 分镜队列已阻塞：${result.blockedShotIds?.join("、") || "请检查分镜物料"}`);
      } else {
        toast.success(`已提交 ${result.remotionJobs?.length ?? 0} 个 Remotion 分镜任务，等待章节合成`);
      }
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
