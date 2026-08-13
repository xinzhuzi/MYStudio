// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterTree } from "./ChapterTree";

afterEach(() => {
  cleanup();
});

describe("ChapterTree", () => {
  it("renders the empty state when chapters is empty", () => {
    render(<ChapterTree chapters={[]} />);
    expect(screen.getByText("当前项目没有章节产物")).toBeTruthy();
  });

  it("renders one row per chapter with label and count", () => {
    render(
      <ChapterTree
        chapters={[
          { id: "chapter-1", label: "第 chapter-1 章", count: 3 },
          { id: "chapter-2", label: "第 chapter-2 章", count: 5 },
        ]}
      />,
    );
    expect(screen.getByText("第 chapter-1 章")).toBeTruthy();
    expect(screen.getByText("第 chapter-2 章")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("calls onChapterClick with the chapter id when a row is clicked", () => {
    const onChapterClick = vi.fn();
    render(
      <ChapterTree
        chapters={[{ id: "chapter-1", label: "第 chapter-1 章", count: 1 }]}
        onChapterClick={onChapterClick}
      />,
    );
    fireEvent.click(screen.getByText("第 chapter-1 章"));
    expect(onChapterClick).toHaveBeenCalledWith("chapter-1");
  });

  it("calls onChapterClick on Enter keypress (role=treeitem)", () => {
    const onChapterClick = vi.fn();
    render(
      <ChapterTree
        chapters={[{ id: "chapter-1", label: "第 chapter-1 章", count: 1 }]}
        onChapterClick={onChapterClick}
      />,
    );
    const rows = screen.getAllByRole("treeitem");
    expect(rows).toHaveLength(1);
    fireEvent.keyDown(rows[0], { key: "Enter" });
    expect(onChapterClick).toHaveBeenCalledWith("chapter-1");
  });

  it("toggles selection highlight via selectedChapterId", () => {
    const { rerender } = render(
      <ChapterTree
        chapters={[{ id: "chapter-1", label: "第 chapter-1 章", count: 1 }]}
        selectedChapterId={null}
      />,
    );
    const rowsBefore = screen.getAllByRole("treeitem");
    expect(rowsBefore).toHaveLength(1);
    expect(rowsBefore[0].className).not.toContain("bg-primary/15");

    rerender(
      <ChapterTree
        chapters={[{ id: "chapter-1", label: "第 chapter-1 章", count: 1 }]}
        selectedChapterId="chapter-1"
      />,
    );
    const rowsAfter = screen.getAllByRole("treeitem");
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0].className).toContain("bg-primary/15");
  });

  it("renders the synthetic 杂项 bucket for the __none__ id", () => {
    render(
      <ChapterTree
        chapters={[{ id: "__none__", label: "杂项", count: 2 }]}
      />,
    );
    expect(screen.getByText("杂项")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
