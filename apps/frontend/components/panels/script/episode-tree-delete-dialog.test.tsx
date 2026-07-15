// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeTreeDeleteDialog } from "./episode-tree-delete-dialog";

afterEach(cleanup);

describe("EpisodeTreeDeleteDialog", () => {
  it("shows the episode cascade warning and confirms deletion", () => {
    const onConfirm = vi.fn();
    render(
      <EpisodeTreeDeleteDialog
        open
        item={{ type: "episode", name: "第一集" }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/第一集/).textContent).toContain("删除集将同时删除其下所有场景和分镜");
    fireEvent.click(screen.getByText("删除"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows only the scene cascade warning for a scene", () => {
    render(
      <EpisodeTreeDeleteDialog
        open
        item={{ type: "scene", name: "酒馆" }}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const description = screen.getByText(/酒馆/).textContent;
    expect(description).toContain("删除场景将同时删除其下所有分镜");
    expect(description).not.toContain("删除集将同时删除");
  });

  it("delegates cancel through the controlled open callback", () => {
    const onOpenChange = vi.fn();
    render(
      <EpisodeTreeDeleteDialog
        open
        item={{ type: "character", name: "阿青" }}
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("取消"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
