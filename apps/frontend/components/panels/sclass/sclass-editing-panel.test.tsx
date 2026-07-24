// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Character } from "@/stores/character-library-store";
import type { SplitScene } from "@/stores/director-store";
import type { Scene } from "@/stores/scene-store";
import type { ShotGroup } from "@/stores/sclass-store";
import { SClassEditingPanel, type SClassEditingPanelProps } from "./sclass-editing-panel";

vi.mock("./sclass-storyboard-config-toolbar", () => ({
  SClassStoryboardConfigToolbar: ({ onImageResolutionChange }: {
    onImageResolutionChange: (value: "2K") => void;
  }) => (
    <button type="button" onClick={() => onImageResolutionChange("2K")}>config toolbar</button>
  ),
}));

vi.mock("../director/storyboard-merged-generation-controls", () => ({
  StoryboardMergedGenerationControls: ({ onGenerate, onStop }: {
    onGenerate: (mode: "first", strategy: "cluster", useExemplar: true) => void;
    onStop: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onGenerate("first", "cluster", true)}>merged generate</button>
      <button type="button" onClick={onStop}>stop merged</button>
    </div>
  ),
}));

vi.mock("./sclass-generation-mode-toggle", () => ({
  SClassGenerationModeToggle: ({
    onGenerationModeChange,
    onBatchCalibrate,
    onRegroup,
  }: {
    onGenerationModeChange: (mode: "single") => void;
    onBatchCalibrate: () => void;
    onRegroup: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onGenerationModeChange("single")}>single mode</button>
      <button type="button" onClick={onBatchCalibrate}>batch calibrate</button>
      <button type="button" onClick={onRegroup}>regroup</button>
    </div>
  ),
}));

vi.mock("../director/scene-voice-batch-toolbar", () => ({
  SceneVoiceBatchToolbar: ({ scenes }: { scenes: SplitScene[] }) => (
    <div data-testid="voice-toolbar">{scenes.length}</div>
  ),
}));

