// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "@/types/artifacts";
import { ArtifactTable } from "./ArtifactTable";

afterEach(() => cleanup());

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

  it("renders a zero-byte artifact size as 0 B", () => {
    render(<ArtifactTable artifacts={[{ ...artifact, bytes: 0 }]} />);

    expect(screen.getByText("0 B")).toBeTruthy();
  });

  it("prevents selection from spanning projects or chapters", () => {
    const onSelectionChange = vi.fn();
    const chapterTwo = { ...artifact, id: "chapter-two", chapterId: "chapter-002", name: "shot-002" };

    const { rerender } = render(
      <ArtifactTable artifacts={[artifact, chapterTwo]} selectedIds={new Set()} onSelectionChange={onSelectionChange} />,
    );

    expect(screen.getByLabelText("选择全部产物").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText(`选择产物 ${artifact.name}`));
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set([artifact.id]));

    rerender(
      <ArtifactTable artifacts={[artifact, chapterTwo]} selectedIds={new Set([artifact.id])} onSelectionChange={onSelectionChange} />,
    );
    expect(screen.getByLabelText(`选择产物 ${chapterTwo.name}`).hasAttribute("disabled")).toBe(true);
  });
});
