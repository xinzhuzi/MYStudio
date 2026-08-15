// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectStoreState = {
    projects: [] as Array<{ id: string; name: string; createdAt: number; updatedAt: number; location?: string }>,
    activeProjectId: null as string | null,
    activeProject: null as unknown,
    createProject: vi.fn((name?: string, location?: string, id?: string) => ({
      id: id ?? "generated-id",
      name: name ?? "",
      createdAt: 0,
      updatedAt: 0,
      ...(location ? { location } : {}),
    })),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
    setActiveProject: vi.fn(),
  };
  return {
    projectStoreState,
    appSettingsState: {
      projectLocationDefaults: { lastParentDir: "" },
      setProjectLocationDefaults: vi.fn(),
    },
    setActiveTab: vi.fn(),
    switchProject: vi.fn(async () => undefined),
    prepare: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    status: vi.fn(),
    selectDirectory: vi.fn(),
    getProjectFolderBridge: vi.fn(),
    getStorageManagerBridge: vi.fn(),
    getFileStorageBridge: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastWarning: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: mocks.toastWarning },
}));

vi.mock("@/stores/project/project-store", () => {
  type ProjectStoreState = typeof mocks.projectStoreState;
  const useProjectStore = Object.assign(() => mocks.projectStoreState, {
    getState: () => mocks.projectStoreState,
    setState: (updater: unknown) => {
      const next = typeof updater === "function"
        ? (updater as (state: ProjectStoreState) => Partial<ProjectStoreState>)(mocks.projectStoreState)
        : (updater as Partial<ProjectStoreState>);
      Object.assign(mocks.projectStoreState, next);
    },
  });
  return { useProjectStore };
});

vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: () => mocks.appSettingsState,
}));

vi.mock("@/stores/navigation/media-panel-store", () => ({
  useMediaPanelStore: () => ({ setActiveTab: mocks.setActiveTab }),
}));

vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => ({ workflowConfig: {} }) },
}));

vi.mock("@/lib/project/project-switcher", () => ({
  switchProject: mocks.switchProject,
}));

vi.mock("@/lib/studio/remotion/remotion-workspace-storage", () => ({
  DEFAULT_REMOTION_RENDER_SETTINGS: {},
  buildRemotionProductionProfile: vi.fn(() => ({})),
  ensureRemotionWorkspace: vi.fn(async () => ({ status: "ready" })),
}));

vi.mock("@/lib/bridge/file-storage", () => ({
  getFileStorageBridge: mocks.getFileStorageBridge,
}));

vi.mock("@/lib/bridge/project-folder", () => ({
  getProjectFolderBridge: mocks.getProjectFolderBridge,
}));

vi.mock("@/lib/bridge/storage-manager", () => ({
  getStorageManagerBridge: mocks.getStorageManagerBridge,
}));

import { Dashboard } from "./Dashboard";

