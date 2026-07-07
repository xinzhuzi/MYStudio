import { useStudioStore } from "@/stores/studio-store";
import { useTtsStore } from "@/stores/tts-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import {
  buildWorkflowReadiness,
  type WorkflowStageReadiness,
} from "@/lib/studio/workflow-readiness";
import type { AgentWorkData, AgentWorkKey } from "@/types/studio";
import type { ProjectVoiceBinding, SceneVoiceLine, VoiceProfile } from "@/types/tts";

export interface WorkflowSmokeResult {
  progress: number;
  nextStageId: string;
  nextActionLabel: string;
  checks: Record<string, boolean>;
}

export interface WorkflowSmokeStageEvidence {
  stageId: string;
  ready: boolean;
  evidence: string;
  progress: number;
}

export interface WorkflowSmokeInspection extends WorkflowSmokeResult {
  source: "isolated-smoke-project";
  stages: WorkflowStageReadiness[];
  evidence: WorkflowSmokeStageEvidence[];
}

export interface WorkflowSmokeStageResult extends WorkflowSmokeInspection {
  stageId: string;
  ready: boolean;
  evidenceText: string;
}

declare global {
  interface Window {
    mystudioWorkflowSmoke?: {
      seedCompleteWorkflow: () => Promise<WorkflowSmokeResult>;
      inspectWorkflow: () => Promise<WorkflowSmokeInspection>;
      inspectWorkflowStages: () => Promise<WorkflowSmokeInspection>;
      resetForStepwiseExecution: () => Promise<WorkflowSmokeInspection>;
      runStepwiseWorkflowStage: (stage: string) => Promise<WorkflowSmokeStageResult>;
      setWorkflowStage: (stage: string) => Promise<boolean>;
    };
  }
}

const SMOKE_PROJECT_ID = "default-project";
const SMOKE_CHAPTER_ID = "smoke-chapter-1";
const SMOKE_ROLE_ID = "smoke-role-sword";
const SMOKE_SCENE_ID = "smoke-scene-mine";
const SMOKE_PROP_ID = "smoke-prop-sword";
const SMOKE_STORYBOARD_ID = "smoke-storyboard-1";
const SMOKE_TRACK_ID = "smoke-track-1";
const SMOKE_VIDEO_ID = "smoke-video-1";
const SMOKE_AUDIO_PATH = "/tmp/mystudio-smoke-voice.wav";
const SMOKE_VIDEO_PATH = "/tmp/mystudio-smoke-final.mp4";
const stepwiseEvidence: WorkflowSmokeStageEvidence[] = [];

export function installWorkflowSmokeBridge() {
  if (typeof window === "undefined" || !window.mystudioSmoke?.enabled) return;
  if (!isIsolatedSmokeUserDataDir(window.mystudioSmoke.userDataDir)) return;
  window.mystudioWorkflowSmoke = {
    seedCompleteWorkflow,
    inspectWorkflow,
    inspectWorkflowStages: inspectWorkflow,
    resetForStepwiseExecution,
    runStepwiseWorkflowStage,
    setWorkflowStage,
  };
}

export function isIsolatedSmokeUserDataDir(userDataDir?: string): boolean {
  if (!userDataDir) return false;
  return /(?:^|[/\\])mystudio-(?:installed-)?smoke-[^/\\]+$/.test(userDataDir);
}

export function getSmokeStoryboardFramePath() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADtgGOSHzRgQAAAABJRU5ErkJggg==";
}

async function setWorkflowStage(stage: string): Promise<boolean> {
  useStudioStore.getState().setWorkflowConfig({ workflowStage: stage });
  return true;
}

async function resetForStepwiseExecution(): Promise<WorkflowSmokeInspection> {
  stepwiseEvidence.length = 0;
  const studio = useStudioStore.getState();
  studio.resetStudioWorkflow();
  studio.setWorkflowConfig({ workflowStage: "manuals" });
  useCharacterLibraryStore.setState({ characters: [] });
  useSceneStore.setState({ scenes: [] });
  usePropsLibraryStore.setState({ items: [], selectedFolderId: "all" });
  const tts = useTtsStore.getState();
  tts.setActiveProjectId(SMOKE_PROJECT_ID);
  tts.ensureProject(SMOKE_PROJECT_ID);
  useTtsStore.setState((state) => ({
    projects: {
      ...state.projects,
      [SMOKE_PROJECT_ID]: { voiceLines: {}, bindings: {} },
    },
    activeProjectId: SMOKE_PROJECT_ID,
  }));
  await waitForPersist();
  return inspectWorkflow();
}

