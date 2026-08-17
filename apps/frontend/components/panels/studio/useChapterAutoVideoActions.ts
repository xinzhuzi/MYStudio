import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildRoleAudioCandidates,
  createNarratorVoiceTarget,
  planFixedRoleVoices,
  type FixedVoiceTarget,
} from "@/components/panels/assets/role-audio-auto-assign";
import {
  ChapterTtsCancellationController,
  runChapterAutoVideo,
  type RunVideoUseChapterInput,
  type ChapterAutoVideoStatus,
} from "@/lib/studio/chapter-auto-video";
import { buildVideoWorkflowChapterRunRequest } from "@/lib/studio/video-workflow/chapter-run-request";
import { buildRemotionShotPlans } from "@/lib/studio/remotion/remotion-shot-plan-builder";
import { createRemotionChapterManifestFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import { DEFAULT_REMOTION_RENDER_SETTINGS } from "@/lib/studio/remotion/remotion-workspace-storage";
import { createReadyShotJob } from "@/lib/studio/remotion/remotion-job-factory";
import { runStoryboardTtsGeneration } from "@/lib/studio/storyboard-tts-runner";
import {
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { useProjectStore } from "@/stores/project/project-store";
import { useEditingStore } from "@/stores/editing/editing-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type {
  RemotionChapterManifestV2,
  RemotionCurrentSlotV1,
  RemotionRenderJobV1,
} from "@/types/remotion-workspace";
import type { TtsSpeakerId, VoiceProfile } from "@/types/tts";
import { latestAgentWork } from "./workflow-helpers";
import { checkDepthModelReady } from "./depth-model-precheck";
import { getDepthRuntimeBridge } from "@/lib/bridge/depth-runtime";
import { selectCinematicPresets } from "@/lib/studio/cinematic-preset-ai";
import { selectShotFxMotions } from "@/lib/studio/remotion/shot-fx-ai";
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
  onVideoUseReviewRequired,
}: {
  activeProjectId?: string;
  productionEpisodeId: string;
  handleProductionNodeAction: (action: {
    id: string;
    targetStage: string;
    userInstruction?: string;
  }) => void | Promise<void>;
  onVideoUseReviewRequired?: () => void;
}) {
  const [status, setStatus] = useState<ChapterAutoVideoStatus>(INITIAL_STATUS);
  const ttsCancellationRef = useRef<ChapterTtsCancellationController | null>(null);
  const manifestWriteAbortRef = useRef<AbortController | null>(null);
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
    const chapterIdentity = useStudioStore.getState().novelChapters.find(
      (chapter) => chapter.id === episodeId,
    );
    const expectedIdentity = {
      sourceId: chapterIdentity?.sourceId ?? episodeId,
      revision: chapterIdentity?.revision ?? 1,
    };
    const ttsCancellation = new ChapterTtsCancellationController();
    ttsCancellationRef.current = ttsCancellation;

    try {
      const result = await runChapterAutoVideo({
        projectId: activeProjectId,
        episodeId,
        expectedIdentity,
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

            const canonicalStoryboards = store.storyboards.filter(
              (item) => item.episodeId === episodeId,
            );
            if (canonicalStoryboards.length > 0) {
              // JSON 编辑器和 Markdown 节点都已通过同一 store 合同写入
              // canonical records；优先使用它们，避免把同步后的 Markdown
              // 之外的 JSON/运行时字段再次当成分镜表解析。
              return;
            }
            let storyboardTable = latestAgentWork(
              store.agentWorkData,
              "storyboardTable",
              episodeId,
              { allowUnscopedFallback: false },
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
                { allowUnscopedFallback: false },
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
              {
                sourceId: store.novelChapters.find((chapter) => chapter.id === episodeId)?.sourceId ?? episodeId,
                revision: store.novelChapters.find((chapter) => chapter.id === episodeId)?.revision ?? 1,
              },
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
          ttsConcurrency: 2,
          isTtsCanceled: (storyboardId) => ttsCancellation.isCanceled(storyboardId),
          generateAudio: (storyboard, profile) =>
            runStoryboardTtsGeneration({
              projectId: activeProjectId,
              chapterId: episodeId,
              storyboard,
              profile,
              isCanceled: () => ttsCancellation.isCanceled(storyboard.id),
              onJob: (ttsJob) => {
                assertProjectStillActive();
                useStudioStore.getState().updateStoryboard(storyboard.id, { ttsJob });
              },
            }),
          writeStoryboardAudio: (storyboardId, result) => {
            assertProjectStillActive();
            const current = useStudioStore
              .getState()
              .storyboards.find((storyboard) => storyboard.id === storyboardId);
            const retainedBindings = current?.shotAudioBindings?.filter(
              (binding) => binding.role !== "voice",
            ) ?? [];
            useStudioStore.getState().writeStoryboardAudio(storyboardId, {
              audioRef: result.audioRef,
              shotAudioBindings: [...retainedBindings, result.shotAudioBinding],
              ttsJob: result.ttsJob,
              ttsGenerationId: result.generationId,
              ttsBackend: result.ttsBackend,
              ttsMocked: result.ttsMocked,
              ttsEmotionCapability: result.ttsEmotionCapability,
              ttsWarning: result.ttsWarning,
            });
          },
          enqueueRemotionShots: async ({ projectId, chapterId, storyboards, allStoryboards }) => {
            // AI 2D 镜头语言（正式路线）：逐镜选择 2D 运镜模式并写入分镜记录 shotFx。
            // 写入是装饰层（不进 sourceFingerprint、不触发审批门）；App 章节渲染与
            // CLI 全管线共享 store 单源。AI 不可用时回落关键词启发式，绝不阻塞渲染入队。
            try {
              const selection = await selectShotFxMotions(
                storyboards.map((storyboard) => ({
                  shotId: storyboard.id,
                  description: String(storyboard.videoDesc ?? storyboard.prompt ?? ""),
                  dialogue: String(storyboard.ttsSpokenText ?? ""),
                })),
              );
              if (selection.source !== "empty") {
                for (const [shotId, motion] of Object.entries(selection.motions)) {
                  useStudioStore.getState().updateStoryboard(shotId, { shotFx: { motion, source: selection.source } });
                }
                if (selection.source === "heuristic") {
                  console.warn("[shot-fx] AI 2D 运镜不可用，已用关键词启发式兜底");
                }
              }
            } catch (error) {
              console.warn("[shot-fx] 2D 运镜选择失败（渲染将用规则运镜）:", error);
            }
            // Depth model precheck: cinematic 3D needs an explicitly downloaded
            // model. Warn (and deep-link to settings) instead of silently
            // rendering flat 2D — the model never auto-downloads.
            const depthReadiness = await checkDepthModelReady();
            if (depthReadiness === "missing") {
              toast.error(
                "深度估计模型未下载，3D 电影级纵深将回退为 2D 渲染。请前往 设置 → 本地配置 → 深度估计模型 下载（约 100 MB）",
                {
                  action: {
                    label: "去设置",
                    onClick: () => {
                      const nav = useMediaPanelStore.getState();
                      nav.requestSettingsTab("plugins");
                      nav.setActiveTab("settings");
                    },
                  },
                },
              );
            } else if (depthReadiness === "ready") {
              // AI 镜头语言：auto 模式下按剧本语义为每个分镜选择相机预设。
              // AI 不可用时回落关键词启发式，绝不阻塞渲染入队。
              try {
                const depthBridge = getDepthRuntimeBridge();
                const depthStatus = await depthBridge?.status();
                if (!depthBridge || depthStatus?.cinematicPresetMode !== "manual") {
                  const selection = await selectCinematicPresets(
                    storyboards.map((storyboard) => ({
                      shotId: storyboard.id,
                      description: String(storyboard.videoDesc ?? storyboard.prompt ?? ""),
                      dialogue: String(storyboard.ttsSpokenText ?? ""),
                    })),
                  );
                  if (selection.source !== "empty") {
                    const map = { ...selection.presets, __default: selection.default };
                    await depthBridge?.setPresetMap(map);
                    if (selection.source === "heuristic") {
                      console.warn("[cinematic] AI 预设不可用，已用关键词启发式兜底");
                    }
                  }
                }
              } catch (error) {
                console.warn("[cinematic] 分镜相机预设分析失败（渲染将用默认预设）:", error);
              }
            }

            // Abort previous in-progress manifest write to prevent race conditions
            manifestWriteAbortRef.current?.abort();
            const abortController = new AbortController();
            manifestWriteAbortRef.current = abortController;

            const runtime = await window.remotionRuntime?.workspaceRuntime?.();
            const queue = window.remotionQueue;
            if (!runtime || !queue?.enqueueShot) {
              throw new Error("Remotion workspace runtime 或持久队列接口不可用");
            }
            const manifestBridge = window.remotionChapterManifest;
            if (!manifestBridge?.read || !manifestBridge.write) {
              throw new Error("Remotion chapter manifest bridge 不可用，已阻止章节队列提交");
            }
            const manifestReply = await manifestBridge.read({ projectId, chapterId });
            const currentManifest = manifestReply.status === "ready"
              ? manifestReply.manifest
              : undefined;
            const manifestRevision = Math.max(1, currentManifest?.revision ?? 1);
            const studio = useStudioStore.getState();
            const firstChapter = studio.novelChapters
              .slice()
              .sort((left, right) => left.index - right.index)[0]?.id;
            let plans = await buildRemotionShotPlans({
              projectId,
              chapterId,
              chapterRevision: manifestRevision,
              renderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
              storyboards,
              requireHumanApproval: !firstChapter || firstChapter === chapterId,
              continuityPolicy: "required",
              assetVersions: studio.continuityAssetVersions,
            });
            const completeShotSet = !allStoryboards || sameShotSet(storyboards, allStoryboards);
            if (!plans.success) {
              console.error("[one-click] buildRemotionShotPlans 失败, issues =", JSON.stringify(plans.issues?.slice(0, 8)));
            }
            if (plans.success && completeShotSet) {
              let manifest = await createChapterManifestForPlans({
                projectId,
                chapterId,
                revision: currentManifest?.revision ?? 1,
                sourceSnapshotHash: plans.sourceSnapshotHash,
                renderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
                plans: plans.plans,
                existing: currentManifest,
              });
              const unchanged = currentManifest
                ? await chapterManifestContentHash(currentManifest) === await chapterManifestContentHash(manifest)
                : false;
              if (!unchanged) {
                const nextRevision = currentManifest ? currentManifest.revision + 1 : 1;
                if (plans.success && plans.plans.some((plan) => plan.chapterRevision !== nextRevision)) {
                  plans = {
                    ...plans,
                    plans: plans.plans.map((plan) => ({ ...plan, chapterRevision: nextRevision })),
                  };
                }
                manifest = await createChapterManifestForPlans({
                  projectId,
                  chapterId,
                  revision: nextRevision,
                  sourceSnapshotHash: plans.sourceSnapshotHash,
                  renderSettings: DEFAULT_REMOTION_RENDER_SETTINGS,
                  plans: plans.plans,
                  existing: currentManifest,
                });

                // Check for abort before writing
                if (abortController.signal.aborted) {
                  return { jobs: [], blockedShotIds: [] };
                }

                await manifestBridge.write({
                  projectId,
                  chapterId,
                  expectedRevision: currentManifest?.revision ?? 0,
                  manifest,
                });
              }
            }
            const jobs: RemotionRenderJobV1[] = [];
            const blockedShotIds = plans.success ? [] : [...plans.blockedShotIds];
            for (const plan of plans.plans) {
              const job = await createReadyShotJob({
                plan,
                bundleContentHash: runtime.bundleContentHash,
                templateVersion: runtime.templateVersion,
                remotionVersion: runtime.remotionVersion,
              });

              // Check for abort before enqueueing shots
              if (abortController.signal.aborted) {
                return { jobs, blockedShotIds };
              }

              const result = await queue.enqueueShot({ job, plan });
              if (result.accepted || result.reason === "already-succeeded" || result.reason === "duplicate-active") {
                jobs.push(result.job);
              } else {
                console.error("[one-click] enqueueShot 拒绝:", plan.shot.shotId, result.reason, result.reason === "invalid" || result.reason === "blocked" ? result.message : "");
                blockedShotIds.push(plan.shot.shotId);
              }
            }
            return { jobs, blockedShotIds };
          },
          runVideoUseChapter: async (input) => {
            assertProjectStillActive();
            const bridge = typeof window !== "undefined" ? window.videoWorkflowPlugins : undefined;
            if (!bridge?.runChapter || !bridge.readChapter) {
              throw new Error("当前环境未接入 video-use 章节 bridge");
            }
            const currentShotSlots = await waitForCurrentChapterShotSlots({
              projectId: input.projectId,
              chapterId: input.chapterId,
              storyboards: input.storyboards,
              submission: input.submission,
              assertProjectStillActive,
            });
            const chapterState = await bridge.readChapter({
              schemaVersion: 1,
              projectId: input.projectId,
              chapterId: input.chapterId,
            });
            const currentEditingProject = useEditingStore
              .getState()
              .getCurrentEditingProject(input.chapterId);
            const revision = Math.max(
              (currentEditingProject?.revision ?? 0) + 1,
              (chapterState.revision ?? 0) + 1,
            );
            const scriptPlanTransitions = useStudioStore
              .getState()
              .scriptPlans.find((plan) => plan.episodeId === input.chapterId)?.transitions;
            const request = await buildVideoWorkflowChapterRunRequest({
              projectId: input.projectId,
              chapterId: input.chapterId,
              revision,
              mode: "editable-edl",
              storyboards: input.storyboards,
              remotionShotSlots: currentShotSlots,
              ...(scriptPlanTransitions ? { scriptPlanTransitions } : {}),
            });
            const reply = await bridge.runChapter(request);
            if (!reply.success || !reply.artifact || reply.state === "blocked") {
              return {
                state: "blocked" as const,
                revision: reply.revision,
                inputSha256: reply.artifact?.evidence.inputSha256,
              };
            }
            return {
              state: reply.state === "ready" ? "ready" as const : "pending" as const,
              revision: reply.revision,
              inputSha256: reply.artifact.evidence.inputSha256,
            };
          },
          onVideoUseReviewRequired,
        },
      });
      if (result.queueStatus === "blocked") {
        console.error("[one-click] 队列阻塞详情", JSON.stringify(result).slice(0, 800));
        toast.error(result.videoUseState === "blocked"
          ? "video-use preview 被阻塞，已暂停正式章节合成"
          : `Remotion 分镜队列已阻塞：${result.blockedShotIds?.join("、") || "请检查分镜物料"}`);
      } else if (result.queueStatus === "awaiting-review") {
        toast.success(`video-use 预览已生成 revision ${result.videoUseRevision ?? "-"}，请在视频工作台确认`);
      } else {
        toast.success(`已提交 ${result.remotionJobs?.length ?? 0} 个 Remotion 分镜任务，等待章节合成`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "第一章自动成片失败");
    } finally {
      if (ttsCancellationRef.current === ttsCancellation) {
        ttsCancellationRef.current = null;
      }
    }
  }, [
    activeProjectId,
    assertProjectStillActive,
    handleProductionNodeAction,
    onVideoUseReviewRequired,
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

  const handleCancelChapterTts = useCallback(() => {
    ttsCancellationRef.current?.cancelAll();
  }, []);

  const handleCancelShotTts = useCallback((storyboardId: string) => {
    ttsCancellationRef.current?.cancelShot(storyboardId);
  }, []);

  return {
    chapterAutoVideoStatus: status,
    chapterAutoVideoRunning: running,
    handleRunChapterAutoVideo,
    handleCancelChapterTts,
    handleCancelShotTts,
    handleOpenFinalVideo,
  };
}

async function createChapterManifestForPlans({
  projectId,
  chapterId,
  revision,
  sourceSnapshotHash,
  renderSettings,
  plans,
  existing,
}: {
  projectId: string;
  chapterId: string;
  revision: number;
  sourceSnapshotHash: string;
  renderSettings: typeof DEFAULT_REMOTION_RENDER_SETTINGS;
  plans: ReadonlyArray<{ shot: RemotionChapterManifestV2["shots"][number] }>;
  existing?: RemotionChapterManifestV2;
}): Promise<RemotionChapterManifestV2> {
  const now = Date.now();
  const manifest: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: "",
    projectId,
    chapterId,
    revision,
    sourceSnapshotHash,
    requiredShotIds: plans.map((plan) => plan.shot.shotId),
    sharedAudioBindings: existing?.sharedAudioBindings ?? [],
    shots: plans.map((plan) => plan.shot),
    renderSettings,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  manifest.manifestFingerprint = await createRemotionChapterManifestFingerprint(manifest);
  return manifest;
}

function sameShotSet(left: readonly { id: string }[], right: readonly { id: string }[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map((item) => item.id));
  return left.every((item) => rightIds.has(item.id));
}

async function chapterManifestContentHash(manifest: RemotionChapterManifestV2): Promise<string> {
  return sha256CanonicalJson({
    projectId: manifest.projectId,
    chapterId: manifest.chapterId,
    sourceSnapshotHash: manifest.sourceSnapshotHash,
    requiredShotIds: manifest.requiredShotIds,
    sharedAudioBindings: manifest.sharedAudioBindings,
    shots: manifest.shots,
    renderSettings: manifest.renderSettings,
  });
}

const REMOTION_SHOT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const REMOTION_SHOT_POLL_INTERVAL_MS = 500;

async function waitForCurrentChapterShotSlots(
  input: RunVideoUseChapterInput & { assertProjectStillActive: () => void },
): Promise<RemotionCurrentSlotV1[]> {
  const queue = typeof window !== "undefined" ? window.remotionQueue : undefined;
  if (!queue?.get) throw new Error("Remotion 队列读取接口不可用，已停止 video-use preview");
  const expectedRevisions = new Map(
    input.storyboards.map((storyboard) => [
      storyboard.id,
      Math.max(1, storyboard.outputVersion ?? 1),
    ]),
  );
  const submittedJobs = new Map(input.submission.jobs.map((job) => [job.jobId, job]));
  const startedAt = Date.now();
  const terminalFailureStatuses = new Set(["failed", "blocked", "canceled", "stale"]);
  while (Date.now() - startedAt <= REMOTION_SHOT_WAIT_TIMEOUT_MS) {
    input.assertProjectStillActive();
    const scope = await queue.get({ projectId: input.projectId, chapterId: input.chapterId });
    const failedJob = scope.jobs.find((job) =>
      input.submission.jobs.some((submitted) => submitted.jobId === job.jobId)
      && terminalFailureStatuses.has(job.status),
    );
    if (failedJob) {
      throw new Error(`Remotion 分镜 ${failedJob.jobId} ${failedJob.status}，已阻止 video-use preview`);
    }
    const currentSlots = scope.currentShotSlots.filter((slot) =>
      slot.target.kind === "shot"
      && expectedRevisions.get(slot.target.shotId) === slot.target.shotRevision
      && submittedJobs.has(slot.job.jobId)
      && submittedJobs.get(slot.job.jobId)?.inputHash === slot.job.inputHash
      && slot.job.status === "succeeded",
    );
    if (currentSlots.length === expectedRevisions.size) return currentSlots;
    await new Promise<void>((resolve) => setTimeout(resolve, REMOTION_SHOT_POLL_INTERVAL_MS));
  }
  throw new Error("等待全部 Remotion StoryboardShot MP4 超时，已阻止 video-use preview");
}
