// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Fixture builders for artifact projection tests
 * Generate synthetic but realistic store states for testing projections
 */

import type { StudioWorkflowState } from "@/stores/studio/studio-store";
import type { ScriptData } from "@/types/script";
import type { DirectorState } from "@/stores/director/director-store-types";
import type { EditingStore } from "@/stores/editing/editing-store";
import type { TtsStore } from "@/stores/tts/tts-store";
 
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";
 
 
import { useMediaStore } from "@/stores/media/media-store";
type MediaStore = ReturnType<typeof useMediaStore.getState>;
import type { Episode } from "@/types/script";

const PROJECT_ID = "test-project-123";
const CHAPTER_ID_001 = "chapter-001";
const CHAPTER_ID_002 = "chapter-002";

/**
 * Generate derived asset IDs dynamically based on asset type, chapter index, and name
 * This replaces hardcoded Python-fixture IDs (var-chapter-001-*, scene-derived-chapter-001-*, prop-derived-chapter-001-*)
 * which are fixture/runtime data, not product type contracts
 */
export function generateDerivedAssetId(assetType: string, chapterIndex: number | string, name: string): string {
  // Normalize asset type to lowercase for consistency
  const normalizedType = assetType.toLowerCase().replace(/[-\s]/g, "");
  // Use chapter index directly (already a number from parseInt, or string like "001")
  const chapterIndexStr = typeof chapterIndex === "number" ? chapterIndex.toString().padStart(3, "0") : chapterIndex;
  // Normalize name: remove spaces/special chars, lowercase
  const normalizedName = name.toLowerCase().replace(/[\s_-]/g, "");

  return `${normalizedType}-derived-${chapterIndexStr}-${normalizedName}`;
}

