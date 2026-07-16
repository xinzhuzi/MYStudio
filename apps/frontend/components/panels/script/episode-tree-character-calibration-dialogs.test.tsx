// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeTreeCharacterCalibrationDialogs } from "./episode-tree-character-calibration-dialogs";

afterEach(cleanup);

describe("EpisodeTreeCharacterCalibrationDialogs", () => {
  it("removes and restores the cached full character before confirmation", async () => {
    const onConfirm = vi.fn();
    render(
      <EpisodeTreeCharacterCalibrationDialogs
        calibrationOpen
        pendingCharacters={[{ id: "char-1", name: "阿青", role: "主角", tags: ["protagonist"] }]}
        pendingFilteredCharacters={[]}
        onConfirm={onConfirm}
        filteredOpen={false}
        onFilteredOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("阿青")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("移除阿青"));
    fireEvent.click(screen.getByLabelText("恢复阿青"));
    fireEvent.click(screen.getByText("确认"));

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ id: "char-1", name: "阿青", role: "主角" }),
    ], []);
  });

  it("restores all filtered names and confirms an empty filtered list", async () => {
    const onConfirm = vi.fn();
    render(
      <EpisodeTreeCharacterCalibrationDialogs
        calibrationOpen
        pendingCharacters={[]}
        pendingFilteredCharacters={[{ name: "路人甲", reason: "群演" }]}
        onConfirm={onConfirm}
        filteredOpen={false}
        onFilteredOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("全部保留")).toBeTruthy());
    fireEvent.click(screen.getByText("全部保留"));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ name: "路人甲", tags: ["extra", "restored"] }),
    ], []);
  });

  it("keeps the historical filtered-character restore callback", () => {
    const onRestore = vi.fn();
    render(
      <EpisodeTreeCharacterCalibrationDialogs
        filteredOpen
        onFilteredOpenChange={vi.fn()}
        lastFilteredCharacters={[{ name: "旧角色", reason: "未出场" }]}
        onRestoreFilteredCharacter={onRestore}
      />,
    );
    fireEvent.click(screen.getByText("恢复"));
    expect(onRestore).toHaveBeenCalledWith("旧角色");
  });
});
