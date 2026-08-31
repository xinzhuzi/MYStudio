import { buildWorkflowSmokeChecks } from "./workflow-smoke-checks";
import { resetSmokeEditingStore, seedSmokeEditingEvidence } from "./workflow-smoke-editing-evidence";
import { buildWorkflowSmokeStageEvidenceText } from "./workflow-smoke-stage-evidence";
import { buildWorkflowParityReport } from "@/lib/studio/workflow-parity-report";
import { buildWorkflowReadiness } from "@/lib/studio/workflow-readiness";
import { useEditingStore } from "@/stores/editing/editing-store";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import type { AgentWorkKey, StudioAgentRun } from "@/types/studio";
import type { ProjectVoiceBinding, SceneVoiceLine, VoiceProfile } from "@/types/tts";
import { stepwiseEvidence } from "./workflow-smoke-evidence";
import { SMOKE_CHAPTER_ID, SMOKE_EDITING_PROJECT_ID, SMOKE_PROJECT_ID, SMOKE_ROLE_ID, WorkflowSmokeInspection, WorkflowSmokeResult, WorkflowSmokeStageEvidence, WorkflowSmokeStageResult, getSmokeAudioPath, getSmokeFrameGraphPath, getSmokeVideoPath } from "./workflow-smoke-shared";

/**
 * smoke 桥核心——全量种子/巡检/阶段证据(写入者)/agent-work 工具。file-size-reduction 专批拆出,体逐字保留。
 */