export function createEmptyStores(): {
  studio: StudioWorkflowState;
  script: ScriptData;
  director: DirectorState;
  editing: EditingStore;
  tts: TtsStore;
  media: MediaStore;
  remotion: RemotionRenderJobV1[];
} {
  return {
    studio: {
      materials: [],
      sourceBible: "",
      
      novelChapters: [],
      agentWorkData: [],
      entityExtractions: [],
      scriptPlans: [],
      seriesBible: null,
      episodeOutlines: [],
      storyboards: [],
      continuityAssetVersions: [],
      productionTracks: [],
      videoCandidates: [],
      sceneSegments: [],
      imageWorkflows: [],
      agentRuns: [],
      mediaTasks: [],
      eventGraph: [],
      projectMemoryRecords: [],
      workflowConfig: {} },
    script: {
      title: "Test Script",
      language: "zh",
      characters: [],
      scenes: [],
      episodes: [],
      storyParagraphs: [] },
    director: ({
      activeProjectId: null,
      projects: {},
      sceneProgress: new Map(),
      config: {
        styleTokens: ["anime style"],
        qualityTokens: [],
        negativePrompt: "",
        aspectRatio: '16:9',
        imageSize: '2K',
        videoSize: '1080p',
        sceneCount: 0,
        concurrency: 3,
        imageProvider: 'mock',
        videoProvider: 'mock',
        chatProvider: 'mock' },
      isExpanded: false,
      selectedSceneId: null,
      setActiveProjectId: () => {},
      ensureProject: () => {},
      getProjectData: () => ({
        storyboardImage: null,
        storyboardImageMediaId: null,
        storyboardStatus: 'idle',
        storyboardError: null,
        splitScenes: [],
        projectFolderId: null,
        storyboardConfig: {
          aspectRatio: '16:9',
          resolution: '2K',
          videoResolution: '1080p',
          sceneCount: 0,
          storyPrompt: '' },
        screenplay: null,
        screenplayStatus: 'idle',
        screenplayError: null,
        trailerConfig: { duration: 30, shotIds: [], status: 'idle' },
        trailerScenes: [],
        screenplayDraft: { prompt: '', selectedCharacterIds: [], updatedAt: Date.now() },
        editorPrefs: {
          imageGenMode: 'single',
          frameMode: 'first',
          refStrategy: 'cluster',
          useExemplar: true,
          activeTab: 'editing',
          episodeViewScope: 'all' } }),
      setScreenplay: () => {},
      setScreenplayStatus: () => {},
      setScreenplayError: () => {},
      updateScene: () => {},
      deleteScene: () => {},
      deleteAllScenes: () => {},
      updateSceneProgress: () => {},
      setSceneProgress: () => {},
      clearSceneProgress: () => {},
      updateConfig: () => {},
      setExpanded: () => {},
      setSelectedScene: () => {},
      setStoryboardImage: () => {},
      setStoryboardStatus: () => {},
      setStoryboardError: () => {},
      setProjectFolderId: () => {},
      setSplitScenes: () => {},
      updateSplitSceneImagePrompt: () => {},
      updateSplitSceneVideoPrompt: () => {},
      updateSplitSceneEndFramePrompt: () => {},
      updateSplitSceneNeedsEndFrame: () => {},
      updateSplitScenePrompt: () => {},
      updateSplitSceneImage: () => {},
      updateSplitSceneImageStatus: () => {},
      updateSplitSceneVideo: () => {},
      updateSplitSceneEndFrame: () => {},
      updateSplitSceneEndFrameStatus: () => {},
      updateSplitSceneCharacters: () => {},
      updateSplitSceneCharacterVariationMap: () => {},
      updateSplitSceneEmotions: () => {},
      updateSplitSceneShotSize: () => {},
      updateSplitSceneDuration: () => {},
      updateSplitSceneAmbientSound: () => {},
      updateSplitSceneSoundEffects: () => {},
      updateSplitSceneReference: () => {},
      updateSplitSceneEndFrameReference: () => {},
      updateSplitSceneField: () => {},
      addAngleSwitchHistory: () => {},
      deleteSplitScene: () => {},
      addBlankSplitScene: () => {},
      setStoryboardConfig: () => {},
      setScreenplayDraft: () => {},
      clearScreenplayDraft: () => {},
      setEditorPrefs: () => {},
      resetStoryboard: () => {},
      addScenesFromScript: () => {},
      startScreenplayGeneration: () => {},
      startImageGeneration: () => {},
      startVideoGeneration: () => {},
      retrySceneImage: () => {},
      retryScene: () => {},
      cancelAll: () => {},
      reset: () => {},
      onScreenplayGenerated: () => {},
      onSceneProgressUpdate: () => {},
      onSceneImageCompleted: () => {},
      onSceneCompleted: () => {},
      onSceneFailed: () => {},
      onAllImagesCompleted: () => {},
      onAllCompleted: () => {},
      setTrailerDuration: () => {},
      setTrailerScenes: () => {},
      setTrailerConfig: () => {},
      clearTrailer: () => {},
      setCinematographyProfileId: () => {},
      cascadeFramesToNextScene: () => {} } as unknown as DirectorState),
    editing: {
      activeProjectId: null,
      editingProjects: {},
      currentEditingProjectIdByEpisode: {},
      autoEditingRuns: {},
      autoEditingRunIdsByEpisode: {},
      timelineRenderRecordsByEditingProjectId: {},
      historyByEditingProjectId: {},
      persistenceWarnings: [],
      setActiveProjectId: () => {},
      saveEditingProject: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
      saveAutoEditingRun: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
      saveTimelineRenderRecord: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
      commitAutoEditingResult: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
      activateEditingProject: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
      getCurrentEditingProject: () => undefined,
      executeCommand: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
      undo: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
      redo: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }) },
    tts: {
      activeProjectId: null,
      projects: {},
      voiceProfiles: {},
      setActiveProjectId: () => {},
      ensureProject: () => {},
      createVoiceProfile: () => ({
        id: `profile-test-${Date.now()}`,
        name: 'Test Profile',
        type: 'preset' as const,
        language: 'en',
        defaultEngine: 'kokoro' as const,
        createdAt: Date.now(),
        updatedAt: Date.now() }),
      updateVoiceProfile: () => {},
      bindSpeaker: () => {},
      getBinding: () => undefined,
      ensureSceneVoiceLine: () => undefined,
      upsertSceneVoiceLine: () => {},
      getSceneVoiceLine: () => undefined,
      selectBatchSceneIds: (ids) => ids,
      markGenerating: () => {},
      markCompleted: () => {},
      markFailed: () => {},
      clearSceneAudio: () => {} },
    media: {
      mediaFiles: [],
      folders: [],
      currentFolderId: null,
      isLoading: false,
      addMediaFile: async () => ({
        id: `media-test-${Date.now()}`,
        projectId: 'test-project',
        name: 'test.png',
        type: 'image',
        url: undefined,
        thumbnailUrl: undefined,
        duration: undefined,
        width: undefined,
        height: undefined,
        fps: undefined,
        ephemeral: undefined,
        folderId: null,
        source: undefined,
        file: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now() }),
      removeMediaFile: async () => {},
      loadProjectMedia: async () => {},
      clearProjectMedia: async () => {},
      clearAllMedia: () => {},
      addFolder: () => 'folder-id',
      renameFolder: () => {},
      deleteFolder: () => {},
      setCurrentFolder: () => {},
      renameMediaFile: () => {},
      moveToFolder: async () => {},
      addMediaFromUrl: () => 'url-id',
      getOrCreateCategoryFolder: () => 'category-folder-id',
      initSystemFolders: () => {},
      assignProjectToUnscoped: () => {} },
    remotion: [] };
}

/**
 * Build a complete single-chapter fixture
 */
