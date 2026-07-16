// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeTreeHeader } from "./episode-tree-header";

afterEach(cleanup);

describe("EpisodeTreeHeader", () => {
  it("forwards tabs, filters, and structure actions", () => {
    const onActiveTabChange = vi.fn();
    const onFilterChange = vi.fn();
    const onCalibrateScenes = vi.fn();
    const onRegenerateAllShots = vi.fn();
    const onAddEpisode = vi.fn();
    render(
      <EpisodeTreeHeader
        activeTab="structure"
        onActiveTabChange={onActiveTabChange}
        title="道劫"
        genre="玄幻"
        overallProgress="3/9"
        filter="all"
        onFilterChange={onFilterChange}
        onCalibrateScenes={onCalibrateScenes}
        onRegenerateAllShots={onRegenerateAllShots}
        onAddEpisode={onAddEpisode}
      />,
    );

    expect(screen.getByText("道劫")).toBeTruthy();
    expect(screen.getByText("玄幻")).toBeTruthy();
    expect(screen.getByText("进度: 3/9")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "预告片" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "未完成" }));
    fireEvent.click(screen.getByRole("button", { name: "AI场景校准" }));
    fireEvent.click(screen.getByRole("button", { name: "更新全部" }));
    fireEvent.click(screen.getByRole("button", { name: "新建集" }));

    expect(onActiveTabChange).toHaveBeenCalledWith("trailer");
    expect(onFilterChange).toHaveBeenCalledWith("pending");
    expect(onCalibrateScenes).toHaveBeenCalledOnce();
    expect(onRegenerateAllShots).toHaveBeenCalledOnce();
    expect(onAddEpisode).toHaveBeenCalledOnce();
  });

  it("hides structure metadata on the trailer tab and disables active calibration", () => {
    const { rerender } = render(
      <EpisodeTreeHeader
        activeTab="structure"
        onActiveTabChange={vi.fn()}
        title="道劫"
        overallProgress="0/0"
        filter="all"
        onFilterChange={vi.fn()}
        onCalibrateScenes={vi.fn()}
        sceneCalibrationStatus="calibrating"
        onAddEpisode={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "校准中..." }).hasAttribute("disabled")).toBe(true);

    rerender(
      <EpisodeTreeHeader
        activeTab="trailer"
        onActiveTabChange={vi.fn()}
        title="道劫"
        overallProgress="0/0"
        filter="all"
        onFilterChange={vi.fn()}
        onAddEpisode={vi.fn()}
      />,
    );
    expect(screen.queryByText("道劫")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建集" })).toBeNull();
  });
});
