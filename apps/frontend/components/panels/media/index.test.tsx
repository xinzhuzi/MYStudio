// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaFile, MediaFolder } from "@/types/media";
import { MediaView } from "./index";

const mocks = vi.hoisted(() => ({
  activeProject: { id: "project-1" } as { id: string } | null,
  shareMedia: false,
  currentFolderId: null as string | null,
  mediaFiles: [] as MediaFile[],
  folders: [] as MediaFolder[],
  addMediaFile: vi.fn(),
  removeMediaFile: vi.fn(),
  addFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  setCurrentFolder: vi.fn(),
  renameMediaFile: vi.fn(),
  moveToFolder: vi.fn(),
  getOrCreateCategoryFolder: vi.fn(() => "upload-folder"),
  setPreviewItem: vi.fn(),
  setStoryboardImage: vi.fn(),
  setStoryboardStatus: vi.fn(),
  setProjectFolderId: vi.fn(),
  setActiveTab: vi.fn(),
}));

vi.mock("@/stores/media/media-store", () => ({
  SYSTEM_CATEGORIES: [],
  generateVideoThumbnail: vi.fn(),
  getMediaDuration: vi.fn(),
  useMediaStore: () => ({
    mediaFiles: mocks.mediaFiles,
    folders: mocks.folders,
    currentFolderId: mocks.currentFolderId,
    addMediaFile: mocks.addMediaFile,
    removeMediaFile: mocks.removeMediaFile,
    addFolder: mocks.addFolder,
    renameFolder: mocks.renameFolder,
    deleteFolder: mocks.deleteFolder,
    setCurrentFolder: mocks.setCurrentFolder,
    renameMediaFile: mocks.renameMediaFile,
    moveToFolder: mocks.moveToFolder,
    getOrCreateCategoryFolder: mocks.getOrCreateCategoryFolder,
  }),
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: () => ({ activeProject: mocks.activeProject }),
}));

vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: () => ({
    resourceSharing: { shareMedia: mocks.shareMedia },
  }),
}));

vi.mock("@/stores/playback/preview-store", () => ({
  usePreviewStore: () => ({ setPreviewItem: mocks.setPreviewItem }),
}));

vi.mock("@/stores/director/director-store", () => {
  const useDirectorStore = Object.assign(
    () => ({
      setStoryboardImage: mocks.setStoryboardImage,
      setStoryboardStatus: mocks.setStoryboardStatus,
      setProjectFolderId: mocks.setProjectFolderId,
    }),
    {
      getState: () => ({
        setSplitScenes: vi.fn(),
        setStoryboardConfig: vi.fn(),
      }),
    },
  );
  return { useDirectorStore };
});

vi.mock("@/stores/navigation/media-panel-store", () => ({
  useMediaPanelStore: () => ({ setActiveTab: mocks.setActiveTab }),
}));

vi.mock("@/lib/media/media-processing", () => ({
  processMediaFiles: vi.fn(),
}));

vi.mock("./media-context-menus", () => ({
  FolderContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  MediaItemWithContextMenu: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  getFolderIcon: () => () => <span />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}));

beforeEach(() => {
  mocks.activeProject = { id: "project-1" };
  mocks.shareMedia = false;
  mocks.currentFolderId = null;
  mocks.mediaFiles = [];
  mocks.folders = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MediaView", () => {
  it("mounts the empty library without starting media processing", () => {
    render(<MediaView />);

    expect(screen.getByText("0 文件夹, 0 文件")).toBeTruthy();
    expect(screen.getByText("拖放文件到这里")).toBeTruthy();
    expect(screen.getByText("或点击上传按钮")).toBeTruthy();
  });

  it("opens the hidden file picker from the upload action", () => {
    const { container } = render(<MediaView />);
    const fileInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(fileInput).not.toBeNull();
    const click = vi.spyOn(fileInput!, "click");

    fireEvent.click(screen.getByRole("button", { name: "上传" }));

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("creates a project-scoped folder from the controlled dialog", () => {
    const { container } = render(<MediaView />);
    const folderButton = container
      .querySelector("svg.lucide-folder-plus")
      ?.closest("button");
    expect(folderButton).not.toBeNull();

    fireEvent.click(folderButton!);
    fireEvent.change(screen.getByPlaceholderText("文件夹名称"), {
      target: { value: "素材" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(mocks.addFolder).toHaveBeenCalledWith("素材", null, "project-1");
  });

  it("switches populated media into list mode and previews the selected item", () => {
    mocks.folders = [
      {
        id: "upload-folder",
        name: "上传文件",
        parentId: null,
        isSystem: true,
        createdAt: 1,
      },
    ];
    mocks.mediaFiles = [
      {
        id: "video-1",
        name: "演示片段",
        type: "video",
        url: "local-video://demo.mp4",
        duration: 65,
        folderId: null,
        projectId: "project-1",
      },
    ];
    const { container } = render(<MediaView />);

    expect(screen.getByText("上传文件")).toBeTruthy();
    expect(screen.getByText("演示片段")).toBeTruthy();
    const listButton = container
      .querySelector("svg.lucide-list")
      ?.closest("button");
    expect(listButton).not.toBeNull();

    fireEvent.click(listButton!);
    expect(screen.getByText("video · 1:05")).toBeTruthy();
    fireEvent.click(screen.getByText("演示片段"));

    expect(mocks.setPreviewItem).toHaveBeenCalledWith({
      type: "video",
      url: "local-video://demo.mp4",
      name: "演示片段",
    });
  });

  it("drops breadcrumbs that become invisible after a project switch", () => {
    mocks.currentFolderId = "child";
    mocks.folders = [
      {
        id: "parent",
        name: "项目一目录",
        parentId: null,
        projectId: "project-1",
        createdAt: 1,
      },
      {
        id: "child",
        name: "项目一子目录",
        parentId: "parent",
        projectId: "project-1",
        createdAt: 2,
      },
    ];
    const { rerender } = render(<MediaView />);

    expect(screen.getByRole("button", { name: "项目一目录" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "项目一子目录" })).toBeTruthy();

    mocks.activeProject = { id: "project-2" };
    rerender(<MediaView />);

    expect(
      screen.queryByRole("button", { name: "项目一目录" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "项目一子目录" }),
    ).toBeNull();
    expect(mocks.setCurrentFolder).toHaveBeenCalledWith(null);
  });
});
