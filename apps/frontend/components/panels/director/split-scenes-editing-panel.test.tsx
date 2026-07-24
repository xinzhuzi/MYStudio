// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { SplitScenesEditingPanel, type SplitScenesEditingPanelProps } from "./split-scenes-editing-panel";

vi.mock("./storyboard-config-toolbar", () => ({
  StoryboardConfigToolbar: ({ onImageResolutionChange }: { onImageResolutionChange: (value: "2K") => void }) => (
    <button type="button" onClick={() => onImageResolutionChange("2K")}>config toolbar</button>
  ),
}));

vi.mock("./storyboard-merged-generation-controls", () => ({
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

vi.mock("./split-scenes-prompt-warning", () => ({
  SplitScenesPromptWarning: ({ hasMissingPrompt }: { hasMissingPrompt: boolean }) => (
    hasMissingPrompt ? <div data-testid="prompt-warning" /> : null
  ),
}));

vi.mock("./scene-voice-batch-toolbar", () => ({
  SceneVoiceBatchToolbar: ({ scenes }: { scenes: SplitScene[] }) => (
    <div data-testid="voice-toolbar">{scenes.length}</div>
  ),
}));

vi.mock("./split-scene-video-action-bar", () => ({
  SplitSceneVideoActionBar: ({ onGenerateVideos }: { onGenerateVideos: () => void }) => (
    <button type="button" onClick={onGenerateVideos}>generate videos</button>
  ),
}));

function scene(id: number, updates: Partial<SplitScene> = {}): SplitScene {
  return {
    id,
    sceneName: `分镜 ${id + 1}`,
    duration: 5,
    videoStatus: "idle",
    ...updates,
  } as SplitScene;
}

function createProps(overrides: Partial<SplitScenesEditingPanelProps> = {}): SplitScenesEditingPanelProps {
  return {
    scenes: [scene(0), scene(1, { videoPromptZh: "已有提示词" })],
    renderSceneCard: (currentScene: SplitScene): ReactNode => (
      <div key={currentScene.id}>scene card {currentScene.id}</div>
    ),
    isGenerating: false,
    isGeneratingPrompts: false,
    onAutoGeneratePrompts: vi.fn(),
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
    hasMissingPrompt: true,
    onAddBlank: vi.fn(),
    onGenerateVideos: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SplitScenesEditingPanel", () => {
  it("renders editing controls, scene cards, prompt warning, and action callbacks", () => {
    const props = createProps();
    render(<SplitScenesEditingPanel {...props} />);

    expect(screen.getByText("2 个分镜")).toBeTruthy();
    expect(screen.getByText("scene card 0")).toBeTruthy();
    expect(screen.getByText("scene card 1")).toBeTruthy();
    expect(screen.getByTestId("prompt-warning")).toBeTruthy();
    expect(screen.getByTestId("voice-toolbar").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "添加空白分镜" }));
    fireEvent.click(screen.getByRole("button", { name: "generate videos" }));
    fireEvent.click(screen.getByRole("button", { name: "config toolbar" }));
    fireEvent.click(screen.getByRole("button", { name: "merged generate" }));
    fireEvent.click(screen.getByRole("button", { name: "stop merged" }));

    expect(props.onAddBlank).toHaveBeenCalledTimes(1);
    expect(props.onGenerateVideos).toHaveBeenCalledTimes(1);
    expect(props.onImageResolutionChange).toHaveBeenCalledWith("2K");
    expect(props.onMergedGenerate).toHaveBeenCalledWith("first", "cluster", true);
    expect(props.onStopMerged).toHaveBeenCalledTimes(1);
  });

  it("disables blank-scene insertion and hides merged controls outside merged mode", () => {
    render(<SplitScenesEditingPanel {...createProps({
      imageGenerationMode: "single",
      isGenerating: true,
      hasMissingPrompt: false,
    })} />);

    expect(screen.queryByRole("button", { name: "merged generate" })).toBeNull();
    expect(screen.queryByTestId("prompt-warning")).toBeNull();
    expect(screen.getByRole("button", { name: "添加空白分镜" })).toHaveProperty("disabled", true);
  });
});
