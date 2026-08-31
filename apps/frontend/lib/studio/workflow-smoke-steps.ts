import { resetSmokeEditingStore, seedSmokeEditingEvidence } from "./workflow-smoke-editing-evidence";
import { upsertRuns, upsertWorks } from "./workflow-smoke-helpers";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useTtsStore } from "@/stores/tts/tts-store";
import { bindSmokeVoice, inspectWorkflow, recordStageEvidence, run, waitForPersist, work } from "./workflow-smoke-core";
import { stepwiseEvidence } from "./workflow-smoke-evidence";
import { SMOKE_CHAPTER_ID, SMOKE_EDITING_PROJECT_ID, SMOKE_PROJECT_ID, SMOKE_PROP_ID, SMOKE_ROLE_ID, SMOKE_SCENE_ID, SMOKE_STORYBOARD_ID, SMOKE_TRACK_ID, SMOKE_VIDEO_ID, WorkflowSmokeInspection, WorkflowSmokeStageResult, getSmokeAudioPath, getSmokeFrameGraphPath, getSmokeVideoPath } from "./workflow-smoke-shared";

/**
 * smoke 桥步骤族——重置与 manuals/novel/script/assets/storyboard/workbench 六步种子。file-size-reduction 专批拆出,体逐字保留。
 */
export async function resetForStepwiseExecution(): Promise<WorkflowSmokeInspection> {
  stepwiseEvidence.length = 0;
  const studio = useStudioStore.getState();
  studio.resetStudioWorkflow();
  studio.setWorkflowConfig({ workflowStage: "manuals" });
  useCharacterLibraryStore.setState({ characters: [] });
  useSceneStore.setState({ scenes: [] });
  usePropsLibraryStore.setState({ items: [], selectedFolderId: "all" });
  resetSmokeEditingStore(SMOKE_PROJECT_ID);
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

export async function runStepwiseWorkflowStage(
  stage: string,
): Promise<WorkflowSmokeStageResult> {
  const now = Date.now();
  if (stage === "manuals") applyManualsStep();
  if (stage === "novel") applyNovelStep(now);
  if (stage === "script") applyScriptStep(now);
  if (stage === "assets") await applyAssetsStep(now);
  if (stage === "storyboard") await applyStoryboardStep(now);
  if (stage === "workbench") await applyWorkbenchStep(now);
  await waitForPersist();
  return recordStageEvidence(stage);
}

export function applyManualsStep() {
  useStudioStore.getState().setWorkflowConfig({
    visualManualId: "2D_chinese_guofeng",
    directorManualId: "Xianxia_fantasy",
    episodeDurationMin: 3,
    episodeCount: 1,
    platformSpec: "9:16",
    workflowStage: "manuals",
  });
}

export function applyNovelStep(now: number) {
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
    agentRuns: [run("eventAnalysis", "script", "smoke-event-analysis", now)],
  });
}

export function applyScriptStep(now: number) {
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
    agentRuns: upsertRuns(state.agentRuns, [
      run("storySkeleton", "script", "smoke-storySkeleton", now),
      run("adaptationStrategy", "script", "smoke-adaptationStrategy", now),
      run("scriptDraft", "script", "smoke-scriptDraft", now),
    ]),
  }));
}

export async function applyAssetsStep(now: number) {
  await applyScriptStep(now);
  const framePath = await getSmokeFrameGraphPath();
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
    agentRuns: [
      ...useStudioStore.getState().agentRuns.filter((item) => item.key !== "entityExtraction"),
      run("entityExtraction", "assets", "smoke-entity-1", now),
    ],
  });
}

export async function applyStoryboardStep(now: number) {
  await applyAssetsStep(now);
  const framePath = await getSmokeFrameGraphPath();
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
    agentRuns: upsertRuns(state.agentRuns, [
      run("directorPlan", "scriptPlan", "smoke-plan-1", now),
      run("storyboardTable", "storyboardTable", "smoke-storyboard-1", now),
      run("storyboardImage", "storyboard", "smoke-storyboard-flow-1", now),
      run("voiceAssign", "workbench", "smoke-voice-profile", now),
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
        prompt: "@图1 为独孤剑尘角色参考，@图2 为矿场场景参考。【画面】@图1 在 @图2 睁眼，铁链震动。",
        videoDesc: "旁白：他在尘土里醒来。",
        assetIds: [SMOKE_ROLE_ID, SMOKE_SCENE_ID],
        mediaRef: {
          kind: "image",
          path: framePath,
          imageWorkflowId: "smoke-storyboard-flow-1",
          imageWorkflowNodeId: "smoke-generated-1",
        },
        imageWorkflowId: "smoke-storyboard-flow-1",
        imageWorkflowNodeId: "smoke-generated-1",
        shouldGenerateImage: true,
        audioRef: { kind: "audio", path: getSmokeAudioPath() },
        state: "ready",
        lines: "旁白：他在尘土里醒来。",
        speakerId: "narrator",
        sourceEvidence: {
          source: "smoke-seed",
          sourceProjectId: SMOKE_PROJECT_ID,
          sourceEpisodeId: SMOKE_CHAPTER_ID,
          sourceStoryboardId: SMOKE_STORYBOARD_ID,
        },
        orderedReferenceManifest: [
          {
            order: 1,
            assetId: SMOKE_ROLE_ID,
            assetName: "独孤剑尘",
            assetKind: "character",
            imagePath: framePath,
            source: "smoke-project-character",
          },
          {
            order: 2,
            assetId: SMOKE_SCENE_ID,
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

export async function applyWorkbenchStep(now: number) {
  await applyStoryboardStep(now);
  const videoPath = getSmokeVideoPath();
  useStudioStore.setState((state) => ({
    agentWorkData: upsertWorks(state.agentWorkData, [
      work("productionPlan", `本地成片输出: ${videoPath}`, SMOKE_CHAPTER_ID, now),
    ]),
    agentRuns: upsertRuns(state.agentRuns, [
      run("productionPlan", "workbench", videoPath, now),
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
        filePath: videoPath,
        state: "ready",
        createdAt: now,
      },
    ],
  }));
  seedSmokeEditingEvidence({
    projectId: SMOKE_PROJECT_ID,
    editingProjectId: SMOKE_EDITING_PROJECT_ID,
    episodeId: SMOKE_CHAPTER_ID,
    storyboardId: SMOKE_STORYBOARD_ID,
    trackId: SMOKE_TRACK_ID,
    videoId: SMOKE_VIDEO_ID,
    videoPath,
    now,
  });
}

