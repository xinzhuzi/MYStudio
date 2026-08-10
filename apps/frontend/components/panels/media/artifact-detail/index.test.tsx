// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ArtifactRecord } from "@/types/artifacts";
import { ArtifactDetailPanel } from ".";

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div data-testid="artifact-sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
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

    fireEvent.click(screen.getByTitle("在产物中心打开所在文件夹"));

    expect(onOpenFolder).toHaveBeenCalledWith("exports/chapter-001");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