vi.mock("./shot-group", () => ({
  ShotGroupCard: ({
    group,
    scenes,
    onGenerateGroupVideo,
    onCalibrateGroup,
    onExtendGroup,
    onEditGroup,
  }: {
    group: ShotGroup;
    scenes: SplitScene[];
    onGenerateGroupVideo: (groupId: string) => void;
    onCalibrateGroup: (groupId: string) => void;
    onExtendGroup: (groupId: string) => void;
    onEditGroup: (groupId: string) => void;
  }) => (
    <div data-testid={`group-${group.id}`}>
      <span>{group.name}</span>
      <span>group scenes {scenes.length}</span>
      <button type="button" onClick={() => onGenerateGroupVideo(group.id)}>generate group</button>
      <button type="button" onClick={() => onCalibrateGroup(group.id)}>calibrate group</button>
      <button type="button" onClick={() => onExtendGroup(group.id)}>extend group</button>
      <button type="button" onClick={() => onEditGroup(group.id)}>edit group</button>
    </div>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function scene(id: number, updates: Partial<SplitScene> = {}): SplitScene {
  return {
    id,
    sceneName: `分镜 ${id + 1}`,
    duration: 5,
    videoPrompt: "已有提示词",
    imageDataUrl: `image-${id}`,
    videoStatus: "idle",
    ...updates,
  } as SplitScene;
}

function shotGroup(updates: Partial<ShotGroup> = {}): ShotGroup {
  return {
    id: "group-1",
    name: "第一组",
    sceneIds: [0],
    videoStatus: "idle",
    videoProgress: 0,
    videoError: null,
    videoUrl: null,
    ...updates,
  } as ShotGroup;
}

function createProps(overrides: Partial<SClassEditingPanelProps> = {}): SClassEditingPanelProps {
  const scenes = [scene(0), scene(1, { imageDataUrl: "", videoPrompt: "" })];
  return {
    scenes,
    renderSceneCard: (currentScene: SplitScene): ReactNode => (
      <div key={currentScene.id}>scene card {currentScene.id}</div>
    ),
    isGenerating: false,
    onBack: vi.fn(),
    styleId: "ink",
    onStyleChange: vi.fn(),
    cinematographyProfileId: "default",
    onCinematographyProfileChange: vi.fn(),
    aspectRatio: "16:9",
    onAspectRatioChange: vi.fn(),
    imageResolution: "1K",
    onImageResolutionChange: vi.fn(),
    videoResolution: "480p",
    onVideoResolutionChange: vi.fn(),
    imageGenerationMode: "merged",
    onImageGenerationModeChange: vi.fn(),
    styleTokens: [],
    frameMode: "first",
    onFrameModeChange: vi.fn(),
    refStrategy: "cluster",
    onRefStrategyChange: vi.fn(),
    useExemplar: true,
    onUseExemplarChange: vi.fn(),
    isMergedRunning: false,
    onMergedGenerate: vi.fn(),
    onStopMerged: vi.fn(),
    sclassGenerationMode: "group",
    onSClassGenerationModeChange: vi.fn(),
    shotGroups: [shotGroup()],
    sceneMap: new Map(scenes.map((currentScene) => [currentScene.id, currentScene])),
    isBatchCalibrationDisabled: false,
    onBatchCalibrate: vi.fn(),
    onRegroup: vi.fn(),
    onCalibrateGroup: vi.fn(),
    onGenerateGroupVideo: vi.fn(),
    onExtendGroup: vi.fn(),
    onEditGroup: vi.fn(),
    allCharacters: [] as Character[],
    sceneLibrary: [] as Scene[],
    batchProgress: null,
    onGenerateGroupVideos: vi.fn(),
    onGenerateVideos: vi.fn(),
    onAbortGeneration: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SClassEditingPanel", () => {
  it("renders group editing controls and delegates group actions", () => {
    const props = createProps();
    render(<SClassEditingPanel {...props} />);

    expect(screen.getByText("2 个分镜")).toBeTruthy();
    expect(screen.getByTestId("voice-toolbar").textContent).toBe("2");
    expect(screen.getByText("部分分镜缺少提示词，点击分镜下方的文字区域可编辑。")).toBeTruthy();
    expect(screen.getByText("第一组")).toBeTruthy();
    expect(screen.getByText("group scenes 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "config toolbar" }));
    fireEvent.click(screen.getByRole("button", { name: "merged generate" }));
    fireEvent.click(screen.getByRole("button", { name: "stop merged" }));
    fireEvent.click(screen.getByRole("button", { name: "single mode" }));
    fireEvent.click(screen.getByRole("button", { name: "batch calibrate" }));
    fireEvent.click(screen.getByRole("button", { name: "regroup" }));
    fireEvent.click(screen.getByRole("button", { name: "generate group" }));
    fireEvent.click(screen.getByRole("button", { name: "calibrate group" }));
    fireEvent.click(screen.getByRole("button", { name: "extend group" }));
    fireEvent.click(screen.getByRole("button", { name: "edit group" }));
    fireEvent.click(screen.getByRole("button", { name: "Seedance 2.0 组级生成 (1/1 组)" }));

    expect(props.onImageResolutionChange).toHaveBeenCalledWith("2K");
    expect(props.onMergedGenerate).toHaveBeenCalledWith("first", "cluster", true);
    expect(props.onStopMerged).toHaveBeenCalledTimes(1);
    expect(props.onSClassGenerationModeChange).toHaveBeenCalledWith("single");
    expect(props.onBatchCalibrate).toHaveBeenCalledTimes(1);
    expect(props.onRegroup).toHaveBeenCalledTimes(1);
    expect(props.onGenerateGroupVideo).toHaveBeenCalledWith("group-1");
    expect(props.onCalibrateGroup).toHaveBeenCalledWith("group-1");
    expect(props.onExtendGroup).toHaveBeenCalledWith("group-1");
    expect(props.onEditGroup).toHaveBeenCalledWith("group-1");
    expect(props.onGenerateGroupVideos).toHaveBeenCalledTimes(1);
  });

  it("uses single-scene generation branch and hides merged controls outside merged mode", () => {
    const scenes = [scene(0), scene(1, { videoStatus: "completed" })];
    const props = createProps({
      scenes,
      sceneMap: new Map(scenes.map((currentScene) => [currentScene.id, currentScene])),
      imageGenerationMode: "single",
      sclassGenerationMode: "single",
    });
    render(<SClassEditingPanel {...props} />);

    expect(screen.queryByRole("button", { name: "merged generate" })).toBeNull();
    expect(screen.getByText("scene card 0")).toBeTruthy();
    expect(screen.getByText("scene card 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "生成视频 (1/2)" }));

    expect(props.onGenerateVideos).toHaveBeenCalledTimes(1);
    expect(props.onGenerateGroupVideos).not.toHaveBeenCalled();
  });

  it("disables generation without first frames and exposes group abort while running", () => {
    const noImageScene = scene(0, { imageDataUrl: "" });
    const props = createProps({
      scenes: [noImageScene],
      sceneMap: new Map([[noImageScene.id, noImageScene]]),
      isGenerating: true,
      batchProgress: { total: 2, completed: 1, current: "group-1", results: [] },
    });
    render(<SClassEditingPanel {...props} />);

    expect(screen.getByRole("button", { name: "生成中 (1/2)..." })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(props.onAbortGeneration).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  });
});