export function buildSingleChapterFixture(chapterId: string = CHAPTER_ID_001): {
  studio: StudioWorkflowState;
  script: ScriptData;
  director: DirectorState;
  editing: EditingStore;
  tts: TtsStore;
  media: MediaStore;
  remotion: RemotionRenderJobV1[];
  projectId: string;
  chapterId: string;
} {
  const now = Date.now();
  const parsedChapterIndex = parseInt(chapterId.replace("chapter-", ""), 10);
  const chapterIndex = Number.isFinite(parsedChapterIndex) ? parsedChapterIndex : 1;

  const studio: StudioWorkflowState = {
    materials: [
      {
        id: `material-${chapterId}-1`,
        name: "character-reference.jpg",
        kind: "image",
        localPath: `workflow-images/characters/main-${chapterId}.jpg`,
        sourceName: "uploaded",
        size: 102400,
        importedAt: now - 1000000,
        imageWorkflowId: undefined,
        imageWorkflowNodeId: undefined },
    ],
    sourceBible: "",
    
    novelChapters: [
      {
        id: `novel-${chapterId}`,
        index: chapterIndex,
        title: `Chapter ${chapterIndex}: The Beginning`,
        sourceText: "Once upon a time...",
        importedAt: now - 2000000,
        updatedAt: now - 1000000 },
    ],
    agentWorkData: [
      {
        id: `agent-${chapterId}-event-analysis`,
        key: "eventAnalysis",
        episodeId: chapterId,
        data: JSON.stringify({ coreEvent: "Hero meets villain" }),
        createdAt: now - 1500000,
        updatedAt: now - 1500000 },
      {
        id: `agent-${chapterId}-entity-extraction`,
        key: "entityExtraction",
        episodeId: chapterId,
        data: JSON.stringify({ characters: ["hero", "villain"] }),
        createdAt: now - 1400000,
        updatedAt: now - 1400000 },
    ],
    entityExtractions: [
      {
        id: `extraction-${chapterId}`,
        episodeId: chapterId,
        characters: [{ characterId: "hero-001", name: "Hero", aliases: ["the hero"], note: "Main protagonist" }],
        scenes: [{ sceneId: "scene-001", name: "Forest clearing", note: "Opening scene" }],
        props: [] },
    ],
    scriptPlans: [],
    seriesBible: null,
    episodeOutlines: [],
    storyboards: Array.from({ length: 5 }, (_, i) => ({
      id: `sb-${chapterId}-${i}`,
      episodeId: chapterId,
      index: i,
      trackKey: `${chapterIndex}-${i}`, // Dynamic runtime key: chapter-{index}-{scene}
      trackId: `track-${chapterId}`,
      duration: 5000,
      prompt: `Scene ${i} description`,
      videoDesc: `Video desc for scene ${i}`,
      assetIds: [generateDerivedAssetId("character", chapterIndex, "main-hero")],
      state: "ready",
      createdAt: now - 500000,
      updatedAt: now - 500000 })),
    continuityAssetVersions: [
      {
        assetId: generateDerivedAssetId("character", chapterIndex, "dugu-grey-town"),
        versionId: `version-${chapterId}-character-dugu-grey`,
        assetKind: "character",
        label: `Dugu - Grey Town Outfit (${chapterId})`,
        referenceImagePaths: [`continuity-bibles/characters/${generateDerivedAssetId("character", chapterIndex, "dugu-grey-town")}.jpg`],
        referenceImageSha256: undefined,
        reviewEvidencePaths: undefined,
        reviewEvidenceSha256: undefined,
        reviewEvidenceVerifiedAt: now - 100000,
        referenceViewTypes: ["front", "side", "back"],
        identityAnchors: { uniqueMarks: [] },
        negativePrompt: { avoid: [] },
        wardrobeVersion: "wardrobe-v1",
        sceneViewpointId: undefined,
        spatialLayout: "",
        lightingDesign: "",
        colorPalette: "",
        missingFields: [],
        structurallyComplete: true,
        contentFingerprint: "abc123",
        approval: undefined,
        approvalFingerprint: undefined,
        approved: true,
        source: "human-approved",
        validFromStoryboardIndex: undefined,
        validToStoryboardIndex: undefined },
    ],
    productionTracks: [
      {
        id: `track-${chapterId}`,
        episodeId: chapterId,
        trackKey: `${chapterIndex}`, // Index-derived runtime key matching storyboard trackKeys
        storyboardIds: [`sb-${chapterId}-0`, `sb-${chapterId}-1`],
        prompt: "Track prompt",
        duration: 10000,
        candidateVideoIds: [`video-candidate-${chapterId}-1`, `video-candidate-${chapterId}-2`],
        selectedVideoId: `video-candidate-${chapterId}-1`,
        state: "ready" },
    ],
    videoCandidates: [
      {
        id: `video-candidate-${chapterId}-1`,
        trackId: `track-${chapterId}`,
        provider: "ffmpeg-local",
        filePath: `exports/${chapterId}/final-video.mp4`,
        state: "ready",
        createdAt: now - 400000 },
      {
        id: `video-candidate-${chapterId}-2`,
        trackId: `track-${chapterId}`,
        provider: "model-placeholder",
        state: "failed",
        errorReason: "Model timeout",
        createdAt: now - 450000 },
    ],
    sceneSegments: [],
    imageWorkflows: [],
    agentRuns: [],
    mediaTasks: [],
    eventGraph: [
      {
        id: `event-${chapterId}-1`,
        projectId: PROJECT_ID,
        episodeId: chapterId,
        chapterIndex,
        chapterTitle: `Chapter ${chapterIndex}`,
        entities: ["hero", "villain"],
        coreEvent: "First encounter",
        mainlineRelation: "conflict",
        informationDensity: "high",
        estimatedDurationSec: 30,
        emotionTags: ["tension", "drama"],
        timelineOrder: 1,
        retrievalText: "hero meets villain",
        source: "novelEventAnalysis",
        createdAt: now - 1500000,
        updatedAt: now - 1500000 },
    ],
    projectMemoryRecords: [],
    workflowConfig: {} };

  const script: ScriptData = {
    title: "Test Script",
    language: "zh",
    characters: [],
    scenes: [],
    episodes: [
      {
        id: chapterId,
        index: chapterIndex,
        title: `Episode ${chapterIndex}`,
        sceneIds: [`scene-${chapterId}-1`, `scene-${chapterId}-2`] },
    ],
    storyParagraphs: [] };

  const director: DirectorState = ({
    activeProjectId: null,
    projects: {},
    sceneProgress: new Map(),
    config: {
      styleTokens: ["anime style"],
      qualityTokens: [],
      negativePrompt: "",
      aspectRatio: '16:9',
      imageSize: '2K',
      videoSize: '1080p',
      sceneCount: 2,
      concurrency: 3,
      imageProvider: 'mock',
      videoProvider: 'mock',
      chatProvider: 'mock' },
    isExpanded: false,
    selectedSceneId: null,
    setActiveProjectId: () => {},
    ensureProject: () => {},
    getProjectData: () => ({
      storyboardImage: null,
      storyboardImageMediaId: null,
      storyboardStatus: 'ready',
      storyboardError: null,
      splitScenes: [
        {
          id: `director-sb-${chapterId}-1`,
          sceneName: 'Test Scene',
          sceneLocation: 'Test Location',
          imageDataUrl: '',
          imageHttpUrl: null,
          width: 1920,
          height: 1080,
          imagePrompt: 'Test prompt',
          imagePromptZh: '测试提示词',
          imageStatus: 'completed',
          imageProgress: 100,
          imageError: null,
          needsEndFrame: false,
          endFrameImageUrl: null,
          endFrameHttpUrl: null,
          endFrameSource: null,
          endFramePrompt: '',
          endFramePromptZh: '',
          endFrameStatus: 'idle',
          endFrameProgress: 0,
          endFrameError: null,
          videoPrompt: '',
          videoPromptZh: '',
          videoStatus: 'idle',
          videoProgress: 0,
          videoUrl: null,
          videoError: null,
          videoMediaId: null,
          characterIds: [],
          emotionTags: [],
          dialogue: '',
          actionSummary: '',
          cameraMovement: '',
          soundEffectText: '',
          shotSize: null,
          duration: 4,
          ambientSound: '',
          soundEffects: [],
          audioAmbientEnabled: true,
          audioSfxEnabled: true,
          audioDialogueEnabled: true,
          audioBgmEnabled: false,
          row: 0,
          col: 0,
          sourceRect: { x: 0, y: 0, width: 100, height: 100 },
          sourceEpisodeIndex: chapterIndex,
          sourceEpisodeId: chapterId },
      ],
      projectFolderId: null,
      storyboardConfig: {
        aspectRatio: '16:9',
        resolution: '2K',
        videoResolution: '1080p',
        sceneCount: 1,
        storyPrompt: 'Test story' },
      screenplay: null,
      screenplayStatus: 'idle',
      screenplayError: null,
      trailerConfig: { duration: 30, shotIds: [], status: 'idle' },
      trailerScenes: [],
      screenplayDraft: { prompt: '', selectedCharacterIds: [], updatedAt: Date.now() },
      editorPrefs: {
        imageGenMode: 'single',
        frameMode: 'first',
        refStrategy: 'cluster',
        useExemplar: true,
        activeTab: 'editing',
        episodeViewScope: 'all' } }),
    setScreenplay: () => {},
    setScreenplayStatus: () => {},
    setScreenplayError: () => {},
    updateScene: () => {},
    deleteScene: () => {},
    deleteAllScenes: () => {},
    updateSceneProgress: () => {},
    setSceneProgress: () => {},
    clearSceneProgress: () => {},
    updateConfig: () => {},
    setExpanded: () => {},
    setSelectedScene: () => {},
    setStoryboardImage: () => {},
    setStoryboardStatus: () => {},
    setStoryboardError: () => {},
    setProjectFolderId: () => {},
    setSplitScenes: () => {},
    updateSplitSceneImagePrompt: () => {},
    updateSplitSceneVideoPrompt: () => {},
    updateSplitSceneEndFramePrompt: () => {},
    updateSplitSceneNeedsEndFrame: () => {},
    updateSplitScenePrompt: () => {},
    updateSplitSceneImage: () => {},
    updateSplitSceneImageStatus: () => {},
    updateSplitSceneVideo: () => {},
    updateSplitSceneEndFrame: () => {},
    updateSplitSceneEndFrameStatus: () => {},
    updateSplitSceneCharacters: () => {},
    updateSplitSceneCharacterVariationMap: () => {},
    updateSplitSceneEmotions: () => {},
    updateSplitSceneShotSize: () => {},
    updateSplitSceneDuration: () => {},
    updateSplitSceneAmbientSound: () => {},
    updateSplitSceneSoundEffects: () => {},
    updateSplitSceneReference: () => {},
    updateSplitSceneEndFrameReference: () => {},
    updateSplitSceneField: () => {},
    addAngleSwitchHistory: () => {},
    deleteSplitScene: () => {},
    addBlankSplitScene: () => {},
    setStoryboardConfig: () => {},
    setScreenplayDraft: () => {},
    clearScreenplayDraft: () => {},
    setEditorPrefs: () => {},
    resetStoryboard: () => {},
    addScenesFromScript: () => {},
    startScreenplayGeneration: () => {},
    startImageGeneration: () => {},
    startVideoGeneration: () => {},
    retrySceneImage: () => {},
    retryScene: () => {},
    cancelAll: () => {},
    reset: () => {},
    onScreenplayGenerated: () => {},
    onSceneProgressUpdate: () => {},
    onSceneImageCompleted: () => {},
    onSceneCompleted: () => {},
    onSceneFailed: () => {},
    onAllImagesCompleted: () => {},
    onAllCompleted: () => {},
    setTrailerDuration: () => {},
    setTrailerScenes: () => {},
    setTrailerConfig: () => {},
    clearTrailer: () => {},
    setCinematographyProfileId: () => {},
    cascadeFramesToNextScene: () => {} } as unknown as DirectorState);

  const editing: EditingStore = ({
    activeProjectId: PROJECT_ID,
    editingProjects: {
      [`editing-project-${chapterId}`]: {
        id: `editing-project-${chapterId}`,
        projectId: PROJECT_ID,
        episodeId: chapterId,
        name: `Project ${chapterId}`,
        createdBy: 'manual',
        manuallyEdited: false,
        generatedByRunId: undefined,
        updatedAt: now - 300000,
        createdAt: now - 300000,
        timeline: [],
        metadata: {} } },
    currentEditingProjectIdByEpisode: { [chapterId]: `editing-project-${chapterId}` },
    autoEditingRuns: {},
    autoEditingRunIdsByEpisode: {},
    timelineRenderRecordsByEditingProjectId: {
      [`editing-render-${chapterId}`]: {
        id: `editing-render-${chapterId}`,
        projectId: PROJECT_ID,
        episodeId: chapterId,
        startedAt: now - 150000,
        completedAt: now - 100000,
        outputPath: `exports/${chapterId}/render.mp4`,
        frameCount: 300,
        frameRate: 30 } },
    historyByEditingProjectId: {},
    persistenceWarnings: [],
    setActiveProjectId: () => {},
    saveEditingProject: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
    saveAutoEditingRun: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
    saveTimelineRenderRecord: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
    commitAutoEditingResult: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
    activateEditingProject: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
    getCurrentEditingProject: () => undefined,
    executeCommand: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
    undo: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }),
    redo: () => ({ success: false, issue: { code: 'test', path: '$', message: 'test' } }) } as unknown as EditingStore);

  const tts: TtsStore = {
    activeProjectId: PROJECT_ID,
    projects: {
      [PROJECT_ID]: {
        voiceLines: {
          [`tts-line-${chapterId}-1`]: {
            sceneId: 1,
            text: "Test dialogue 1",
            speakerId: "narrator",
            profileId: "profile-1",
            engine: "kokoro" as const,
            modelSize: "small",
            status: "completed" as const,
            generationId: undefined,
            audioLocalPath: `exports/${chapterId}/tts-1.mp3`,
            audioFilePath: undefined,
            audioMaterialId: undefined,
            ttsBackend: undefined,
            mocked: false,
            warning: undefined,
            error: undefined,
            updatedAt: now - 600000 },
          [`tts-line-${chapterId}-2`]: {
            sceneId: 2,
            text: "Test dialogue 2",
            speakerId: "character:speaker-2",
            profileId: "profile-2",
            engine: "kokoro" as const,
            modelSize: "small",
            status: "completed" as const,
            generationId: undefined,
            audioLocalPath: `exports/${chapterId}/tts-2.mp3`,
            audioFilePath: undefined,
            audioMaterialId: undefined,
            ttsBackend: undefined,
            mocked: false,
            warning: undefined,
            error: undefined,
            updatedAt: now - 550000 } },
        bindings: {} } },
    voiceProfiles: {
      "profile-1": {
        id: "profile-1",
        name: "Hero Voice",
        type: 'preset' as const,
        language: 'en',
        defaultEngine: 'kokoro' as const,
        createdAt: now - 700000,
        updatedAt: now - 700000 },
      "profile-2": {
        id: "profile-2",
        name: "Villain Voice",
        type: 'preset' as const,
        language: 'en',
        defaultEngine: 'kokoro' as const,
        createdAt: now - 650000,
        updatedAt: now - 650000 } },
    setActiveProjectId: () => {},
    ensureProject: () => {},
    createVoiceProfile: () => ({
      id: `profile-test-${Date.now()}`,
      name: 'Test Profile',
      type: 'preset' as const,
      language: 'en',
      defaultEngine: 'kokoro' as const,
      createdAt: Date.now(),
      updatedAt: Date.now() }),
    updateVoiceProfile: () => {},
    bindSpeaker: () => {},
    getBinding: () => undefined,
    ensureSceneVoiceLine: () => undefined,
    upsertSceneVoiceLine: () => {},
    getSceneVoiceLine: () => undefined,
    selectBatchSceneIds: (ids) => ids,
    markGenerating: () => {},
    markCompleted: () => {},
    markFailed: () => {},
    clearSceneAudio: () => {} };

  const media: MediaStore = ({
    mediaFiles: [
      {
        id: `media-${chapterId}-1`,
        projectId: PROJECT_ID,
        name: `generated-${chapterId}-1.png`,
        localPath: `workflow-images/generated/${chapterId}-1.png`,
        size: 204800,
        type: "image",
        mimeType: "image/png",
        createdAt: now - 700000,
        updatedAt: now - 700000,
        folderId: null,
        url: undefined,
        thumbnailUrl: undefined,
        duration: undefined,
        width: undefined,
        height: undefined,
        fps: undefined,
        ephemeral: undefined,
        source: undefined,
        file: undefined },
    ],
    folders: [],
    currentFolderId: null,
    isLoading: false,
    addMediaFile: async () => ({
      id: `media-test-${Date.now()}`,
      projectId: 'test-project',
      name: 'test.png',
      type: 'image',
      url: undefined,
      thumbnailUrl: undefined,
      duration: undefined,
      width: undefined,
      height: undefined,
      fps: undefined,
      ephemeral: undefined,
      folderId: null,
      source: undefined,
      file: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now() }),
    removeMediaFile: async () => {},
    loadProjectMedia: async () => {},
    clearProjectMedia: async () => {},
    clearAllMedia: () => {},
    addFolder: () => 'folder-id',
    renameFolder: () => {},
    deleteFolder: () => {},
    setCurrentFolder: () => {},
    renameMediaFile: () => {},
    moveToFolder: async () => {},
    addMediaFromUrl: () => 'url-id',
    getOrCreateCategoryFolder: () => 'category-folder-id',
    initSystemFolders: () => {},
    assignProjectToUnscoped: () => {} } as unknown as MediaStore);

  const remotion: RemotionRenderJobV1[] = ([
    {
      id: `remotion-job-${chapterId}-1`,
      schemaVersion: 1,
      jobId: `job-${chapterId}-1`,
      projectId: PROJECT_ID,
      templateVersion: "v1",
      remotionVersion: "4.0.0",
      status: "succeeded",
      attempt: 1,
      progress: 1,
      createdAt: now - 750000,
      startedAt: now - 750000,
      completedAt: now - 700000,
      error: undefined,
      outputPath: `exports/${chapterId}/remotion-output.mp4`,
      evidencePath: `exports/${chapterId}/evidence` },
  ] as unknown as RemotionRenderJobV1[]);

  return {
    studio,
    script,
    director,
    editing,
    tts,
    media,
    remotion,
    projectId: PROJECT_ID,
    chapterId };
}

