// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "@/types/artifacts";
import { ArtifactTable } from "./ArtifactTable";

const artifact: ArtifactRecord = {
  id: "artifact-table-test",
  projectId: "project-1",
  chapterId: "chapter-001",
  stage: "storyboard",
  kind: "storyboard-item",
  state: "active",
  name: "shot-001",
  createdAt: 1,
  updatedAt: 1,
  bytes: 12,
  physicalRefs: [],
  upstreamIds: [],
  downstreamIds: [],
  deletePolicy: "delete-exclusive-downstream",
};

describe("ArtifactTable", () => {
  it("forwards stage and state filter changes to the parent", () => {
    const onStageFilterChange = vi.fn();
    const onStateFilterChange = vi.fn();

    render(
      <ArtifactTable
        artifacts={[artifact]}
        onStageFilterChange={onStageFilterChange}
        onStateFilterChange={onStateFilterChange}
      />,
    );

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "image" } });
    fireEvent.change(selects[1], { target: { value: "blocked" } });

    expect(onStageFilterChange).toHaveBeenCalledWith("image");
    expect(onStateFilterChange).toHaveBeenCalledWith("blocked");
  });
});
