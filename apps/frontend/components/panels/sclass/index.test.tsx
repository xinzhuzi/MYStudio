// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { SClassView } from "./index";

const mocks = vi.hoisted(() => ({
  activeProjectId: "project-1",
  projectData: {
    splitScenes: [] as SplitScene[],
    storyboardStatus: "idle",
  },
  setDirectorActiveProjectId: vi.fn(),
  ensureDirectorProject: vi.fn(),
  setSClassActiveProjectId: vi.fn(),
  ensureSClassProject: vi.fn(),
  setActiveTab: vi.fn(),
}));

vi.mock("./sclass-scenes", () => ({
  SClassScenes: () => <div data-testid="sclass-scenes" />,
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: () => ({ activeProjectId: mocks.activeProjectId }),
}));

vi.mock("@/stores/director-store", () => ({
  useDirectorStore: () => ({
    setActiveProjectId: mocks.setDirectorActiveProjectId,
    ensureProject: mocks.ensureDirectorProject,
  }),
  useActiveDirectorProject: () => mocks.projectData,
}));

vi.mock("@/stores/sclass-store", () => ({
  useSClassStore: () => ({
    setActiveProjectId: mocks.setSClassActiveProjectId,
    ensureProject: mocks.ensureSClassProject,
  }),
}));

vi.mock("@/stores/media-panel-store", () => ({
  useMediaPanelStore: () => ({ setActiveTab: mocks.setActiveTab }),
}));

function scene(id: number): SplitScene {
  return {
    id,
    sceneName: `分镜 ${id + 1}`,
    duration: 5,
    videoStatus: "idle",
  } as SplitScene;
}

beforeEach(() => {
  mocks.activeProjectId = "project-1";
  mocks.projectData = {
    splitScenes: [],
    storyboardStatus: "idle",
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SClassView", () => {
  it("shows the empty state and routes to the script panel", () => {
    render(<SClassView />);

    expect(screen.getByText("S级 · Seedance 2.0 多模态创作")).toBeTruthy();
    expect(screen.queryByTestId("sclass-scenes")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "前往剧本面板" }));

    expect(mocks.setActiveTab).toHaveBeenCalledWith("script");
  });

  it("syncs the active project into director and S-Class stores", () => {
    render(<SClassView />);

    expect(mocks.setDirectorActiveProjectId).toHaveBeenCalledWith("project-1");
    expect(mocks.ensureDirectorProject).toHaveBeenCalledWith("project-1");
    expect(mocks.setSClassActiveProjectId).toHaveBeenCalledWith("project-1");
    expect(mocks.ensureSClassProject).toHaveBeenCalledWith("project-1");
  });

  it("renders scenes and routes the API button to settings when split scenes exist", () => {
    mocks.projectData = {
      splitScenes: [scene(0), scene(1)],
      storyboardStatus: "idle",
    };

    render(<SClassView />);

    expect(screen.getByText("2 个分镜")).toBeTruthy();
    expect(screen.getByTestId("sclass-scenes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "API" }));

    expect(mocks.setActiveTab).toHaveBeenCalledWith("settings");
  });

  it("renders scenes while storyboard editing is active without split scenes", () => {
    mocks.projectData = {
      splitScenes: [],
      storyboardStatus: "editing",
    };

    render(<SClassView />);

    expect(screen.getByTestId("sclass-scenes")).toBeTruthy();
  });
});