/**
 * Build multi-chapter fixture with cross-chapter references
 */
export function buildMultiChapterFixture(): {
  chapter1: ReturnType<typeof buildSingleChapterFixture>;
  chapter2: ReturnType<typeof buildSingleChapterFixture>;
  sharedAssets: Array<{ id: string; chapterIds: string[] }>;
} {
  const chapter1 = buildSingleChapterFixture(CHAPTER_ID_001);
  const chapter2 = buildSingleChapterFixture(CHAPTER_ID_002);

  // Shared character asset referenced by both chapters
  const sharedCharacter = {
    id: "shared-character-hero",
    chapterIds: [CHAPTER_ID_001, CHAPTER_ID_002] };

  return {
    chapter1,
    chapter2,
    sharedAssets: [sharedCharacter] };
}

/**
 * Legacy ambiguous scenarios for blocker testing
 */
export function buildLegacyAmbiguousFixture(): {
  studio: StudioWorkflowState;
  script: ScriptData;
  tts: TtsStore;
  media: MediaStore;
  blockers: string[];
} {
  const now = Date.now();

  const studio: StudioWorkflowState = {
    materials: [],
    sourceBible: "",
    
    novelChapters: [
      {
        id: `novel-legacy-episode-1`,
        index: 1,
        title: "Legacy Episode 1",
        sourceText: "Old format chapter",
        importedAt: now - 3000000 },
    ],
    agentWorkData: [],
    entityExtractions: [],
    scriptPlans: [],
    seriesBible: null,
    episodeOutlines: [],
    storyboards: [],
    continuityAssetVersions: [],
    productionTracks: [],
    videoCandidates: [],
    sceneSegments: [],
    imageWorkflows: [],
    agentRuns: [],
    mediaTasks: [],
    eventGraph: [],
    projectMemoryRecords: [],
    workflowConfig: {} };

  const script: ScriptData = {
    title: "Script Chapter 1",
    language: "zh",
    characters: [],
    scenes: [],
    episodes: [
      {
        id: `script-chapter-1`,
        index: 1,
        title: "Script Chapter 1",
        sceneIds: [] },
    ],
    storyParagraphs: [] };

  // Legacy TTS lines with numeric sceneId only (no projectId/chapterId)
  const tts: TtsStore = {
    activeProjectId: PROJECT_ID,
    projects: {
      [PROJECT_ID]: {
        voiceLines: {
          "101": {
            sceneId: 101, // Ambiguous numeric ID
            text: "legacy-tts-1.mp3",
            speakerId: "narrator",
            profileId: undefined,
            engine: "kokoro" as const,
            modelSize: "small",
            status: "failed" as const,
            generationId: undefined,
            audioLocalPath: "legacy-tts-1.mp3",
            audioFilePath: undefined,
            audioMaterialId: undefined,
            ttsBackend: undefined,
            mocked: false,
            warning: undefined,
            error: undefined,
            updatedAt: now - 2000000 },
          "102": {
            sceneId: 102, // Same ambiguity
            text: "legacy-tts-2.mp3",
            speakerId: "narrator",
            profileId: undefined,
            engine: "kokoro" as const,
            modelSize: "small",
            status: "failed" as const,
            generationId: undefined,
            audioLocalPath: "legacy-tts-2.mp3",
            audioFilePath: undefined,
            audioMaterialId: undefined,
            ttsBackend: undefined,
            mocked: false,
            warning: undefined,
            error: undefined,
            updatedAt: now - 1900000 } },
        bindings: {} } },
    voiceProfiles: {},
    setActiveProjectId: () => {},
    ensureProject: () => {},
    createVoiceProfile: () => ({
      id: `profile-test-${Date.now()}`,
      name: 'Test Profile',
      type: 'preset' as const,
      language: 'en',
      defaultEngine: 'kokoro' as const,
      createdAt: Date.now(),
      updatedAt: Date.now() }),
    updateVoiceProfile: () => {},
    bindSpeaker: () => {},
    getBinding: () => undefined,
    ensureSceneVoiceLine: () => undefined,
    upsertSceneVoiceLine: () => {},
    getSceneVoiceLine: () => undefined,
    selectBatchSceneIds: (ids) => ids,
    markGenerating: () => {},
    markCompleted: () => {},
    markFailed: () => {},
    clearSceneAudio: () => {} };

  // Media files without chapter ownership
  const media: MediaStore = {
    mediaFiles: [
      {
        id: `media-unowned-1`,
        projectId: PROJECT_ID,
        name: "unowned-image.png",
        type: "image",
        url: undefined,
        thumbnailUrl: undefined,
        duration: undefined,
        width: undefined,
        height: undefined,
        fps: undefined,
        ephemeral: undefined,
        folderId: null,
        source: undefined,
        file: undefined },
      {
        id: `media-unowned-2`,
        projectId: PROJECT_ID,
        name: "another-unowned.jpg",
        type: "image",
        url: undefined,
        thumbnailUrl: undefined,
        duration: undefined,
        width: undefined,
        height: undefined,
        fps: undefined,
        ephemeral: undefined,
        folderId: null,
        source: undefined,
        file: undefined },
    ],
    folders: [],
    currentFolderId: null,
    isLoading: false,
    addMediaFile: async () => ({
      id: `media-test-${Date.now()}`,
      projectId: 'test-project',
      name: 'test.png',
      type: 'image',
      url: undefined,
      thumbnailUrl: undefined,
      duration: undefined,
      width: undefined,
      height: undefined,
      fps: undefined,
      ephemeral: undefined,
      folderId: null,
      source: undefined,
      file: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now() }),
    removeMediaFile: async () => {},
    loadProjectMedia: async () => {},
    clearProjectMedia: async () => {},
    clearAllMedia: () => {},
    addFolder: () => 'folder-id',
    renameFolder: () => {},
    deleteFolder: () => {},
    setCurrentFolder: () => {},
    renameMediaFile: () => {},
    moveToFolder: async () => {},
    addMediaFromUrl: () => 'url-id',
    getOrCreateCategoryFolder: () => 'category-folder-id',
    initSystemFolders: () => {},
    assignProjectToUnscoped: () => {} };

  return {
    studio,
    script,
    tts,
    media,
    blockers: [
      "numeric-tts-sceneid-101",
      "numeric-tts-sceneid-102",
      "media-unowned-1",
      "media-unowned-2",
    ] };
}

