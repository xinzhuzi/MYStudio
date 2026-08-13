// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  return {
    toast,
    mediaPanelStore: { setActiveTab: vi.fn(), goToDirectorWithData: vi.fn() },
    scriptProject: null as unknown,
    directorStore: {
      addScenesFromScript: vi.fn(),
      setStoryboardConfig: vi.fn(),
      projectData: { storyboardConfig: { visualStyleId: undefined }, splitScenes: [] },
    },
    charStore: { characters: [] },
    sceneStore: { scenes: [] },
    settingsStore: { resourceSharing: false },
    projectStore: { activeProjectId: "p1" },
  };
});

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/stores/navigation/media-panel-store", () => ({ useMediaPanelStore: () => mocks.mediaPanelStore }));
vi.mock("@/stores/script/script-store", () => ({ useActiveScriptProject: () => mocks.scriptProject }));
vi.mock("@/lib/script/shot-utils", () => ({
  getShotCompletionStatus: () => "idle",
  calculateProgress: () => 0,
  SHOT_SIZE_MAP: {},
}));
vi.mock("@/lib/constants/visual-styles", () => ({
  DEFAULT_STYLE_ID: "ink",
  getStyleById: () => ({ id: "ink", name: "水墨", prompt: "ink style" }),
}));
vi.mock("@/stores/director/director-store", () => ({
  useDirectorStore: () => mocks.directorStore,
  useActiveDirectorProject: () => mocks.directorStore.projectData,
}));
vi.mock("@/stores/library/character-library-store", () => ({ useCharacterLibraryStore: () => mocks.charStore }));
vi.mock("@/stores/library/scene-store", () => ({ useSceneStore: () => mocks.sceneStore }));
vi.mock("@/stores/app/app-settings-store", () => ({ useAppSettingsStore: () => mocks.settingsStore }));
vi.mock("@/stores/project/project-store", () => ({ useProjectStore: () => mocks.projectStore }));
vi.mock("@/lib/scene/viewpoint-matcher", () => ({ matchSceneAndViewpoint: vi.fn() }));
vi.mock("./director-context-tree", () => ({
  DirectorContextTree: () => <div data-testid="context-tree" />,
}));
vi.mock("./director-context-mapping", () => ({
  findQuickSceneViewpointMatch: vi.fn(() => null),
  mapScriptCharactersToLibraryIds: vi.fn(() => ({})),
}));

import { DirectorContextPanel } from "./context-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.scriptProject = null;
});

describe("DirectorContextPanel", () => {
  it("renders empty state when no script data", () => {
    render(<DirectorContextPanel />);
    expect(screen.getByText("暂无剧本数据")).toBeTruthy();
  });

  it("renders back to script button in empty state", () => {
    render(<DirectorContextPanel />);
    const btn = screen.getByText("去剧本面板");
    expect(btn).toBeTruthy();
  });

  it("renders context tree when script data exists", () => {
    mocks.scriptProject = {
      scriptData: {
        title: "测试剧本",
        episodes: [{ episodeIndex: 0, title: "第一集", scenes: [{ id: 1, name: "场景1", shots: [] }] }],
        characters: [],
        scenes: [{ id: 1, name: "场景1" }],
        styleId: "ink",
        shots: [{ id: "s1", sceneId: 1, shotNumber: "1-1", visualDescription: "测试", shotSize: "medium", duration: 3, keyframes: [], imageStatus: "idle", videoStatus: "idle" }],
      },
    } as never;
    const { container } = render(<DirectorContextPanel />);
    // When script data exists, the empty state "暂无剧本数据" should not appear
    expect(screen.queryByText("暂无剧本数据")).toBeNull();
    // The script title should be rendered in the header
    expect(container.textContent).toContain("测试剧本");
  });
});