export async function seedCompleteWorkflow(): Promise<WorkflowSmokeResult> {
  const studio = useStudioStore.getState();
  const projectId = useProjectStore.getState().activeProjectId ?? SMOKE_PROJECT_ID;
  studio.resetStudioWorkflow();
  resetSmokeEditingStore(projectId);

  const now = Date.now();
  const chapterId = "smoke-chapter-1";
  const roleId = "smoke-role-sword";
  const sceneId = "smoke-scene-mine";
  const propId = "smoke-prop-sword";
  const storyboardId = "smoke-storyboard-1";
  const trackId = "smoke-track-1";
  const videoId = "smoke-video-1";
  const audioPath = getSmokeAudioPath();
  const videoPath = getSmokeVideoPath();
  const framePath = await getSmokeFrameGraphPath();

  useCharacterLibraryStore.setState({
    characters: [
      {
        id: roleId,
        name: "独孤剑尘",
        description: "青年剑修，冷静克制。",
        visualTraits: "ink-wash young swordsman, black robe, broken sword",
        projectId,
        views: [],
        variations: [
          {
            id: `${roleId}-wanderer`,
            name: "落魄江湖客",
            visualPrompt: "damaged robe, dust and blood, consistent face",
            visualPromptZh: "破损玄衣，尘土血痕，保持面部一致",
            referenceImage: framePath,
            imageWorkflowId: "smoke-flow-role-wanderer",
            stageDescription: "矿场醒来后的受伤状态",
            generatedAt: now,
          },
        ],
        thumbnailUrl: framePath,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  useSceneStore.setState({
    scenes: [
      {
        id: sceneId,
        name: "矿场",
        location: "暗色矿坑",
        time: "夜",
        atmosphere: "铁链与尘雾",
        projectId,
        referenceImage: framePath,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `${sceneId}-low-angle`,
        name: "矿场低机位推进",
        location: "暗色矿坑",
        time: "夜",
        atmosphere: "压迫",
        projectId,
        parentSceneId: sceneId,
        viewpointName: "低机位推进",
        referenceImage: framePath,
        imageWorkflowId: "smoke-flow-scene-low-angle",
        spatialLayout: "矿道纵深，人物从画面底部抬头",
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  usePropsLibraryStore.setState({
    items: [
      {
        id: propId,
        name: "断剑",
        description: "主线道具，剑身断裂。",
        imageUrl: framePath,
        projectId,
        folderId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `${propId}-broken`,
        name: "断剑破损版",
        description: "矿尘覆盖、裂纹更明显的衍生道具。",
        imageUrl: framePath,
        parentId: propId,
        category: "断剑破损版",
        imageWorkflowId: "smoke-flow-prop-broken",
        projectId,
        folderId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedFolderId: "all",
  });

  studio.setWorkflowConfig({
    visualManualId: "2D_chinese_guofeng",
    directorManualId: "Xianxia_fantasy",
    episodeDurationMin: 3,
    episodeCount: 1,
    platformSpec: "9:16",
    workflowStage: "workbench",
  });
  useStudioStore.setState({
    novelChapters: [
      {
        id: chapterId,
        index: 1,
        title: "Smoke 第一章",
        sourceText: "独孤剑尘在矿场醒来，听见远处铁链震响。",
        eventSummary: "矿场醒来，主线冲突建立。",
        eventState: "主角入局，矿场压迫和断剑线索同时出现。",
        eventTaskState: "success",
        eventRawOutput: "|章节|角色|事件|主线|密度|时长|情绪|",
        importedAt: now,
        updatedAt: now,
      },
    ],
    agentWorkData: [
      work("eventAnalysis", "事件分析完成：成功 1 章，失败 0 章。", chapterId, now),
      work("storySkeleton", "故事骨架：矿场觉醒、断剑牵引、逃出生天。", chapterId, now),
      work("storySkeletonReview", "故事骨架审核：通过，事件因果完整。", chapterId, now),
      work("adaptationStrategy", "改编策略：压缩背景，强化动作和悬念。", chapterId, now),
      work("adaptationStrategyReview", "改编策略审核：通过，3 分钟节奏可执行。", chapterId, now),
      work("scriptDraft", "## S01\n独孤剑尘睁眼，尘土和铁链声压下来。", chapterId, now),
      work("scriptDraftReview", "剧本审核：通过，镜头动作和台词齐全。", chapterId, now),
      work("storyboardTable", "|镜头|画面|台词|\n|1|水墨矿场醒来|他在尘土里醒来。|", chapterId, now),
      work("productionPlan", `本地成片输出: ${videoPath}`, "episode-1", now),
    ],
    agentRuns: [
      run("eventAnalysis", "script", "smoke-event-analysis", now),
      run("storySkeleton", "script", "smoke-storySkeleton", now),
      run("adaptationStrategy", "script", "smoke-adaptationStrategy", now),
      run("scriptDraft", "script", "smoke-scriptDraft", now),
      run("entityExtraction", "assets", "smoke-entity-1", now),
      run("directorPlan", "scriptPlan", "smoke-plan-1", now),
      run("storyboardTable", "storyboardTable", storyboardId, now),
      run("storyboardImage", "storyboard", "smoke-storyboard-flow-1", now),
      run("voiceAssign", "workbench", "smoke-voice-profile", now),
      run("productionPlan", "workbench", videoPath, now),
    ],
    entityExtractions: [
      {
        id: "smoke-entity-1",
        episodeId: chapterId,
        characters: [{ characterId: roleId, name: "独孤剑尘", aliases: ["剑尘"], note: "青年剑修，冷静克制。" }],
        scenes: [{ sceneId, name: "矿场", note: "暗色矿坑，铁链与尘雾。" }],
          props: [{ assetId: propId, name: "断剑", note: "主线道具。" }],
      },
    ],
    scriptPlans: [
      {
        id: "smoke-plan-1",
        episodeId: chapterId,
        theme: "矿场入局",
        visualStyle: "水墨漫剧",
        narrativeRhythm: "压迫后爆发",
        sceneIntents: [{ sceneId, emotion: "压抑", shotIntent: "低机位推进", spatial: "矿道纵深" }],
        soundDirection: "低频铁链声，青年男声克制。",
        transitions: "硬切到断剑特写",
        derivedAssetPlan: [
          { parentAssetId: roleId, state: "落魄江湖客", reason: "主角矿场醒来后的受伤状态" },
          { parentAssetId: sceneId, state: "低机位推进", reason: "矿道压迫纵深镜头" },
          { parentAssetId: propId, state: "断剑破损版", reason: "断剑特写需要破损细节" },
        ],
      },
    ],
    seriesBible: {
      id: "smoke-bible-1",
      projectId,
      characterLocks: [{ characterId: roleId, appearance: "玄色长衣，束发，断剑在手。", voiceId: "smoke-voice-profile" }],
      sceneLocks: [sceneId],
      visualManualId: "2d_ink_xianxia",
      directorManualId: "xianxia_film_director",
      aspectRatio: "9:16",
      stylePositioning: "水墨漫剧",
    },
    storyboards: [
      {
        id: storyboardId,
        episodeId: chapterId,
        index: 1,
        trackKey: "opening",
        trackId,
        duration: 5,
        prompt: "@图1 为独孤剑尘角色参考，@图2 为矿场场景参考。【画面】@图1 在 @图2 睁眼，铁链震动。",
        videoDesc: "旁白：他在尘土里醒来。",
        assetIds: [roleId, sceneId],
        mediaRef: {
          kind: "image",
          path: framePath,
          imageWorkflowId: "smoke-storyboard-flow-1",
          imageWorkflowNodeId: "smoke-generated-1",
        },
        imageWorkflowId: "smoke-storyboard-flow-1",
        imageWorkflowNodeId: "smoke-generated-1",
        shouldGenerateImage: true,
        audioRef: { kind: "audio", path: audioPath },
        state: "ready",
        lines: "旁白：他在尘土里醒来。",
        speakerId: "narrator",
        sourceEvidence: {
          source: "smoke-seed",
          sourceProjectId: projectId,
          sourceEpisodeId: chapterId,
          sourceStoryboardId: storyboardId,
        },
        orderedReferenceManifest: [
          {
            order: 1,
            assetId: roleId,
            assetName: "独孤剑尘",
            assetKind: "character",
            imagePath: framePath,
            source: "smoke-project-character",
          },
          {
            order: 2,
            assetId: sceneId,
            assetName: "矿场",
            assetKind: "scene",
            imagePath: framePath,
            source: "smoke-project-scene",
          },
        ],
      },
    ],
    productionTracks: [
      {
        id: trackId,
        episodeId: chapterId,
        trackKey: "opening",
        storyboardIds: [storyboardId],
        prompt: "矿场醒来 opening",
        duration: 5,
        candidateVideoIds: [videoId],
        selectedVideoId: videoId,
        state: "ready",
      },
    ],
    videoCandidates: [
      {
        id: videoId,
        trackId,
        provider: "ffmpeg-local",
        filePath: videoPath,
        state: "ready",
        createdAt: now,
      },
    ],
  });
  seedSmokeEditingEvidence({
    projectId,
    editingProjectId: SMOKE_EDITING_PROJECT_ID,
    episodeId: chapterId,
    storyboardId,
    trackId,
    videoId,
    videoPath,
    now,
  });

  bindSmokeVoice(now);

  await waitForPersist();
  return inspectWorkflow();
}

export async function inspectWorkflow(): Promise<WorkflowSmokeInspection> {
  const studio = useStudioStore.getState();
  const tts = useTtsStore.getState();
  const editing = useEditingStore.getState();
  const project = tts.projects[tts.activeProjectId ?? "default-project"];
  const episodeId = studio.storyboards[0]?.episodeId ?? SMOKE_CHAPTER_ID;
  const readiness = buildWorkflowReadiness({
    workflowConfig: studio.workflowConfig,
    novelChapters: studio.novelChapters,
    agentWorkData: studio.agentWorkData,
    entityExtractions: studio.entityExtractions,
    scriptPlans: studio.scriptPlans,
    seriesBible: studio.seriesBible,
    storyboards: studio.storyboards,
    productionTracks: studio.productionTracks,
    videoCandidates: studio.videoCandidates,
    episodeId,
    editingProjects: editing.editingProjects,
    currentEditingProjectIdByEpisode:
      editing.currentEditingProjectIdByEpisode,
    timelineRenderRecordsByEditingProjectId:
      editing.timelineRenderRecordsByEditingProjectId,
    voiceBindings: Object.values(project?.bindings ?? {}),
    sceneVoiceLines: Object.values(project?.voiceLines ?? {}),
    capabilities: { textCompletion: true, studioRenderer: true },
  });
  const workflowParityReport = buildWorkflowParityReport({
    agentWorkData: studio.agentWorkData,
    agentRuns: studio.agentRuns,
    mediaTasks: studio.mediaTasks,
    entityExtractions: studio.entityExtractions,
    scriptPlans: studio.scriptPlans,
    storyboards: studio.storyboards,
    productionTracks: studio.productionTracks,
    videoCandidates: studio.videoCandidates,
    episodeId,
    editingProjects: editing.editingProjects,
    currentEditingProjectIdByEpisode:
      editing.currentEditingProjectIdByEpisode,
    timelineRenderRecordsByEditingProjectId:
      editing.timelineRenderRecordsByEditingProjectId,
    workflowConfig: studio.workflowConfig,
    evidenceBoundary: {
      seededUiSmoke: true,
      visibleWorkflowSmoke: stepwiseEvidence.length > 0,
      realProjectVisibleSmoke: false,
      realMediaGeneration: false,
    },
  });

  return {
    source: "isolated-smoke-project",
    progress: readiness.progress,
    nextStageId: readiness.nextStageId,
    nextActionLabel: readiness.nextActionLabel,
    stages: readiness.stages,
    evidence: [...stepwiseEvidence],
    editingEvidence: {
      source: "seeded-ui-smoke",
      editingProjectId:
        workflowParityReport.video.currentEditingProjectId,
      editingRevision: workflowParityReport.video.currentEditingRevision,
      timelineRenderJobId:
        workflowParityReport.video.timelineRenderRecord?.evidence.jobId,
      hasCompleteTimelineEvidence:
        workflowParityReport.video.hasCompleteTimelineEvidence,
      realMediaGeneration: false,
    },
    evidenceBoundary: workflowParityReport.evidenceBoundary,
    checks: buildWorkflowSmokeChecks({
      stages: readiness.stages,
      report: workflowParityReport,
      storyboardsCount: studio.storyboards.length,
      selectedCandidateCount: studio.productionTracks.filter((track) => Boolean(track.selectedVideoId)).length,
      voiceBindingCount: Object.keys(project?.bindings ?? {}).filter((speakerId) => speakerId.startsWith("character:")).length,
      completedVoiceAudioCount: Object.values(project?.voiceLines ?? {}).filter((line) => line.status === "completed" && Boolean(line.audioLocalPath || line.audioFilePath)).length,
    }),
    workflowParityReport,
  };
}

export async function recordStageEvidence(stageId: string): Promise<WorkflowSmokeStageResult> {
  const inspected = await inspectWorkflow();
  const stage = inspected.stages.find((item) => item.id === stageId);
  const ready = stage?.status === "ready";
  const evidenceText = stageEvidenceText(stageId);
  const evidence: WorkflowSmokeStageEvidence = {
    stageId,
    ready,
    evidence: evidenceText,
    progress: inspected.progress,
  };
  const existingIndex = stepwiseEvidence.findIndex((item) => item.stageId === stageId);
  if (existingIndex >= 0) stepwiseEvidence[existingIndex] = evidence;
  else stepwiseEvidence.push(evidence);
  const refreshed = await inspectWorkflow();
  return {
    ...refreshed,
    stageId,
    ready,
    evidenceText,
  };
}

export function stageEvidenceText(stageId: string) {
  const studio = useStudioStore.getState();
  const tts = useTtsStore.getState();
  const project = tts.projects[tts.activeProjectId ?? SMOKE_PROJECT_ID];
  return buildWorkflowSmokeStageEvidenceText({
    stageId,
    studio,
    ttsProject: project,
    editing: useEditingStore.getState(),
    episodeId: SMOKE_CHAPTER_ID,
  });
}

export function bindSmokeVoice(now: number) {
  const tts = useTtsStore.getState();
  tts.setActiveProjectId(SMOKE_PROJECT_ID);
  tts.ensureProject(SMOKE_PROJECT_ID);
  useTtsStore.setState((state) => {
    const profile: VoiceProfile = {
      id: "smoke-voice-profile",
      name: "Smoke 青年男声",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
      referenceAudioPath: getSmokeAudioPath(),
      referenceText: "我会走到最后。",
      createdAt: now,
      updatedAt: now,
    };
    const binding: ProjectVoiceBinding = {
      speakerId: `character:${SMOKE_ROLE_ID}`,
      profileId: profile.id,
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
    };
    const voiceLine: SceneVoiceLine = {
      sceneId: 1,
      speakerId: `character:${SMOKE_ROLE_ID}`,
      text: "我会走到最后。",
      profileId: profile.id,
      engine: "qwen",
      modelSize: "0.6B",
      status: "completed",
      audioLocalPath: getSmokeAudioPath(),
      audioFilePath: getSmokeAudioPath(),
      mocked: true,
      updatedAt: now,
    };
    return {
      voiceProfiles: { ...state.voiceProfiles, [profile.id]: profile },
      projects: {
        ...state.projects,
        [SMOKE_PROJECT_ID]: {
          voiceLines: { "1": voiceLine },
          bindings: { [binding.speakerId]: binding },
        },
      },
      activeProjectId: SMOKE_PROJECT_ID,
    };
  });
}

export function work(key: AgentWorkKey, data: string, episodeId: string, now: number) {
  return {
    id: `smoke-${key}`,
    key,
    episodeId,
    data,
    createdAt: now,
    updatedAt: now,
  };
}

export function run(key: AgentWorkKey, phase: string, outputRef: string, now: number): StudioAgentRun {
  return {
    id: `smoke-run-${key}`,
    key,
    phase,
    status: "success",
    inputSummary: `${key}:${SMOKE_CHAPTER_ID}`,
    inputFingerprint: `smoke:${key}:${SMOKE_CHAPTER_ID}`,
    outputRef,
    startedAt: now,
    finishedAt: now,
  };
}

export async function waitForPersist() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 100));
}
