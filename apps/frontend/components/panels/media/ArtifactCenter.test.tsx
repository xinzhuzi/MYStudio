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
        mockProjects={[{ id: "project-1", name: "项目一", stages: [{ id: "storyboard", label: "分镜视频生成", count: 1 }] }]}
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
    expect(screen.getByText("第 1 章")).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除当前章节" }).hasAttribute("disabled")).toBe(false);

    // The FilterBar stage dropdown offers ALL 13 artifact stages (FIXED_NAV_STAGES),
    // so every workflow stage is filterable — including the previously-hidden
    // middle stages (analysis/script/assets/voice/editing/remotion) and backup.
    const stageSelect = screen
      .getAllByRole("combobox")
      .find((select) => [...select.querySelectorAll("option")].some((opt) => (opt.textContent ?? "") === "所有阶段")) as HTMLSelectElement;
    const stageValues = [...stageSelect.querySelectorAll("option")].map((opt) => (opt as HTMLOptionElement).value);
    expect(stageValues).toEqual([
      "all", "novel", "analysis", "script", "assets", "storyboard", "image",
      "voice", "production", "editing", "remotion", "export", "media-library", "backup",
    ]);

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

  it("collapses backup-only artifacts into a 备份 bucket and beautifies chapter labels", () => {
    // A backup-only artifact (every physicalRef is type "backup") must land in
    // the synthetic "__backup__" bucket labelled "备份", NOT spawn its own
    // "第 episode-1 章" / "第 smoke-chapter-1 章" category. This is the fix for
    // stale ids leaking out of historical .bak-/.codex- backups. A live
    // chapter-001 artifact in the same project must still render as "第 1 章"
    // (digits extracted, "chapter-" prefix dropped).
    const liveChapter: ArtifactRecord = {
      ...artifact,
      id: "storyboard:storyboard-item:live-001",
      chapterId: "chapter-001",
      physicalRefs: [{ type: "project-file", path: "workflow-images/chapter-001/live.png", bytes: 64 }],
    };
    const backupOnly: ArtifactRecord = {
      ...artifact,
      id: "storyboard:storyboard-item:ep1-from-backup",
      chapterId: "episode-1",
      physicalRefs: [{ type: "backup", path: "studio-workflow-store.json.codex-white-screen-test-backup", bytes: 32 }],
    };
    render(
      <ArtifactCenter
        mockArtifacts={[liveChapter, backupOnly]}
        mockProjects={[{ id: "project-1", name: "项目一", stages: [{ id: "storyboard", label: "分镜视频生成", count: 2 }] }]}
      />,
    );

    // Live chapter renders with extracted digits (chapter-001 → "第 1 章"),
    // NOT the raw "第 chapter-001 章".
    expect(screen.getByText("第 1 章")).toBeTruthy();
    expect(screen.queryByText("第 chapter-001 章")).toBeNull();
    // The stale backup id does NOT spawn its own chapter category.
    expect(screen.queryByText("第 episode-1 章")).toBeNull();
    // Backup-only artifact is collapsed into the synthetic 备份 bucket.
    expect(screen.getByText("备份")).toBeTruthy();
  });

  it("flattens artifacts by stage instead of showing a folder tree", () => {
    // The folder-navigation view was removed: artifacts are now flattened out
    // of their physical directory tree and grouped under their 13 ArtifactStage
    // headers in STAGE_LABELS order. No folder rows, no breadcrumb, no
    // "返回上级目录" button — the directory is no longer a navigable dimension.
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

    // The artifact is rendered flat under its stage header (the same label also
    // appears in the left chapter tree, so matchAll), even though its
    // physicalRef lives under exports/. Folder navigation is gone.
    expect(screen.getAllByText("导出输出").length).toBeGreaterThan(0);
    expect(screen.getByText("shot.png")).toBeTruthy();
    expect(screen.queryByText("exports")).toBeNull();
    expect(screen.queryByRole("button", { name: "返回上级目录" })).toBeNull();
  });

  it("renders a trash button on every artifact row that opens a deletion plan", () => {
    // Folder cascading delete was removed with the folder view; per-artifact
    // delete remains on each row and routes to the deletion plan with the
    // row's own artifactId.
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

    // No folder trash button anymore — only the per-artifact row button.
    expect(screen.queryByRole("button", { name: /删除文件夹/ })).toBeNull();
    const fileTrash = screen.getByRole("button", { name: "删除产物 inner.png" });
    expect(fileTrash).toBeTruthy();
    fireEvent.click(fileTrash);
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "artifacts", artifactIds: [inner.id], chapterId: "" }),
    );
  });
});
