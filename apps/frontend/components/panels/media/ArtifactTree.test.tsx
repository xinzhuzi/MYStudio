// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactStage } from "@/types/artifacts";
import { ArtifactTree, type ArtifactTreeProject } from "./ArtifactTree";

const project: ArtifactTreeProject = {
  id: "project-1",
  name: "项目一",
  fileTree: [
    {
      path: "exports",
      name: "exports",
      type: "directory",
      children: [
        {
          path: "exports/chapter-001",
          name: "chapter-001",
          type: "directory",
          children: [{ path: "exports/chapter-001/final.mp4", name: "final.mp4", type: "file", artifactIds: ["artifact-1"] }],
        },
      ],
    },
  ],
  chapters: [{
    id: "chapter-001",
    label: "第 1 章",
    count: 1,
    stages: [{ id: "export" as ArtifactStage, label: "导出输出", count: 1 }],
  }],
};

describe("ArtifactTree", () => {
  it("renders project → local files → folders/files and chapter → stage branches", () => {
    const onExpandToggle = vi.fn();
    const onDirectoryClick = vi.fn();
    const onFileClick = vi.fn();
    const onChapterClick = vi.fn();
    const onStageClick = vi.fn();

    render(
      <ArtifactTree
        projects={[project]}
        activeProjectId="project-1"
        expandedNodes={new Set([
          "project:project-1",
          "files:project-1",
          "file:project-1:exports",
          "file:project-1:exports/chapter-001",
          "chapter:project-1:chapter-001",
        ])}
        onExpandToggle={onExpandToggle}
        onDirectoryClick={onDirectoryClick}
        onFileClick={onFileClick}
        onChapterClick={onChapterClick}
        onStageClick={onStageClick}
      />,
    );

    expect(screen.getByRole("treeitem", { name: /项目一/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /本地文件/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "exports" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: "chapter-001" })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /final\.mp4/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /第 1 章/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /导出输出/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("treeitem", { name: "exports" }));
    fireEvent.click(screen.getByRole("treeitem", { name: /final\.mp4/ }));
    fireEvent.click(screen.getByRole("treeitem", { name: /第 1 章/ }));
    fireEvent.click(screen.getByRole("treeitem", { name: /导出输出/ }));

    expect(onDirectoryClick).toHaveBeenCalledWith("exports");
    expect(onFileClick).toHaveBeenCalledWith("exports/chapter-001/final.mp4");
    expect(onChapterClick).toHaveBeenCalledWith("chapter-001");
    expect(onStageClick).toHaveBeenCalledWith("export", "chapter-001");

    fireEvent.click(screen.getAllByRole("button", { name: "折叠" })[0]);
    expect(onExpandToggle).toHaveBeenCalled();
  });
});