/**
 * Continuity bibles without episodeId (need path-based resolution)
 */
export function buildContinuityNoEpisodeIdFixture(): {
  studio: StudioWorkflowState;
  blockers?: string[];
} {
  const now = Date.now();

  const studio: StudioWorkflowState = {
    materials: [],
    sourceBible: "",
    
    novelChapters: [],
    agentWorkData: [],
    entityExtractions: [],
    scriptPlans: [],
    seriesBible: null,
    episodeOutlines: [],
    storyboards: [],
    continuityAssetVersions: [
      {
        assetId: "character-dugu",
        versionId: "version-gray-town",
        assetKind: "character",
        label: "Dugu - Gray Town Outfit",
        referenceImagePaths: [`continuity-bibles/characters/dugu-gray.jpg`],
        referenceImageSha256: undefined,
        reviewEvidencePaths: undefined,
        reviewEvidenceSha256: undefined,
        reviewEvidenceVerifiedAt: now - 100000,
        referenceViewTypes: ["front", "side", "back"],
        identityAnchors: { uniqueMarks: [] },
        negativePrompt: { avoid: [] },
        wardrobeVersion: "wardrobe-v1",
        sceneViewpointId: undefined,
        spatialLayout: "",
        lightingDesign: "",
        colorPalette: "",
        missingFields: [],
        structurallyComplete: true,
        contentFingerprint: "abc123",
        approval: undefined,
        approvalFingerprint: undefined,
        approved: true,
        source: "human-approved",
        validFromStoryboardIndex: undefined,
        validToStoryboardIndex: undefined },
    ],
    productionTracks: [],
    videoCandidates: [],
    sceneSegments: [],
    imageWorkflows: [],
    agentRuns: [],
    mediaTasks: [],
    eventGraph: [],
    projectMemoryRecords: [],
    workflowConfig: {} };

  // Blocker: continuity bible without episodeId context
  return {
    studio,
    blockers: ["continuity-bible-character-dugu-version-gray-town"] };
}

