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

  it("keeps a real-chapter row checkbox usable when chapterId is inferred from path", () => {
    // Regression (checkbox-disabled bug): the per-row checkbox `disabled` guard
    // used to compare the bare `artifact.chapterId` field against the selected
    // chapter, while the table FILTER uses `inferChapterId` (field-first, then
    // path inference from physicalRefs). When an artifact's chapterId field is
    // absent but its physicalRef path names a real chapter, it PASSES the filter
    // and shows up under that chapter — yet the old guard left its checkbox
    // greyed out (undefined !== "chapter-001"). The guard must use the SAME
    // inferChapterId resolution as the filter so such rows stay selectable.
    const pathInferred: ArtifactRecord = {
      ...artifact,
      id: "export:export-video:path-inferred",
      chapterId: undefined,
      physicalRefs: [{ type: "project-file", path: "exports/chapter-001/final.mp4", bytes: 64 }],
    };
    render(
      <ArtifactCenter
        mockArtifacts={[pathInferred]}
        mockProjects={[{ id: "project-1", name: "项目一", stages: [{ id: "export", label: "导出输出", count: 1 }] }]}
      />,
    );

    // The artifact shows under "第 1 章" (path-inferred chapter), proving it
    // passed the table filter.
    expect(screen.getByText("第 1 章")).toBeTruthy();
    expect(screen.getByText(pathInferred.name)).toBeTruthy();
    // The row checkbox is NOT disabled — same resolution as the filter, so a
    // path-inferred chapter match keeps the checkbox usable (the bug).
    const checkbox = screen.getByLabelText(`选择产物 ${pathInferred.name}`) as HTMLInputElement;
    expect(checkbox.hasAttribute("disabled")).toBe(false);
    // And toggling it actually selects the artifact.
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /删除选中 \(1\)/ })).toBeTruthy();
  });

  it("keeps the backup-bucket row checkbox usable when only backup-only artifacts exist", () => {
    // Regression (backup-bucket checkbox-disabled bug): when a project has ONLY
    // backup-only artifacts, the chapter list has a single "__backup__" node and
    // the default-select effect picks it. The per-row checkbox `disabled` guard
    // used to only exempt "__none__"; since inferChapterId never returns
    // "__backup__", the guard left every backup-bucket row greyed out even
    // though the filter (:367-372) shows them. The guard must exempt both
    // synthetic buckets so backup rows stay selectable too.
    const backupOnly: ArtifactRecord = {
      ...artifact,
      id: "storyboard:storyboard-item:backup-only-001",
      name: "backup-shot.png",
      chapterId: "episode-1",
      physicalRefs: [{ type: "backup", path: "studio.bak-123", bytes: 32 }],
    };
    render(
      <ArtifactCenter
        mockArtifacts={[backupOnly]}
        mockProjects={[{ id: "project-1", name: "项目一", stages: [{ id: "storyboard", label: "分镜视频生成", count: 1 }] }]}
      />,
    );

    // The backup-only artifact is folded into the synthetic 备份 bucket, which
    // is default-selected (sole chapter node).
    expect(screen.getByText("备份")).toBeTruthy();
    expect(screen.getByText(backupOnly.name)).toBeTruthy();
    // The row checkbox is NOT disabled (the bug exempted only __none__).
    const checkbox = screen.getByLabelText(`选择产物 ${backupOnly.name}`) as HTMLInputElement;
    expect(checkbox.hasAttribute("disabled")).toBe(false);
    // Toggling it selects the artifact and arms the bulk-delete button.
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /删除选中 \(1\)/ })).toBeTruthy();
  });

  it("strips the __backup__ sentinel before building the deletion plan (PLAN_INVALID regression)", () => {
    // Regression (backup-bucket delete bug): once the per-row checkbox was made
    // usable for the 备份 bucket, clicking "删除选中" used to pass the raw
    // "__backup__" sentinel as chapterId to createArtifactDeletionPlan. The
    // backend buildDeletionPlan rejects it ("Chapter not found in project
    // inventory: __backup__" / "Selected artifact ... is outside chapter
    // __backup__" — artifact-dependency-graph.ts:574/582), so the delete dialog
    // never opened and a red toast appeared instead. Both synthetic buckets
    // (__none__ and __backup__) must be stripped to "" for artifacts-scope
    // deletion (cross-chapter selection; IPC only requires chapterId for
    // chapter scope, artifact-management-ipc.ts:336).
    const backupOnly: ArtifactRecord = {
      ...artifact,
      id: "storyboard:storyboard-item:backup-delete-001",
      name: "backup-to-delete.png",
      chapterId: "episode-1",
      physicalRefs: [{ type: "backup", path: "studio.bak-456", bytes: 32 }],
    };
    const planMock = vi.mocked(createArtifactDeletionPlan);
    planMock.mockClear();

    render(
      <ArtifactCenter
        mockArtifacts={[backupOnly]}
        mockProjects={[{ id: "project-1", name: "项目一", stages: [{ id: "storyboard", label: "分镜视频生成", count: 1 }] }]}
      />,
    );

    // The 备份 bucket is the sole chapter node and is default-selected.
    expect(screen.getByText("备份")).toBeTruthy();
    // Select the backup-only artifact.
    const checkbox = screen.getByLabelText(`选择产物 ${backupOnly.name}`) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Click "删除选中" — must open the dialog, i.e. createArtifactDeletionPlan
    // is called with chapterId "" (sentinel stripped), NOT "__backup__".
    fireEvent.click(screen.getByRole("button", { name: /删除选中 \(1\)/ }));
    expect(planMock).toHaveBeenCalledTimes(1);
    expect(planMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: "artifacts",
      chapterId: "",
      artifactIds: [backupOnly.id],
    }));
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

  it("renders a trash button on every artifact row that opens a deletion plan", () => {
    // Per-artifact delete remains on each row and routes to the deletion plan
    // with the row's own artifactId. The directory-navigation layer was
    // removed; artifacts now render flat in the chapter-scoped table.
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
        }]}
      />,
    );

    // The row renders directly in the chapter-scoped table (no folder nav).
    const fileTrash = screen.getByRole("button", { name: "删除产物 inner.png" });
    expect(fileTrash).toBeTruthy();
    fireEvent.click(fileTrash);
    expect(planMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "artifacts", artifactIds: [inner.id], chapterId: "" }),
    );
  });
});
