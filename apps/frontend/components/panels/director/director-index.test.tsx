// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const directorStore = {
    activeProjectId: undefined as string | undefined,
    setActiveProjectId: vi.fn(),
    ensureProject: vi.fn(),
    setStoryboardImage: vi.fn(),
    setStoryboardStatus: vi.fn(),
    setStoryboardError: vi.fn(),
    setStoryboardConfig: vi.fn(),
    resetStoryboard: vi.fn(),
    startImageGeneration: vi.fn(),
    startVideoGeneration: vi.fn(),
    retrySceneImage: vi.fn(),
    deleteScene: vi.fn(),
    deleteAllScenes: vi.fn(),
    cancelAll: vi.fn(),
    reset: vi.fn(),
    addMediaFromUrl: vi.fn(),
    getOrCreateCategoryFolder: vi.fn(),
  };
  const projectData = {
    storyboardStatus: "idle" as string,
    storyboardImage: null as string | null,
    storyboardError: null as string | null,
    storyboardConfig: { aspectRatio: "16:9", resolution: "2K", sceneCount: 5, storyPrompt: "" },
    splitScenes: [] as unknown[],
    screenplay: null as unknown,
    screenplayStatus: "idle" as string,
    screenplayError: null as string | null,
  };
  return { toast, directorStore, projectData };
});

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/stores/director/director-store", () => ({
  useDirectorStore: () => mocks.directorStore,
  useOverallProgress: () => 0,
  useIsGenerating: () => false,
  useActiveDirectorProject: () => mocks.projectData,
}));
vi.mock("@/stores/project/project-store", () => ({ useProjectStore: () => ({ activeProjectId: "p1" }) }));
vi.mock("@/stores/navigation/media-panel-store", () => ({ useMediaPanelStore: () => ({ setActiveTab: vi.fn() }) }));
vi.mock("@/stores/app/app-settings-store", () => ({ useAppSettingsStore: () => ({ imageGenerationSettings: { defaultAspectRatio: "16:9", defaultResolution: "2K" } }) }));
vi.mock("@/stores/media/media-store", () => ({ useMediaStore: () => ({ addMediaFromUrl: vi.fn(), getOrCreateCategoryFolder: vi.fn() }) }));
vi.mock("@/lib/storyboard", () => ({ generateStoryboardImage: vi.fn() }));
vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: { featureConfig: vi.fn() } }));
vi.mock("@/lib/ai/image-size-presets", () => ({ normalizeHorizontalVerticalAspectRatio: (v: string) => v }));

// child components
vi.mock("./screenplay-input", () => ({ ScreenplayInput: ({ onGenerateStoryboard }: { onGenerateStoryboard: () => void }) => <button onClick={onGenerateStoryboard}>generate storyboard</button> }));
vi.mock("./storyboard-preview", () => ({ StoryboardPreview: () => <div data-testid="storyboard-preview" /> }));
vi.mock("./split-scenes", () => ({ SplitScenes: () => <div data-testid="split-scenes" /> }));
vi.mock("./scene-card", () => ({ SceneCard: () => <div data-testid="scene-card" /> }));
vi.mock("./generation-progress", () => ({ GenerationProgress: () => <div data-testid="generation-progress" /> }));

import { DirectorView } from "./index";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.projectData.storyboardStatus = "idle";
  mocks.projectData.storyboardImage = null;
  mocks.projectData.storyboardError = null;
  mocks.projectData.splitScenes = [];
});

describe("DirectorView", () => {
  it("renders screenplay input in idle state", () => {
    render(<DirectorView />);
    expect(screen.getByText("AI 导演")).toBeTruthy();
  });

  it("renders storyboard preview when status is preview", () => {
    mocks.projectData.storyboardStatus = "preview";
    render(<DirectorView />);
    expect(screen.getByTestId("storyboard-preview")).toBeTruthy();
  });

  it("renders split scenes when status is editing", () => {
    mocks.projectData.storyboardStatus = "editing";
    render(<DirectorView />);
    expect(screen.getByTestId("split-scenes")).toBeTruthy();
  });

  it("renders error UI when status is error", () => {
    mocks.projectData.storyboardStatus = "error";
    mocks.projectData.storyboardError = "生成失败";
    render(<DirectorView />);
    expect(screen.getByText("重试")).toBeTruthy();
  });
});