/**
 * Production track with index-derived trackKey (needs episodeId resolution)
 */
export function buildIndexDerivedTrackKeyFixture(): {
  studio: StudioWorkflowState;
  resolvesTo: string;
} {
  const now = Date.now();
  const chapterId = "chapter-003";
  const chapterIndex = 3;

  const studio: StudioWorkflowState = {
    materials: [],
    sourceBible: "",
    
    novelChapters: [
      {
        id: `novel-${chapterId}`,
        index: chapterIndex,
        title: `Chapter ${chapterIndex}`,
        sourceText: "Test chapter",
        importedAt: now - 3000000 },
    ],
    agentWorkData: [],
    entityExtractions: [],
    scriptPlans: [],
    seriesBible: null,
    episodeOutlines: [],
    storyboards: [
      {
        id: `sb-${chapterId}-0`,
        episodeId: chapterId,
        index: 0,
        trackKey: `${chapterId}-0`,
        trackId: `track-${chapterId}`,
        duration: 5000,
        prompt: "Test prompt",
        videoDesc: "Test video desc",
        assetIds: [],
        state: "ready" },
    ],
    continuityAssetVersions: [],
    productionTracks: [
      {
        id: `track-${chapterId}`,
        episodeId: chapterId, // Real resolution via this field
        trackKey: `${chapterIndex}`, // Index-derived runtime key
        storyboardIds: [`sb-${chapterId}-0`],
        prompt: "Track",
        duration: 5000,
        candidateVideoIds: [],
        state: "ready" },
    ],
    videoCandidates: [],
    sceneSegments: [],
    imageWorkflows: [],
    agentRuns: [],
    mediaTasks: [],
    eventGraph: [],
    projectMemoryRecords: [],
    workflowConfig: {} };

  return {
    studio,
    resolvesTo: chapterId };
}