describe("Dashboard project folder flows", () => {
  beforeEach(() => {
    mocks.projectStoreState.projects = [{ id: "p-legacy", name: "旧项目", createdAt: 1, updatedAt: 1 }];
    mocks.projectStoreState.activeProjectId = "p-legacy";
    mocks.projectStoreState.activeProject = null;
    mocks.projectStoreState.createProject.mockClear();
    mocks.projectStoreState.renameProject.mockClear();
    mocks.projectStoreState.deleteProject.mockClear();
    mocks.appSettingsState.projectLocationDefaults.lastParentDir = "";
    mocks.appSettingsState.setProjectLocationDefaults.mockClear();
    mocks.setActiveTab.mockClear();
    mocks.switchProject.mockClear();
    mocks.selectDirectory.mockReset();
    mocks.prepare.mockReset();
    mocks.rename.mockReset();
    mocks.remove.mockReset();
    mocks.status.mockReset();
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
    mocks.getFileStorageBridge.mockReset().mockReturnValue(undefined);
    mocks.getProjectFolderBridge.mockReset().mockReturnValue({
      prepare: mocks.prepare,
      rename: mocks.rename,
      remove: mocks.remove,
      status: mocks.status,
    });
    mocks.getStorageManagerBridge.mockReset().mockReturnValue({ selectDirectory: mocks.selectDirectory });
  });

  afterEach(cleanup);

  function openCreateForm() {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.change(screen.getByPlaceholderText("输入项目名称..."), { target: { value: "测试项目" } });
    return screen.getByRole("button", { name: "创建" });
  }

  async function chooseLocation(dir: string) {
    mocks.selectDirectory.mockResolvedValue(dir);
    fireEvent.click(screen.getByRole("button", { name: "选择位置" }));
    await waitFor(() => expect(screen.getByTitle(dir)).toBeTruthy());
  }

  it("requires both name and location before creating, and opens the picker at the last parent dir", async () => {
    const createButton = openCreateForm();
    expect(createButton.getAttribute("disabled")).not.toBeNull();

    mocks.appSettingsState.projectLocationDefaults.lastParentDir = "/last/parent";
    mocks.selectDirectory.mockResolvedValue("/Users/x/Project/IP");
    fireEvent.click(screen.getByRole("button", { name: "选择位置" }));
    await waitFor(() => expect(mocks.selectDirectory).toHaveBeenCalledWith("/last/parent"));
    await waitFor(() => expect(screen.getByTitle("/Users/x/Project/IP")).toBeTruthy());
    expect(createButton.getAttribute("disabled")).toBeNull();
  });

  it("shows an inline CONFLICT error and keeps the form when the folder exists", async () => {
    const createButton = openCreateForm();
    await chooseLocation("/Users/x/Project/IP");
    mocks.prepare.mockResolvedValue({ ok: false, code: "CONFLICT", message: "文件夹已存在且非空：/Users/x/Project/IP/测试项目" });

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(screen.getByText("文件夹已存在且非空：/Users/x/Project/IP/测试项目")).toBeTruthy(),
    );
    expect(mocks.projectStoreState.createProject).not.toHaveBeenCalled();
    expect(mocks.switchProject).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("输入项目名称...")).toBeTruthy();
  });

  it("creates the project with the prepared location and remembers the parent dir", async () => {
    const createButton = openCreateForm();
    await chooseLocation("/Users/x/Project/IP");
    mocks.prepare.mockImplementation(async (_projectId: string, parentDir: string, projectName: string) => ({
      ok: true,
      location: `${parentDir}/${projectName}`,
    }));

    fireEvent.click(createButton);

    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(expect.any(String), "/Users/x/Project/IP", "测试项目"),
    );
    await waitFor(() =>
      expect(mocks.projectStoreState.createProject).toHaveBeenCalledWith(
        "测试项目",
        "/Users/x/Project/IP/测试项目",
        expect.any(String),
      ),
    );
    expect(mocks.appSettingsState.setProjectLocationDefaults).toHaveBeenCalledWith({
      lastParentDir: "/Users/x/Project/IP",
    });
    await waitFor(() => expect(mocks.switchProject).toHaveBeenCalled());
    expect(mocks.setActiveTab).toHaveBeenCalledWith("overview");
    expect(screen.queryByPlaceholderText("输入项目名称...")).toBeNull();
  });

  it("blocks opening an external project whose folder is missing", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-legacy", name: "旧项目", createdAt: 1, updatedAt: 1 },
      { id: "p-ext", name: "道劫", createdAt: 2, updatedAt: 3, location: "/gone/道劫" },
    ];
    mocks.status.mockResolvedValue({ location: "/gone/道劫", exists: false });

    render(<Dashboard />);

    // External projects render their location as secondary card text.
    expect(screen.getByTitle("/gone/道劫")).toBeTruthy();

    fireEvent.click(screen.getByText("道劫"));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("项目文件夹不存在，无法打开", {
        description: "/gone/道劫",
      }),
    );
    expect(mocks.switchProject).not.toHaveBeenCalled();
  });

  it("opens external projects after the folder status check passes", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-ext", name: "道劫", createdAt: 2, updatedAt: 3, location: "/ok/道劫" },
    ];
    mocks.status.mockResolvedValue({ location: "/ok/道劫", exists: true });

    render(<Dashboard />);
    fireEvent.click(screen.getByText("道劫"));

    await waitFor(() => expect(mocks.status).toHaveBeenCalledWith("p-ext"));
    await waitFor(() => expect(mocks.switchProject).toHaveBeenCalledWith("p-ext"));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
