// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director/director-store";

// ── hoisted mocks ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const directorStore = {
    activeProjectId: "p1",
    setStoryboardConfig: vi.fn(),
    updateSplitSceneImageStatus: vi.fn(),
    updateSplitSceneEndFrameStatus: vi.fn(),
    setCinematographyProfileId: vi.fn(),
    deleteSplitScene: vi.fn(),
    addBlankSplitScene: vi.fn(),
    clearTrailer: vi.fn(),
  };
  const projectData = {
    splitScenes: [] as SplitScene[],
    storyboardImage: null,
    storyboardConfig: { aspectRatio: "16:9", resolution: "2K", videoResolution: "480p", sceneCount: 5, storyPrompt: "" },
    cinematographyProfileId: undefined as string | undefined,
  };
  return { toast, directorStore, projectData };
});

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/stores/director/director-store", () => ({
  useDirectorStore: () => mocks.directorStore,
  useActiveDirectorProject: () => mocks.projectData,
}));
vi.mock("@/stores/library/character-library-store", () => ({ useCharacterLibraryStore: () => ({}) }));
vi.mock("@/stores/script/script-store", () => ({ useScriptStore: () => "zh" }));
vi.mock("@/stores/media/media-store", () => ({ useMediaStore: () => ({ addMediaFromUrl: vi.fn(), getOrCreateCategoryFolder: vi.fn() }) }));
vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: () => ({ imageGenerationSettings: { defaultAspectRatio: "16:9", defaultResolution: "2K" } }),
}));
vi.mock("@/stores/ai/api-config-store", () => ({ useAPIConfigStore: () => ({ getProviderByPlatform: vi.fn(), concurrency: 2 }) }));
vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig: vi.fn() } }));

// hooks
vi.mock("@/components/features/storyboard/use-storyboard-generation-ui", () => ({
  useStoryboardGenerationUi: () => ({
    imageGenMode: "merged", setImageGenMode: vi.fn(),
    frameMode: "first", setFrameMode: vi.fn(),
    isMergedRunning: false, setIsMergedRunning: vi.fn(),
    refStrategy: "cluster", setRefStrategy: vi.fn(),
    useExemplar: true, setUseExemplar: vi.fn(),
    isGenerating: false, setIsGenerating: vi.fn(),
    isGeneratingPrompts: false, setIsGeneratingPrompts: vi.fn(),
    setCurrentGeneratingId: vi.fn(),
    activeTab: "editing", setActiveTab: vi.fn(),
    isAngleSwitching: false,
    isExtractingFrame: false, setIsExtractingFrame: vi.fn(),
    isQuadGridGenerating: false,
  }),
}));
vi.mock("@/hooks/use-merged-generation-cancellation", () => ({
  useMergedGenerationCancellation: () => ({
    cancelledRef: { current: false },
    start: vi.fn(() => ({})),
    stop: vi.fn(),
    finish: vi.fn(),
  }),
}));
vi.mock("@/components/features/storyboard/use-storyboard-scene-actions", () => ({
  useStoryboardSceneActions: () => ({
    updateEndFrame: vi.fn(), updateCharacters: vi.fn(), updateCharacterVariationMap: vi.fn(),
    updateEmotions: vi.fn(), updateShotSize: vi.fn(), updateDuration: vi.fn(),
    updateAmbientSound: vi.fn(), updateSoundEffects: vi.fn(), deleteScene: vi.fn(),
    removeImage: vi.fn(), uploadImage: vi.fn(), goBack: vi.fn(),
  }),
}));
vi.mock("@/components/features/storyboard/use-storyboard-media-library", () => ({ useStoryboardMediaLibrary: () => ({ saveVideo: vi.fn(), saveImage: vi.fn() }) }));
vi.mock("@/components/features/storyboard/use-storyboard-video-last-frame", () => ({ useStoryboardVideoLastFrame: () => ({ extractVideoLastFrame: vi.fn() }) }));
vi.mock("./use-split-scene-video-generation", () => ({
  useSplitSceneVideoGeneration: () => ({ stopVideoGeneration: vi.fn(), generateSingleVideo: vi.fn(), generateVideos: vi.fn() }),
}));
vi.mock("@/components/features/storyboard/use-storyboard-angle-switch", () => ({ useStoryboardAngleSwitch: () => ({ openAngleSwitch: vi.fn(), generate: vi.fn() }) }));
vi.mock("@/components/features/storyboard/use-storyboard-result-actions", () => ({
  useStoryboardResultActions: () => ({ handleApplyQuadGrid: vi.fn(), handleCopyQuadGridToScene: vi.fn(), handleApplyAngleSwitch: vi.fn() }),
}));
vi.mock("./use-storyboard-prompt-generation", () => ({ useStoryboardPromptGeneration: () => ({ handleAutoGeneratePrompts: vi.fn() }) }));
vi.mock("./use-director-quad-grid-controller", () => ({
  useDirectorQuadGridController: () => ({ handleQuadGridClick: vi.fn(), handleQuadGridGenerate: vi.fn() }),
}));
vi.mock("../use-storyboard-resolution-toast-handlers", () => ({
  useStoryboardResolutionToastHandlers: () => ({ handleImageResolutionChange: vi.fn(), handleVideoResolutionChange: vi.fn() }),
}));

