// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeTreeEpisodeDialog } from "./episode-tree-episode-dialog";

afterEach(cleanup);

describe("EpisodeTreeEpisodeDialog", () => {
  it("preserves controlled edit fields and save behavior", () => {
    const onTitleChange = vi.fn();
    const onDescriptionChange = vi.fn();
    const onSave = vi.fn();
    render(
      <EpisodeTreeEpisodeDialog
        open
        mode="edit"
        title="第一集"
        description="旧简介"
        onOpenChange={vi.fn()}
        onTitleChange={onTitleChange}
        onDescriptionChange={onDescriptionChange}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("编辑集")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("第一集"), { target: { value: "新标题" } });
    fireEvent.change(screen.getByDisplayValue("旧简介"), { target: { value: "新简介" } });
    fireEvent.click(screen.getByText("保存"));
    expect(onTitleChange).toHaveBeenCalledWith("新标题");
    expect(onDescriptionChange).toHaveBeenCalledWith("新简介");
    expect(onSave).toHaveBeenCalled();
  });

  it("preserves create title and cancel close behavior", () => {
    const onOpenChange = vi.fn();
    render(
      <EpisodeTreeEpisodeDialog
        open
        mode="create"
        title="第二集"
        description=""
        onOpenChange={onOpenChange}
        onTitleChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("新建集")).toBeTruthy();
    fireEvent.click(screen.getByText("取消"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
