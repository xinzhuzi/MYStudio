// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ArtifactRecord } from "@/types/artifacts";
import { createArtifactDeletionPlan } from "@/stores/artifacts/artifact-store";
import { ArtifactCenter } from "./ArtifactCenter";

afterEach(() => cleanup());

const storeState = {
  startScan: vi.fn(),
  finishScan: vi.fn(),
  setError: vi.fn(),
  getFilteredArtifacts: () => [],
};

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: (selector: (state: { activeProjectId: string; projects: Array<{ id: string; name: string }> }) => unknown) =>
    selector({ activeProjectId: "project-1", projects: [{ id: "project-1", name: "项目一" }] }),
}));

vi.mock("@/stores/artifacts/artifact-store", () => ({
  useArtifactStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  createArtifactDeletionPlan: vi.fn().mockResolvedValue({ success: true, data: { planId: "plan-1", scope: "artifacts", executionAllowed: true, blockerItems: [], deleteItems: [], migrateItems: [] } }),
  loadArtifactInventory: vi.fn(),
  updateArtifactMetadata: vi.fn(),
}));

vi.mock("@/components/ui/tabs", () => {
  let onValueChange: ((value: string) => void) | undefined;
  return {
  Tabs: ({ onValueChange: nextOnValueChange, children }: { onValueChange?: (value: string) => void; children: ReactNode }) => {
    onValueChange = nextOnValueChange;
    return <div>{children}</div>;
  },
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children: ReactNode }) => (
    <button type="button" onClick={() => onValueChange?.(value)} data-tab={value}>{children}</button>
  ),
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

vi.mock("./artifact-detail", () => ({
  ArtifactDetailPanel: () => <div data-testid="artifact-detail">产物详情</div>,
}));

vi.mock("./ArtifactDeleteDialog", () => ({
  ArtifactDeleteDialog: () => null,
}));

vi.mock("./index", () => ({
  MediaView: () => <div data-testid="media-library-view">媒体库</div>,
}));

const artifact: ArtifactRecord = {
  id: "storyboard:storyboard-item:shot-001",
  projectId: "project-1",
  chapterId: "chapter-001",
  stage: "storyboard",
  kind: "storyboard-item",
  state: "active",
  name: "shot-001",
  createdAt: 1,
  updatedAt: 1,
  bytes: 128,
  physicalRefs: [],
  upstreamIds: [],
  downstreamIds: [],
  deletePolicy: "delete-exclusive-downstream",
};

describe("ArtifactCenter", () => {
  it("shows workflow artifacts and preserves the media-library tab", () => {
    render(
      <ArtifactCenter
        mockArtifacts={[artifact]}
        mockProjects={[{ id: "project-1", name: "项目一", stages: [{ id: "storyboard", label: "分镜设计", count: 1 }] }]}
      />,
    );

    expect(screen.getByText("工作流产物")).toBeTruthy();
    expect(screen.getByText("shot-001")).toBeTruthy();

    // The middle "工作流阶段" column was removed; its header must not render.
    expect(screen.queryByText("工作流阶段")).toBeNull();
    // Default-select the first chapter so a chapter is always active. Pin the
    // selection STATE (not just the label): the "删除当前章节" button is disabled
    // when no chapter is selected, so it being enabled proves the default-select
    // effect ran and set selectedChapterId.
    expect(screen.getByText("第 chapter-001 章")).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除当前章节" }).hasAttribute("disabled")).toBe(false);

    // The FilterBar stage dropdown offers ONLY the 6 fixed stages (not all 13).
    const stageSelect = screen
      .getAllByRole("combobox")
      .find((select) => [...select.querySelectorAll("option")].some((opt) => (opt.textContent ?? "") === "所有阶段")) as HTMLSelectElement;
    const stageValues = [...stageSelect.querySelectorAll("option")].map((opt) => (opt as HTMLOptionElement).value);
    expect(stageValues).toEqual(["all", "novel", "storyboard", "image", "production", "export", "media-library"]);
    // The 7 non-fixed stages must NOT reappear in the dropdown.
    for (const dropped of ["analysis", "script", "assets", "voice", "editing", "remotion", "backup"]) {
      expect(stageValues).not.toContain(dropped);
    }

    fireEvent.click(screen.getByRole("button", { name: "可交付物" }));
    expect(screen.getByTestId("media-library-view")).toBeTruthy();
  });

  it("default-selects the __none__ bucket for un-chaptered artifacts and keeps row checkboxes usable", () => {
    // A project whose artifacts have NO chapter fall into the synthetic "__none__"
    // bucket. The default-select effect picks it (so a chapter is always active),
    // but the per-row checkbox guard and "删除当前章节" button must handle the
    // sentinel correctly: rows stay selectable, chapter-scope delete is disabled.
    const unchaptered: ArtifactRecord = {
      ...artifact,
      id: "export:export-video:no-chapter",
      chapterId: undefined,
      physicalRefs: [],
    };
    render(
      <ArtifactCenter
        mockArtifacts={[unchaptered]}
        mockProjects={[{ id: "project-1", name: "项目一", stages: [{ id: "export", label: "导出输出", count: 1 }] }]}
      />,
    );

    // The synthetic 杂项 node is default-selected.
    expect(screen.getByText("杂项")).toBeTruthy();
    // "删除当前章节" is disabled for the __none__ sentinel (chapter-scope delete
    // is meaningless there and the backend would reject the synthetic id).
    expect(screen.getByRole("button", { name: "删除当前章节" }).hasAttribute("disabled")).toBe(true);
    // The per-row checkbox is NOT disabled (the guard allows __none__ selection).
    expect(screen.getByLabelText(`选择产物 ${unchaptered.name}`).hasAttribute("disabled")).toBe(false);
  });

  it("opens a physical folder from the center table and shows its files", () => {
    const fileArtifact: ArtifactRecord = {
      ...artifact,
      id: "export:export-video:file-001",
      name: "shot.png",
      stage: "export",
      kind: "export-video",
      bytes: 12,
      physicalRefs: [{ type: "project-file", path: "exports/shot.png", bytes: 12 }],
    };
    render(
      <ArtifactCenter
        mockArtifacts={[fileArtifact]}
        mockProjects={[{
          id: "project-1",
          name: "项目一",
          stages: [{ id: "export", label: "导出输出", count: 1 }],
          fileTree: [{ path: "exports", name: "exports", type: "directory", artifactIds: [fileArtifact.id], bytes: 12 }],
        }]}
      />,
    );

    // Drill into the directory via the center-table folder row (the tree→file
    // entry point was removed when the middle column became stages-only).
    fireEvent.click(screen.getByText("exports"));
    expect(screen.getByText("shot.png")).toBeTruthy();
    expect(screen.getByRole("button", { name: "返回上级目录" })).toBeTruthy();
  });

  it("keeps project folders visible and enterable when files have no artifact record", () => {
    render(
      <ArtifactCenter
        mockArtifacts={[{ ...artifact, physicalRefs: [] }]}
        mockProjects={[{
          id: "project-1",
          name: "项目一",
          stages: [],
          fileTree: [{
            path: "unindexed",
            name: "unindexed",
            type: "directory",
            children: [{ path: "unindexed/readme.txt", name: "readme.txt", type: "file" }],
          }],
        }]}
      />,
    );

    expect(screen.getByText("unindexed")).toBeTruthy();
    fireEvent.click(screen.getByText("unindexed"));
    expect(screen.getByRole("button", { name: "unindexed" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "返回上级目录" })).toBeTruthy();
  });

  it("renders a trash button on folder and file rows that opens a deletion plan", () => {
    // Folder node mirrors the real aggregated tree shape: the directory node
    // holds NO artifactIds itself — they live on the leaf file node and are
    // collected recursively by collectFileTreeArtifactIds. Cascading folder
    // delete must therefore gather the subtree's artifactIds, not the (empty)
    // folder-level list.
    const inner: ArtifactRecord = {
      ...artifact,
      id: "export:export-video:inner-001",
      name: "inner.png",
      stage: "export",
      kind: "export-video",
      physicalRefs: [{ type: "project-file", path: "exports/sub/inner.png", bytes: 8 }],
    };
    const planMock = vi.mocked(createArtifactDeletionPlan);
    planMock.mockClear();

    render(
      <ArtifactCenter
        mockArtifacts={[inner]}
        mockProjects={[{
          id: "project-1",
          name: "项目一",
          stages: [{ id: "export", label: "导出输出", count: 1 }],
          fileTree: [{
            path: "exports",
            name: "exports",
            type: "directory",
            artifactIds: [],
            children: [
              { path: "exports/sub", name: "sub", type: "directory", artifactIds: [] },
              { path: "exports/sub/inner.png", name: "inner.png", type: "file", artifactIds: [inner.id], bytes: 8 },
            ],
          }],
        }]}
      />,
    );

    // Root folder row exposes a trash button whose aria-label announces the
    // cascade ("及内部全部").
    const folderTrash = screen.getByRole("button", { name: "删除文件夹 exports 及内部全部" });
    expect(folderTrash).toBeTruthy();
    fireEvent.click(folderTrash);
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "artifacts", artifactIds: [inner.id], chapterId: "" }),
    );

    // Drill into the folder; the file row also exposes its own trash button.
    fireEvent.click(screen.getByText("exports"));
    fireEvent.click(screen.getByText("sub"));
    const fileTrash = screen.getByRole("button", { name: "删除产物 inner.png" });
    expect(fileTrash).toBeTruthy();
    planMock.mockClear();
    fireEvent.click(fileTrash);
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "artifacts", artifactIds: [inner.id], chapterId: "" }),
    );
  });
});
