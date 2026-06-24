import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import type { AgentWorkKey } from "@/types/studio";
import type { ProjectVoiceBinding, SceneVoiceLine, VoiceProfile } from "@/types/tts";

export interface WorkflowSmokeResult {
  progress: number;
  nextStageId: string;
  nextActionLabel: string;
  checks: Record<string, boolean>;
}

declare global {
  interface Window {
    mystudioWorkflowSmoke?: {
      seedCompleteWorkflow: () => Promise<WorkflowSmokeResult>;
      inspectWorkflow: () => Promise<WorkflowSmokeResult>;
      setWorkflowStage: (stage: string) => Promise<boolean>;
    };
  }
}

export function installWorkflowSmokeBridge() {
  if (typeof window === "undefined" || !window.mystudioSmoke?.enabled) return;
  if (!isIsolatedSmokeUserDataDir(window.mystudioSmoke.userDataDir)) return;
  window.mystudioWorkflowSmoke = {
    seedCompleteWorkflow,
    inspectWorkflow,
    setWorkflowStage,
  };
}

export function isIsolatedSmokeUserDataDir(userDataDir?: string): boolean {
  if (!userDataDir) return false;
  return /(?:^|[/\\])mystudio-(?:installed-)?smoke-[^/\\]+$/.test(userDataDir);
}

async function setWorkflowStage(stage: string): Promise<boolean> {
  useStudioStore.getState().setWorkflowConfig({ workflowStage: stage });
  return true;
}

async function seedCompleteWorkflow(): Promise<WorkflowSmokeResult> {
  const studio = useStudioStore.getState();
  studio.resetStudioWorkflow();

  const now = Date.now();
  const chapterId = "smoke-chapter-1";
  const roleId = "smoke-role-sword";
  const sceneId = "smoke-scene-mine";
  const storyboardId = "smoke-storyboard-1";
  const trackId = "smoke-track-1";
  const videoId = "smoke-video-1";
  const audioPath = "/tmp/mystudio-smoke-voice.wav";
  const videoPath = "/tmp/mystudio-smoke-final.mp4";

  studio.setWorkflowConfig({
    visualManualId: "2d_ink_xianxia",
    directorManualId: "xianxia_film_director",
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
      work("adaptationStrategy", "改编策略：压缩背景，强化动作和悬念。", chapterId, now),
      work("scriptDraft", "## S01\n独孤剑尘睁眼，尘土和铁链声压下来。", chapterId, now),
      work("productionPlan", `本地成片输出: ${videoPath}`, "episode-1", now),
    ],
    entityExtractions: [
      {
        id: "smoke-entity-1",
        episodeId: chapterId,
        characters: [{ characterId: roleId, name: "独孤剑尘", aliases: ["剑尘"], note: "青年剑修，冷静克制。" }],
        scenes: [{ sceneId, name: "矿场", note: "暗色矿坑，铁链与尘雾。" }],
        props: [{ assetId: "smoke-prop-sword", name: "断剑", note: "主线道具。" }],
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
        derivedAssetPlan: [{ parentAssetId: roleId, state: "needed", reason: "主角定版" }],
      },
    ],
    seriesBible: {
      id: "smoke-bible-1",
      projectId: "default-project",
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
        prompt: "水墨矿场，青年剑修睁眼，铁链震动。",
        videoDesc: "旁白：他在尘土里醒来。",
        assetIds: [roleId, sceneId],
        mediaRef: { kind: "image", path: "/tmp/mystudio-smoke-frame.png" },
        state: "ready",
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

  const tts = useTtsStore.getState();
  tts.setActiveProjectId("default-project");
  tts.ensureProject("default-project");
  useTtsStore.setState((state) => {
    const profile: VoiceProfile = {
      id: "smoke-voice-profile",
      name: "Smoke 青年男声",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
      referenceAudioPath: audioPath,
      referenceText: "我会走到最后。",
      createdAt: now,
      updatedAt: now,
    };
    const binding: ProjectVoiceBinding = {
      speakerId: `character:${roleId}`,
      profileId: profile.id,
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
    };
    const voiceLine: SceneVoiceLine = {
      sceneId: 1,
      speakerId: `character:${roleId}`,
      text: "我会走到最后。",
      profileId: profile.id,
      engine: "qwen",
      modelSize: "0.6B",
      status: "completed",
      audioLocalPath: audioPath,
      audioFilePath: audioPath,
      mocked: true,
      updatedAt: now,
    };
    return {
      voiceProfiles: { ...state.voiceProfiles, [profile.id]: profile },
      projects: {
        ...state.projects,
        "default-project": {
          voiceLines: { "1": voiceLine },
          bindings: { [binding.speakerId]: binding },
        },
      },
      activeProjectId: "default-project",
    };
  });

  await waitForPersist();
  return inspectWorkflow();
}

async function inspectWorkflow(): Promise<WorkflowSmokeResult> {
  const { buildWorkflowReadiness } = await import("@/lib/studio/workflow-readiness");
  const studio = useStudioStore.getState();
  const tts = useTtsStore.getState();
  const project = tts.projects[tts.activeProjectId ?? "default-project"];
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
    voiceBindings: Object.values(project?.bindings ?? {}),
    sceneVoiceLines: Object.values(project?.voiceLines ?? {}),
    capabilities: { textCompletion: true, studioRenderer: true },
  });

  return {
    progress: readiness.progress,
    nextStageId: readiness.nextStageId,
    nextActionLabel: readiness.nextActionLabel,
    checks: {
      manualsReady: readiness.stages[0]?.status === "ready",
      novelReady: readiness.stages[1]?.status === "ready",
      scriptReady: readiness.stages[2]?.status === "ready",
      assetsReady: readiness.stages[3]?.status === "ready",
      generationReady: readiness.stages[4]?.status === "ready",
      storyboardReady: readiness.stages[5]?.status === "ready",
      workbenchReady: readiness.stages[6]?.status === "ready",
      hasFinalExport: studio.agentWorkData.some((item) => item.key === "productionPlan" && item.data.includes("本地成片输出:")),
      hasSelectedCandidate: studio.productionTracks.some((track) => Boolean(track.selectedVideoId)),
      hasVoiceBinding: Object.keys(project?.bindings ?? {}).some((speakerId) => speakerId.startsWith("character:")),
      hasVoiceAudio: Object.values(project?.voiceLines ?? {}).some((line) => line.status === "completed" && Boolean(line.audioLocalPath || line.audioFilePath)),
    },
  };
}

function work(key: AgentWorkKey, data: string, episodeId: string, now: number) {
  return {
    id: `smoke-${key}`,
    key,
    episodeId,
    data,
    createdAt: now,
    updatedAt: now,
  };
}

async function waitForPersist() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 100));
}
