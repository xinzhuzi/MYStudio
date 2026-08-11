// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ArtifactRecord } from "@/types/artifacts";
import { ArtifactDetailPanel } from ".";
import { formatBytes } from "./helpers";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div data-testid="artifact-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../RefPreview", () => ({ RefPreview: () => <div data-testid="ref-preview" /> }));
vi.mock("./json-viewer", () => ({ JsonViewer: () => <div data-testid="json-viewer" /> }));

afterEach(() => cleanup());

const artifact: ArtifactRecord = {
  id: "export:export-video:detail-001",
  projectId: "project-1",
  chapterId: "chapter-001",
  stage: "export",
  kind: "export-video",
  state: "active",
  name: "shot.png",
  createdAt: 1,
  updatedAt: 1,
  bytes: 12,
  physicalRefs: [{ type: "project-file", path: "exports/chapter-001/shot.png", bytes: 12 }],
  upstreamIds: [],
  downstreamIds: [],
  deletePolicy: "delete-exclusive-downstream",
};

describe("ArtifactDetailPanel", () => {
  it("opens the containing folder in the artifact center instead of only the OS file manager", () => {
    const onOpenFolder = vi.fn();
    const onClose = vi.fn();

    render(
      <ArtifactDetailPanel
        artifact={artifact}
        isOpen
        onClose={onClose}
        onOpenFolder={onOpenFolder}
      />,
    );

    fireEvent.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "在产物中心打开文件夹",
      }),
    );

    expect(onOpenFolder).toHaveBeenCalledWith("exports/chapter-001");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a top-level folder action for live project-file URLs", () => {
    const onOpenFolder = vi.fn();
    render(
      <ArtifactDetailPanel
        artifact={{
          ...artifact,
          physicalRefs: [{
            type: "project-file",
            path: "project-file://project-1/exports/chapter-001/shot.png",
            bytes: 12,
          }],
        }}
        isOpen
        onClose={vi.fn()}
        onOpenFolder={onOpenFolder}
      />,
    );

    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "在产物中心打开文件夹" }));

    expect(onOpenFolder).toHaveBeenCalledWith("exports/chapter-001");
  });

  it("opens the containing physical folder in the OS file manager", async () => {
    const getAbsolutePath = vi.fn().mockResolvedValue("/tmp/project-1/exports/chapter-001/shot.png");
    const openPath = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal("projectFiles", { getAbsolutePath });
    vi.stubGlobal("electronAPI", { openPath });

    render(
      <ArtifactDetailPanel
        artifact={artifact}
        isOpen
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "弹出产物文件夹" }));

    await vi.waitFor(() => {
      expect(getAbsolutePath).toHaveBeenCalledWith("project-file://project-1/exports/chapter-001/shot.png");
      expect(openPath).toHaveBeenCalledWith("/tmp/project-1/exports/chapter-001");
    });
    vi.unstubAllGlobals();
  });

  it("offers the owning workflow as the only content-editing entry point", () => {
    const onOpenWorkflow = vi.fn();
    const workflowArtifact = { ...artifact, editRoute: "/script/episode/1" };

    render(
      <ArtifactDetailPanel
        artifact={workflowArtifact}
        isOpen
        onClose={vi.fn()}
        onOpenWorkflow={onOpenWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "前往所属工作流" }));
    expect(onOpenWorkflow).toHaveBeenCalledWith(workflowArtifact);
  });

  it("shows zero-byte metadata and physical references as 0 B", () => {
    const zeroByteArtifact = {
      ...artifact,
      bytes: 0,
      physicalRefs: [{ type: "project-file" as const, path: "exports/chapter-001/empty.json", bytes: 0 }],
    };

    render(
      <ArtifactDetailPanel
        artifact={zeroByteArtifact}
        isOpen
        onClose={vi.fn()}
      />,
    );

    expect(formatBytes(0)).toBe("0 B");
    expect(screen.getByText("0 B")).toBeTruthy();
  });
});