async function runStepwiseWorkflowStage(
  stage: string,
): Promise<WorkflowSmokeStageResult> {
  const now = Date.now();
  if (stage === "manuals") applyManualsStep();
  if (stage === "novel") applyNovelStep(now);
  if (stage === "script") applyScriptStep(now);
  if (stage === "assets") applyAssetsStep(now);
  if (stage === "storyboard") applyStoryboardStep(now);
  if (stage === "workbench") applyWorkbenchStep(now);
  await waitForPersist();
  return recordStageEvidence(stage);
}

function applyManualsStep() {
  useStudioStore.getState().setWorkflowConfig({
    visualManualId: "2d_ink_xianxia",
    directorManualId: "xianxia_film_director",
    episodeDurationMin: 3,
    episodeCount: 1,
    platformSpec: "9:16",
    workflowStage: "manuals",
  });
}

function applyNovelStep(now: number) {
  applyManualsStep();
  useStudioStore.setState({
    novelChapters: [
      {
        id: SMOKE_CHAPTER_ID,
        index: 1,
        title: "Smoke 第一章",
        sourceText: "独孤剑尘在矿场醒来，听见远处铁链震响。",
        eventSummary: "矿场醒来，主线冲突建立。",
        eventState: "主角入局，矿场压迫和断剑线索同时出现。",
        eventTaskState: "success",
        eventRawOutput:
          "|章节|角色|事件|主线|密度|时长|情绪|\n|Smoke 第一章|独孤剑尘|矿场醒来|主线冲突建立|高|180|压迫|",
        importedAt: now,
        updatedAt: now,
      },
    ],
    agentWorkData: [
      work("eventAnalysis", "事件分析完成：成功 1 章，失败 0 章。", SMOKE_CHAPTER_ID, now),
    ],
  });
}

function applyScriptStep(now: number) {
  applyNovelStep(now);
  useStudioStore.setState((state) => ({
    agentWorkData: upsertWorks(state.agentWorkData, [
      work("storySkeleton", "## 故事骨架\n矿场觉醒、断剑牵引、逃出生天。", SMOKE_CHAPTER_ID, now),
      work("storySkeletonReview", "## 故事骨架审核\n通过：事件因果完整，无需返修。", SMOKE_CHAPTER_ID, now),
      work("adaptationStrategy", "## 改编策略\n压缩背景，强化动作和悬念。", SMOKE_CHAPTER_ID, now),
      work("adaptationStrategyReview", "## 改编策略审核\n通过：节奏压缩符合 3 分钟规格。", SMOKE_CHAPTER_ID, now),
      work("scriptDraft", "## S01\n独孤剑尘睁眼，尘土和铁链声压下来。", SMOKE_CHAPTER_ID, now),
      work("scriptDraftReview", "## 剧本审核\n通过：台词、动作、情绪递进完整。", SMOKE_CHAPTER_ID, now),
    ]),
  }));
}