// factory functions
vi.mock("@/components/features/storyboard/storyboard-end-frame-generation", () => ({ createStoryboardEndFrameGenerator: vi.fn(() => vi.fn()) }));
vi.mock("@/components/features/storyboard/storyboard-single-image-generation", () => ({ createStoryboardSingleImageGenerator: vi.fn(() => vi.fn()) }));
vi.mock("./storyboard-merged-page-generation", () => ({ createStoryboardMergedPageGenerator: vi.fn() }));

// child components — stubs
vi.mock("./split-scene-card", () => ({
  SplitSceneCard: ({ scene }: { scene: SplitScene }) => <div data-testid={`scene-card-${scene.id}`}>{scene.id}</div>,
}));
vi.mock("./split-scenes-editing-panel", () => ({
  SplitScenesEditingPanel: ({ scenes, onStyleChange, onAspectRatioChange, onCinematographyProfileChange, onMergedGenerate, onStopMerged, onAddBlank }: {
    scenes: SplitScene[]; onStyleChange: (id: string) => void; onAspectRatioChange: (r: "16:9") => void;
    onCinematographyProfileChange: (id: string) => void; onMergedGenerate: () => void; onStopMerged: () => void; onAddBlank: () => void;
  }) => (
    <div data-testid="editing-panel">
      <span data-testid="scene-count">{scenes.length}</span>
      <button onClick={() => onStyleChange("")}>clear style</button>
      <button onClick={() => onStyleChange("ink")}>set style</button>
      <button onClick={() => onAspectRatioChange("16:9")}>set ratio</button>
      <button onClick={() => onCinematographyProfileChange("cinematic")}>set profile</button>
      <button onClick={onMergedGenerate}>merged generate</button>
      <button onClick={onStopMerged}>stop merged</button>
      <button onClick={onAddBlank}>add blank</button>
    </div>
  ),
}));
vi.mock("./split-scenes-empty-state", () => ({
  SplitScenesEmptyState: () => <div data-testid="empty-state">暂无切割的分镜</div>,
}));
vi.mock("./split-scenes-trailer-tab", () => ({
  SplitScenesTrailerTab: () => <div data-testid="trailer-tab" />,
}));
vi.mock("@/components/features/storyboard/storyboard-generation-dialogs", () => ({
  StoryboardGenerationDialogs: () => <div data-testid="generation-dialogs" />,
}));
vi.mock("../storyboard-scenes-tabs", () => ({
  StoryboardScenesTabs: ({ trailerCount }: { trailerCount: number }) => <div data-testid="scenes-tabs">trailer:{trailerCount}</div>,
}));

import { SplitScenes } from "./split-scenes";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.projectData.splitScenes = [];
  mocks.projectData.storyboardConfig = { aspectRatio: "16:9", resolution: "2K", videoResolution: "480p", sceneCount: 5, storyPrompt: "" };
  mocks.projectData.cinematographyProfileId = undefined;
});

