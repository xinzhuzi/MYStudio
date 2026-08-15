// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { ProjectFolderMoveResult } from "@/types/electron";

type MoveProgressEvent = {
  projectId: string;
  phase: "copying" | "verifying" | "finalizing";
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
    importProject: vi.fn(),
    setProjectLocation: vi.fn(),
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
    move: vi.fn(),
    cancelMove: vi.fn(),
    importFolder: vi.fn(),
    onMoveProgress: vi.fn(),
    progressListener: null as ((event: unknown) => void) | null,
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

// Radix portal components render uncontrolled overlays; inline versions keep
// menu/dialog interactions deterministic in jsdom (repo convention — see
// panels/media/index.test.tsx). The dialog mock honors the `open` prop so
// closed dialogs stay unmounted like the real primitive.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  }) => (
    <div onClick={onClick}>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: ReactNode;
    onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    mocks.projectStoreState.setActiveProject.mockClear();
    mocks.projectStoreState.importProject.mockClear();
    mocks.projectStoreState.setProjectLocation.mockClear();
    mocks.appSettingsState.projectLocationDefaults.lastParentDir = "";
    mocks.appSettingsState.setProjectLocationDefaults.mockClear();
    mocks.setActiveTab.mockClear();
    mocks.switchProject.mockClear();
    mocks.selectDirectory.mockReset();
    mocks.prepare.mockReset();
    mocks.rename.mockReset();
    mocks.remove.mockReset();
    mocks.status.mockReset();
    mocks.move.mockReset();
    mocks.cancelMove.mockReset();
    mocks.importFolder.mockReset();
    mocks.progressListener = null;
    mocks.onMoveProgress.mockReset().mockImplementation((cb: (event: unknown) => void) => {
      mocks.progressListener = cb;
      return () => {
        mocks.progressListener = null;
      };
    });
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
    mocks.toastWarning.mockClear();
    mocks.getFileStorageBridge.mockReset().mockReturnValue(undefined);
    mocks.getProjectFolderBridge.mockReset().mockReturnValue({
      prepare: mocks.prepare,
      rename: mocks.rename,
      remove: mocks.remove,
      status: mocks.status,
      move: mocks.move,
      cancelMove: mocks.cancelMove,
      importFolder: mocks.importFolder,
      onMoveProgress: mocks.onMoveProgress,
    });
    mocks.getStorageManagerBridge.mockReset().mockReturnValue({ selectDirectory: mocks.selectDirectory });
  });

  afterEach(cleanup);

  function cardOf(projectId: string): HTMLElement {
    const card = document.querySelector<HTMLElement>(`[data-project-card="${projectId}"]`);
    if (!card) throw new Error(`project card not found: ${projectId}`);
    return card;
  }

  function clickCardMenuItem(projectId: string, label: string) {
    fireEvent.click(within(cardOf(projectId)).getByText(label));
  }

  function emitMoveProgress(event: MoveProgressEvent) {
    mocks.progressListener?.(event);
  }

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
        description: "/gone/道劫——可在项目列表使用「导入项目」重新挂接该文件夹",
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

  // ==================== R3 补欠:重命名 ====================

  it("renames an external project folder and syncs the registry location", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-ext", name: "道劫", createdAt: 1, updatedAt: 2, location: "/old/parent/道劫" },
    ];
    mocks.rename.mockResolvedValue({ ok: true, location: "/old/parent/新名字" });

    render(<Dashboard />);
    clickCardMenuItem("p-ext", "重命名");
    fireEvent.change(screen.getByPlaceholderText("输入新名称..."), { target: { value: "新名字" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() => expect(mocks.rename).toHaveBeenCalledWith("p-ext", "新名字"));
    await waitFor(() =>
      expect(mocks.projectStoreState.projects[0]?.location).toBe("/old/parent/新名字"),
    );
    expect(mocks.projectStoreState.renameProject).toHaveBeenCalledWith("p-ext", "新名字");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("项目已重命名");
  });

  it("keeps the external project unchanged when the folder rename fails", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-ext", name: "道劫", createdAt: 1, updatedAt: 2, location: "/old/parent/道劫" },
    ];
    mocks.rename.mockResolvedValue({ ok: false, message: "文件夹名冲突" });

    render(<Dashboard />);
    clickCardMenuItem("p-ext", "重命名");
    fireEvent.change(screen.getByPlaceholderText("输入新名称..."), { target: { value: "新名字" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("重命名失败", { description: "文件夹名冲突" }),
    );
    expect(mocks.projectStoreState.renameProject).not.toHaveBeenCalled();
    expect(mocks.projectStoreState.projects[0]?.name).toBe("道劫");
    expect(mocks.projectStoreState.projects[0]?.location).toBe("/old/parent/道劫");
  });

  it("renames legacy (NO_LOCATION) projects in the registry only, without the folder bridge", async () => {
    render(<Dashboard />);
    clickCardMenuItem("p-legacy", "重命名");
    fireEvent.change(screen.getByPlaceholderText("输入新名称..."), { target: { value: "新名字" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));

    await waitFor(() =>
      expect(mocks.projectStoreState.renameProject).toHaveBeenCalledWith("p-legacy", "新名字"),
    );
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("项目已重命名");
  });

  // ==================== R3 补欠:删除 ====================

  it("deletes an external project: removes the folder first, then the registry entry", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-ext", name: "道劫", createdAt: 1, updatedAt: 2, location: "/gone/道劫" },
    ];
    mocks.remove.mockResolvedValue({ ok: true });

    render(<Dashboard />);
    clickCardMenuItem("p-ext", "删除");
    expect(screen.getByText("确认删除项目文件夹")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("p-ext"));
    await waitFor(() => expect(mocks.projectStoreState.deleteProject).toHaveBeenCalledWith("p-ext"));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("已删除 1 个项目"));
  });

  it("keeps the registry entry when the external folder removal fails", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-ext", name: "道劫", createdAt: 1, updatedAt: 2, location: "/gone/道劫" },
    ];
    mocks.remove.mockResolvedValue({ ok: false, message: "目录被占用" });

    render(<Dashboard />);
    clickCardMenuItem("p-ext", "删除");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("删除「道劫」的文件夹失败", {
        description: "目录被占用",
      }),
    );
    expect(mocks.projectStoreState.deleteProject).not.toHaveBeenCalled();
    expect(mocks.projectStoreState.projects[0]?.id).toBe("p-ext");
  });

  // ==================== R3 补欠:复制(候选名冲突自动 -2 后缀) ====================

  it("duplicates an external project retrying the copy folder name with a -2 suffix", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-dup", name: "道劫", createdAt: 1, updatedAt: 2, location: "/Users/x/Project/IP/道劫" },
    ];
    mocks.projectStoreState.activeProjectId = "p-dup";
    const storeFiles = new Map<string, string>([
      ["_p/p-dup/tts", JSON.stringify({ state: { activeProjectId: "p-dup", projects: { "p-dup": {} } } })],
      ["_p/p-dup/script", JSON.stringify({ state: { projects: { "p-dup": { title: "道劫" } } } })],
    ]);
    mocks.getFileStorageBridge.mockReturnValue({
      getItem: async (key: string) => storeFiles.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        storeFiles.set(key, value);
        return true;
      },
      listKeys: async (prefix: string) =>
        [...storeFiles.keys()].filter((key) => key.startsWith(prefix)),
    });
    mocks.prepare.mockImplementation(
      async (_projectId: string, parentDir: string, projectName: string) => {
        if (projectName === "道劫 (副本)") {
          return { ok: false as const, code: "CONFLICT" as const, message: "文件夹已存在" };
        }
        return { ok: true as const, location: `${parentDir}/${projectName}` };
      },
    );

    render(<Dashboard />);
    clickCardMenuItem("p-dup", "复制项目");

    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
    expect(mocks.prepare).toHaveBeenLastCalledWith(
      expect.any(String),
      "/Users/x/Project/IP",
      "道劫 (副本)-2",
    );
    await waitFor(() =>
      expect(mocks.projectStoreState.projects[0]).toMatchObject({
        name: "道劫 (副本)-2",
        location: "/Users/x/Project/IP/道劫 (副本)-2",
      }),
    );
    // 复制流程不改 activeProjectId;结束后重置以便下次打开走完整 switchProject。
    expect(mocks.projectStoreState.setActiveProject).toHaveBeenCalledWith(null);
    expect(mocks.projectStoreState.activeProjectId).toBe("p-dup");
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("已复制项目「道劫」(2 个数据文件)"));
  });

  // ==================== 二期:移动 ====================

  it("moves the active external project with progress frames, registry sync, and active restore", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-move", name: "道劫", createdAt: 1, updatedAt: 2, location: "/old/parent/道劫" },
    ];
    mocks.projectStoreState.activeProjectId = "p-move";
    const moveDeferred = deferred<ProjectFolderMoveResult>();
    mocks.move.mockReturnValue(moveDeferred.promise);
    mocks.selectDirectory.mockResolvedValue("/new/parent");

    render(<Dashboard />);
    clickCardMenuItem("p-move", "移动到…");
    expect(screen.getByText("移动项目")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "选择目标位置…" }));
    await waitFor(() => expect(mocks.selectDirectory).toHaveBeenCalledWith("/old/parent"));
    await waitFor(() => expect(mocks.move).toHaveBeenCalledWith("p-move", "道劫", "/new/parent"));
    await waitFor(() => expect(screen.getByText("正在移动「道劫」")).toBeTruthy());
    // OQ3:移动前先退出 active 项目。
    expect(mocks.projectStoreState.setActiveProject).toHaveBeenCalledWith(null);

    // 进度两帧:copying 50% → verifying 100%(其他 projectId 的事件被过滤)。
    act(() => {
      emitMoveProgress({
        projectId: "p-move",
        phase: "copying",
        filesDone: 5,
        filesTotal: 10,
        bytesDone: 1024,
        bytesTotal: 2048,
      });
      emitMoveProgress({
        projectId: "p-other",
        phase: "finalizing",
        filesDone: 0,
        filesTotal: 0,
        bytesDone: 0,
        bytesTotal: 0,
      });
    });
    expect(screen.getByText(/正在复制文件…/)).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();

    act(() => {
      emitMoveProgress({
        projectId: "p-move",
        phase: "verifying",
        filesDone: 10,
        filesTotal: 10,
        bytesDone: 2048,
        bytesTotal: 2048,
      });
    });
    expect(screen.getByText(/正在校验文件…/)).toBeTruthy();
    expect(screen.getByText(/100%/)).toBeTruthy();

    moveDeferred.resolve({ ok: true, location: "/new/parent/道劫", mode: "renamed" });
    await waitFor(() =>
      expect(mocks.projectStoreState.setProjectLocation).toHaveBeenCalledWith("p-move", "/new/parent/道劫"),
    );
    expect(mocks.appSettingsState.setProjectLocationDefaults).toHaveBeenCalledWith({
      lastParentDir: "/new/parent",
    });
    expect(mocks.projectStoreState.setActiveProject).toHaveBeenLastCalledWith("p-move");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已移动「道劫」到新位置", {
      description: "/new/parent/道劫",
    });
    await waitFor(() => expect(screen.queryByText(/正在移动/)).toBeNull());
  });

  it("restores the active project and keeps the old location when the move is cancelled", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-move", name: "道劫", createdAt: 1, updatedAt: 2, location: "/old/parent/道劫" },
    ];
    mocks.projectStoreState.activeProjectId = "p-move";
    const moveDeferred = deferred<ProjectFolderMoveResult>();
    mocks.move.mockReturnValue(moveDeferred.promise);
    mocks.selectDirectory.mockResolvedValue("/new/parent");

    render(<Dashboard />);
    clickCardMenuItem("p-move", "移动到…");
    fireEvent.click(screen.getByRole("button", { name: "选择目标位置…" }));
    await waitFor(() => expect(mocks.move).toHaveBeenCalledWith("p-move", "道劫", "/new/parent"));

    // 取消按钮转发 cancelMove,主进程随后以 CANCELLED 结束 move。
    fireEvent.click(screen.getByRole("button", { name: "取消移动" }));
    await waitFor(() => expect(mocks.cancelMove).toHaveBeenCalledWith("p-move"));

    moveDeferred.resolve({ ok: false, code: "CANCELLED" });
    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledWith("已取消移动项目"));
    expect(mocks.projectStoreState.setProjectLocation).not.toHaveBeenCalled();
    expect(mocks.projectStoreState.setActiveProject).toHaveBeenLastCalledWith("p-move");
    await waitFor(() => expect(screen.queryByText(/正在移动/)).toBeNull());
  });

  // ==================== 二期:导入 ====================

  it("imports an existing project folder from the empty state", async () => {
    mocks.projectStoreState.projects = [];
    mocks.selectDirectory.mockResolvedValue("/Users/x/Import/外部项目");
    mocks.importFolder.mockResolvedValue({
      ok: true,
      project: { id: "p-imported", name: "外部项目", location: "/Users/x/Import/外部项目" },
    });

    render(<Dashboard />);
    // 头部与空态各有一个「导入项目」入口。
    const importButtons = screen.getAllByRole("button", { name: "导入项目" });
    expect(importButtons).toHaveLength(2);
    fireEvent.click(importButtons[1]);

    await waitFor(() => expect(mocks.importFolder).toHaveBeenCalledWith("/Users/x/Import/外部项目"));
    await waitFor(() =>
      expect(mocks.projectStoreState.importProject).toHaveBeenCalledWith({
        id: "p-imported",
        name: "外部项目",
        location: "/Users/x/Import/外部项目",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已导入「外部项目」", {
      description: "/Users/x/Import/外部项目",
    });
  });

  it("warns and highlights the card when importing an already-registered folder", async () => {
    mocks.projectStoreState.projects = [
      { id: "p-legacy", name: "旧项目", createdAt: 1, updatedAt: 1 },
    ];
    mocks.selectDirectory.mockResolvedValue("/dup/旧项目");
    mocks.importFolder.mockResolvedValue({
      ok: false,
      code: "ALREADY_REGISTERED",
      existingProjectId: "p-legacy",
    });

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "导入项目" }));

    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledWith("该项目已在列表中"));
    expect(mocks.projectStoreState.importProject).not.toHaveBeenCalled();
    await waitFor(() => expect(cardOf("p-legacy").className).toContain("ring-primary"));
  });
});