function applyAssetsStep(now: number) {
  applyScriptStep(now);
  const framePath = getSmokeStoryboardFramePath();
  useCharacterLibraryStore.setState({
    characters: [
      {
        id: SMOKE_ROLE_ID,
        name: "独孤剑尘",
        description: "青年剑修，冷静克制。",
        visualTraits: "ink-wash young swordsman, black robe, broken sword",
        projectId: SMOKE_PROJECT_ID,
        views: [],
        variations: [],
        thumbnailUrl: framePath,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  useSceneStore.setState({
    scenes: [
      {
        id: SMOKE_SCENE_ID,
        name: "矿场",
        location: "暗色矿坑",
        time: "夜",
        atmosphere: "铁链与尘雾",
        projectId: SMOKE_PROJECT_ID,
        referenceImage: framePath,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  usePropsLibraryStore.setState({
    items: [
      {
        id: SMOKE_PROP_ID,
        name: "断剑",
        description: "主线道具，剑身断裂。",
        imageUrl: framePath,
        projectId: SMOKE_PROJECT_ID,
        folderId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedFolderId: "all",
  });
  useStudioStore.setState({
    entityExtractions: [
      {
        id: "smoke-entity-1",
        episodeId: SMOKE_CHAPTER_ID,
        characters: [
          { characterId: SMOKE_ROLE_ID, name: "独孤剑尘", aliases: ["剑尘"], note: "青年剑修，冷静克制。" },
        ],
        scenes: [
          { sceneId: SMOKE_SCENE_ID, name: "矿场", note: "暗色矿坑，铁链与尘雾。" },
        ],
        props: [{ assetId: SMOKE_PROP_ID, name: "断剑", note: "主线道具。" }],
      },
    ],
  });
}

function applyStoryboardStep(now: number) {
  applyAssetsStep(now);
  const framePath = getSmokeStoryboardFramePath();
  useCharacterLibraryStore.setState({
    characters: [
      {
        id: SMOKE_ROLE_ID,
        name: "独孤剑尘",
        description: "青年剑修，冷静克制。",
        visualTraits: "ink-wash young swordsman, black robe, broken sword",
        projectId: SMOKE_PROJECT_ID,
        views: [],
        variations: [
          {
            id: `${SMOKE_ROLE_ID}-wanderer`,
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
        id: SMOKE_SCENE_ID,
        name: "矿场",
        location: "暗色矿坑",
        time: "夜",
        atmosphere: "铁链与尘雾",
        projectId: SMOKE_PROJECT_ID,
        referenceImage: framePath,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `${SMOKE_SCENE_ID}-low-angle`,
        name: "矿场低机位推进",
        location: "暗色矿坑",
        time: "夜",
        atmosphere: "压迫",
        projectId: SMOKE_PROJECT_ID,
        parentSceneId: SMOKE_SCENE_ID,
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
        id: SMOKE_PROP_ID,
        name: "断剑",
        description: "主线道具，剑身断裂。",
        imageUrl: framePath,
        folderId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `${SMOKE_PROP_ID}-broken`,
        name: "断剑破损版",
        description: "矿尘覆盖、裂纹更明显的衍生道具。",
        imageUrl: framePath,
        parentId: SMOKE_PROP_ID,
        category: "断剑破损版",
        imageWorkflowId: "smoke-flow-prop-broken",
        projectId: SMOKE_PROJECT_ID,
        folderId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedFolderId: "all",
  });
  useStudioStore.setState((state) => ({
    agentWorkData: upsertWorks(state.agentWorkData, [
      work(
        "directorPlan",
        [
          "## 导演计划",
          "- 主题：矿场入局",
          "- 视觉：水墨漫剧",
          "- 镜头：低机位推进",
        ].join("\n"),
        SMOKE_CHAPTER_ID,
        now,
      ),
      work("storyboardTable", "|镜头|画面|台词|\n|1|水墨矿场醒来|他在尘土里醒来。|", SMOKE_CHAPTER_ID, now),
      work("storyboardImage", `分镜 1 图片已保存：${framePath}`, SMOKE_CHAPTER_ID, now),
      work("voiceAssign", "已为独孤剑尘分配 Smoke 青年男声。", SMOKE_CHAPTER_ID, now),
    ]),
    scriptPlans: [
      {
        id: "smoke-plan-1",
        episodeId: SMOKE_CHAPTER_ID,
        theme: "矿场入局",
        visualStyle: "水墨漫剧",
        narrativeRhythm: "压迫后爆发",
        sceneIntents: [
          { sceneId: SMOKE_SCENE_ID, emotion: "压抑", shotIntent: "低机位推进", spatial: "矿道纵深" },
        ],
        soundDirection: "低频铁链声，青年男声克制。",
        transitions: "硬切到断剑特写",
        derivedAssetPlan: [
          { parentAssetId: SMOKE_ROLE_ID, state: "落魄江湖客", reason: "主角矿场醒来后的受伤状态" },
          { parentAssetId: SMOKE_SCENE_ID, state: "低机位推进", reason: "矿道压迫纵深镜头" },
          { parentAssetId: SMOKE_PROP_ID, state: "断剑破损版", reason: "断剑特写需要破损细节" },
        ],
      },
    ],
    seriesBible: {
      id: "smoke-bible-1",
      projectId: SMOKE_PROJECT_ID,
      characterLocks: [
        { characterId: SMOKE_ROLE_ID, appearance: "玄色长衣，束发，断剑在手。", voiceId: "smoke-voice-profile" },
      ],
      sceneLocks: [SMOKE_SCENE_ID],
      visualManualId: "2d_ink_xianxia",
      directorManualId: "xianxia_film_director",
      aspectRatio: "9:16",
      stylePositioning: "水墨漫剧",
    },
    storyboards: [
      {
        id: SMOKE_STORYBOARD_ID,
        episodeId: SMOKE_CHAPTER_ID,
        index: 1,
        trackKey: "opening",
        trackId: SMOKE_TRACK_ID,
        duration: 5,
        prompt: "水墨矿场，青年剑修睁眼，铁链震动。",
        videoDesc: "旁白：他在尘土里醒来。",
        assetIds: [SMOKE_ROLE_ID, SMOKE_SCENE_ID],
        mediaRef: { kind: "image", path: framePath },
        state: "ready",
      },
    ],
    productionTracks: [
      {
        id: SMOKE_TRACK_ID,
        episodeId: SMOKE_CHAPTER_ID,
        trackKey: "opening",
        storyboardIds: [SMOKE_STORYBOARD_ID],
        prompt: "矿场醒来 opening",
        duration: 5,
        candidateVideoIds: [],
        state: "ready",
      },
    ],
  }));
  bindSmokeVoice(now);
}

function applyWorkbenchStep(now: number) {
  applyStoryboardStep(now);
  useStudioStore.setState((state) => ({
    agentWorkData: upsertWorks(state.agentWorkData, [
      work("productionPlan", `本地成片输出: ${SMOKE_VIDEO_PATH}`, SMOKE_CHAPTER_ID, now),
    ]),
    productionTracks: [
      {
        id: SMOKE_TRACK_ID,
        episodeId: SMOKE_CHAPTER_ID,
        trackKey: "opening",
        storyboardIds: [SMOKE_STORYBOARD_ID],
        prompt: "矿场醒来 opening",
        duration: 5,
        candidateVideoIds: [SMOKE_VIDEO_ID],
        selectedVideoId: SMOKE_VIDEO_ID,
        state: "ready",
      },
    ],
    videoCandidates: [
      {
        id: SMOKE_VIDEO_ID,
        trackId: SMOKE_TRACK_ID,
        provider: "ffmpeg-local",
        filePath: SMOKE_VIDEO_PATH,
        state: "ready",
        createdAt: now,
      },
    ],
  }));
}

async function seedCompleteWorkflow(): Promise<WorkflowSmokeResult> {
  const studio = useStudioStore.getState();
  studio.resetStudioWorkflow();

  const now = Date.now();
  const chapterId = "smoke-chapter-1";
  const roleId = "smoke-role-sword";
  const sceneId = "smoke-scene-mine";
  const propId = "smoke-prop-sword";
  const storyboardId = "smoke-storyboard-1";
  const trackId = "smoke-track-1";
  const videoId = "smoke-video-1";
  const audioPath = "/tmp/mystudio-smoke-voice.wav";
  const framePath = getSmokeStoryboardFramePath();
  const videoPath = "/tmp/mystudio-smoke-final.mp4";

  useCharacterLibraryStore.setState({
    characters: [
      {
        id: roleId,
        name: "独孤剑尘",
        description: "青年剑修，冷静克制。",
        visualTraits: "ink-wash young swordsman, black robe, broken sword",
        projectId: "default-project",
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
        projectId: "default-project",
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
        projectId: "default-project",
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
        projectId: "default-project",
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
        projectId: "default-project",
        folderId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedFolderId: "all",
  });

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
      work("storySkeletonReview", "故事骨架审核：通过，事件因果完整。", chapterId, now),
      work("adaptationStrategy", "改编策略：压缩背景，强化动作和悬念。", chapterId, now),
      work("adaptationStrategyReview", "改编策略审核：通过，3 分钟节奏可执行。", chapterId, now),
      work("scriptDraft", "## S01\n独孤剑尘睁眼，尘土和铁链声压下来。", chapterId, now),
      work("scriptDraftReview", "剧本审核：通过，镜头动作和台词齐全。", chapterId, now),
      work("storyboardTable", "|镜头|画面|台词|\n|1|水墨矿场醒来|他在尘土里醒来。|", chapterId, now),
      work("productionPlan", `本地成片输出: ${videoPath}`, "episode-1", now),
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
        mediaRef: { kind: "image", path: framePath },
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

async function inspectWorkflow(): Promise<WorkflowSmokeInspection> {
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
    source: "isolated-smoke-project",
    progress: readiness.progress,
    nextStageId: readiness.nextStageId,
    nextActionLabel: readiness.nextActionLabel,
    stages: readiness.stages,
    evidence: [...stepwiseEvidence],
    checks: {
      manualsReady: readiness.stages[0]?.status === "ready",
      novelReady: readiness.stages[1]?.status === "ready",
      scriptReady: readiness.stages[2]?.status === "ready",
      assetsReady: readiness.stages[3]?.status === "ready",
      generationReady: readiness.stages[3]?.status === "ready",
      storyboardReady: readiness.stages[4]?.status === "ready",
      workbenchReady: readiness.stages[5]?.status === "ready",
      hasFinalExport: studio.agentWorkData.some((item) => item.key === "productionPlan" && item.data.includes("本地成片输出:")),
      hasSelectedCandidate: studio.productionTracks.some((track) => Boolean(track.selectedVideoId)),
      hasVoiceBinding: Object.keys(project?.bindings ?? {}).some((speakerId) => speakerId.startsWith("character:")),
      hasVoiceAudio: Object.values(project?.voiceLines ?? {}).some((line) => line.status === "completed" && Boolean(line.audioLocalPath || line.audioFilePath)),
    },
  };
}

async function recordStageEvidence(stageId: string): Promise<WorkflowSmokeStageResult> {
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

function stageEvidenceText(stageId: string) {
  const studio = useStudioStore.getState();
  const tts = useTtsStore.getState();
  const project = tts.projects[tts.activeProjectId ?? SMOKE_PROJECT_ID];
  if (stageId === "manuals") {
    return `visualManualId=${studio.workflowConfig.visualManualId}; directorManualId=${studio.workflowConfig.directorManualId}`;
  }
  if (stageId === "novel") {
    return `chapters=${studio.novelChapters.length}; analyzed=${studio.novelChapters.filter((chapter) => chapter.eventTaskState === "success").length}`;
  }
  if (stageId === "script") {
    return [
      `storySkeleton=${countWork(studio.agentWorkData, "storySkeleton")}`,
      `storySkeletonReview=${countWork(studio.agentWorkData, "storySkeletonReview")}`,
      `adaptationStrategy=${countWork(studio.agentWorkData, "adaptationStrategy")}`,
      `adaptationStrategyReview=${countWork(studio.agentWorkData, "adaptationStrategyReview")}`,
      `scriptDraft=${countWork(studio.agentWorkData, "scriptDraft")}`,
      `scriptDraftReview=${countWork(studio.agentWorkData, "scriptDraftReview")}`,
    ].join("; ");
  }
  if (stageId === "assets") {
    const batch = studio.entityExtractions[0];
    return `entityExtraction=characters:${batch?.characters.length ?? 0}, scenes:${batch?.scenes.length ?? 0}, props:${batch?.props.length ?? 0}`;
  }
  if (stageId === "storyboard") {
    return `directorPlan=${studio.scriptPlans.length}; storyboards=${studio.storyboards.length}; imageRefs=${studio.storyboards.filter((item) => item.mediaRef?.path).length}; voiceBindings=${Object.keys(project?.bindings ?? {}).length}; voiceLines=${Object.keys(project?.voiceLines ?? {}).length}`;
  }
  if (stageId === "workbench") {
    return `tracks=${studio.productionTracks.length}; selectedCandidates=${studio.productionTracks.filter((track) => track.selectedVideoId).length}; finalExport=${studio.agentWorkData.some((item) => item.key === "productionPlan" && item.data.includes("本地成片输出:"))}`;
  }
  return `stage=${stageId}`;
}

function countWork(items: AgentWorkData[], key: AgentWorkKey) {
  return items.filter((item) => item.key === key && item.data.trim()).length;
}

function upsertWorks(items: AgentWorkData[], updates: AgentWorkData[]) {
  const next = [...items];
  for (const update of updates) {
    const existingIndex = next.findIndex(
      (item) => item.key === update.key && item.episodeId === update.episodeId,
    );
    if (existingIndex >= 0) next[existingIndex] = update;
    else next.push(update);
  }
  return next;
}

function bindSmokeVoice(now: number) {
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
      referenceAudioPath: SMOKE_AUDIO_PATH,
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
      audioLocalPath: SMOKE_AUDIO_PATH,
      audioFilePath: SMOKE_AUDIO_PATH,
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