/**
 * ScriptData with no top-level episodeId (resolve via episodes[].id)
 */
export function buildScriptDataNoTopLevelEpisodeIdFixture(): {
  script: ScriptData;
  episodes: Episode[];
} {
  const episodes: Episode[] = [
    {
      id: "real-episode-id-123",
      index: 5,
      title: "Real Episode 5",
      sceneIds: ["scene-456"] },
  ];

  const script: ScriptData = {
    title: "Test Script",
    language: "en",
    characters: [],
    scenes: [],
    episodes,
    storyParagraphs: [] };

  return {
    script,
    episodes };
}

/**
 * Cross-project rejection scenario
 */
export function buildCrossProjectFixture(): {
  media: MediaStore;
  rejectionReason: string;
} {
 
  Date.now();

  const media: MediaStore = {
    mediaFiles: [
      {
        id: `media-cross-project-1`,
        projectId: "other-project-xyz",
        name: "cross-project-image.png",
        type: "image",
        url: undefined,
        thumbnailUrl: undefined,
        duration: undefined,
        width: undefined,
        height: undefined,
        fps: undefined,
        ephemeral: undefined,
        folderId: null,
        source: undefined,
        file: undefined },
    ],
    folders: [],
    currentFolderId: null,
    isLoading: false,
    addMediaFile: async () => ({
      id: `media-test-${Date.now()}`,
      projectId: 'test-project',
      name: 'test.png',
      type: 'image',
      url: undefined,
      thumbnailUrl: undefined,
      duration: undefined,
      width: undefined,
      height: undefined,
      fps: undefined,
      ephemeral: undefined,
      folderId: null,
      source: undefined,
      file: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now() }),
    removeMediaFile: async () => {},
    loadProjectMedia: async () => {},
    clearProjectMedia: async () => {},
    clearAllMedia: () => {},
    addFolder: () => 'folder-id',
    renameFolder: () => {},
    deleteFolder: () => {},
    setCurrentFolder: () => {},
    renameMediaFile: () => {},
    moveToFolder: async () => {},
    addMediaFromUrl: () => 'url-id',
    getOrCreateCategoryFolder: () => 'category-folder-id',
    initSystemFolders: () => {},
    assignProjectToUnscoped: () => {} };

  return {
    media,
    rejectionReason: "Media file belongs to different project" };
}