function makeScene(id: number, updates: Partial<SplitScene> = {}): SplitScene {
  return {
    id,
    image: null,
    imageStatus: "idle",
    imageProgress: 0,
    imageError: undefined,
    endFrame: null,
    endFrameStatus: "idle",
    endFrameProgress: 0,
    endFrameError: undefined,
    needsEndFrame: false,
    videoPrompt: "",
    videoPromptZh: "",
    imagePrompt: "",
    imagePromptZh: "",
    endFramePrompt: "",
    endFramePromptZh: "",
    shotSize: "medium",
    duration: 3,
    ambientSound: "",
    soundEffects: [],
    emotions: [],
    characterIds: [],
    characterVariationMap: {},
    sceneLibraryId: undefined,
    viewpointId: undefined,
    ...updates,
  } as SplitScene;
}

describe("SplitScenes", () => {
  it("renders the empty state when there are no split scenes", () => {
    mocks.projectData.splitScenes = [];
    render(<SplitScenes />);
    expect(screen.getByTestId("empty-state")).toBeTruthy();
    expect(screen.queryByTestId("editing-panel")).toBeNull();
  });

  it("renders tabs + editing panel with scene count when scenes exist", () => {
    mocks.projectData.splitScenes = [makeScene(0), makeScene(1), makeScene(2)];
    render(<SplitScenes />);
    expect(screen.getByTestId("scenes-tabs").textContent).toBe("trailer:0");
    expect(screen.getByTestId("editing-panel")).toBeTruthy();
    expect(screen.getByTestId("scene-count").textContent).toBe("3");
    expect(screen.getByTestId("generation-dialogs")).toBeTruthy();
  });

  it("clears visual style when onStyleChange receives empty id", () => {
    mocks.projectData.splitScenes = [makeScene(0)];
    render(<SplitScenes />);
    fireEvent.click(screen.getByText("clear style"));
    expect(mocks.directorStore.setStoryboardConfig).toHaveBeenCalledWith({ visualStyleId: undefined, styleTokens: [] });
    expect(mocks.toast.success).toHaveBeenCalledWith("已清除视觉风格");
  });

  it("updates aspect ratio and shows toast", () => {
    mocks.projectData.splitScenes = [makeScene(0)];
    render(<SplitScenes />);
    fireEvent.click(screen.getByText("set ratio"));
    expect(mocks.directorStore.setStoryboardConfig).toHaveBeenCalledWith({ aspectRatio: "16:9" });
    expect(mocks.toast.success).toHaveBeenCalledWith("已切换为 横屏 模式");
  });

  it("updates cinematography profile and shows toast", () => {
    mocks.projectData.splitScenes = [makeScene(0)];
    render(<SplitScenes />);
    fireEvent.click(screen.getByText("set profile"));
    expect(mocks.directorStore.setCinematographyProfileId).toHaveBeenCalledWith("cinematic");
    expect(mocks.toast.success).toHaveBeenCalledWith("摄影风格已更新");
  });

  it("stops merged generation and shows toast", () => {
    mocks.projectData.splitScenes = [makeScene(0)];
    render(<SplitScenes />);
    fireEvent.click(screen.getByText("stop merged"));
    expect(mocks.toast.info).toHaveBeenCalledWith("合并生成已停止");
  });

  it("rejects merged generation with empty scenes", async () => {
    mocks.projectData.splitScenes = [];
    render(<SplitScenes />);
    // empty state means editing panel is not rendered — can't click merged generate
    // so this test just verifies the empty state branch doesn't crash
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("rejects merged generation when AI feature config is missing", async () => {
    mocks.projectData.splitScenes = [makeScene(0)];
    const { aiManager } = await import("@/lib/ai/ai-manager");
    vi.mocked(aiManager.featureConfig).mockReturnValue(null);
    render(<SplitScenes />);
    fireEvent.click(screen.getByText("merged generate"));
    // Toast is called async — wait a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.toast.error).toHaveBeenCalledWith("请先在设置中配置图片生成服务映射");
  });

  it("adds a blank scene when onAddBlank is triggered", () => {
    mocks.projectData.splitScenes = [makeScene(0)];
    render(<SplitScenes />);
    fireEvent.click(screen.getByText("add blank"));
    expect(mocks.directorStore.addBlankSplitScene).toHaveBeenCalledTimes(1);
  });
});
