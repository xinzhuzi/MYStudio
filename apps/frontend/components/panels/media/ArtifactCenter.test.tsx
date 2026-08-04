// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ArtifactRecord } from "@/types/artifacts";
import { ArtifactCenter } from "./ArtifactCenter";

const storeState = {
  startScan: vi.fn(),
  finishScan: vi.fn(),
  setError: vi.fn(),
  getFilteredArtifacts: () => [],
};

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: (selector: (state: { activeProjectId: string }) => unknown) => selector({ activeProjectId: "project-1" }),
}));

vi.mock("@/stores/artifacts/artifact-store", () => ({
  useArtifactStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  createArtifactDeletionPlan: vi.fn(),
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

vi.mock("./ArtifactTree", () => ({
  ArtifactTree: () => <div data-testid="artifact-tree">项目导航</div>,
}));

vi.mock("./ArtifactDetailPanel", () => ({
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
        mockProjects={[{ id: "project-1", name: "项目一", chapters: [{ id: "chapter-001", title: "第一章", stageCounts: { storyboard: 1 } }] }]}
      />,
    );

    expect(screen.getByText("工作流产物")).toBeTruthy();
    expect(screen.getByText("shot-001")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "媒体库" }));
    expect(screen.getByTestId("media-library-view")).toBeTruthy();
  });
});
