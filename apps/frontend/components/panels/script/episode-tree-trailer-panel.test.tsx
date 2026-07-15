// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Shot } from "@/types/script";

import { EpisodeTreeTrailerPanel } from "./episode-tree-trailer-panel";

afterEach(cleanup);

const shot = (id: string, duration: number): Shot => ({
  id,
  duration,
  shotSize: "中景",
  actionSummary: `action-${id}`,
} as Shot);

describe("EpisodeTreeTrailerPanel", () => {
  it("keeps trailer order, duration selection, and shot selection behavior", () => {
    const onGenerateTrailer = vi.fn();
    const onSelectItem = vi.fn();
    render(
      <EpisodeTreeTrailerPanel
        shots={[shot("shot-1", 4), shot("shot-2", 6)]}
        selectedItemId={null}
        selectedItemType={null}
        onSelectItem={onSelectItem}
        trailerConfig={{ duration: 30, shotIds: ["shot-2", "missing", "shot-1"], status: "completed" }}
        trailerApiOptions={{ apiKey: "key" }}
        onGenerateTrailer={onGenerateTrailer}
      />,
    );

    expect(screen.getByText("已选择 2 个分镜，预计时长 10 秒")).toBeTruthy();
    fireEvent.click(screen.getByText("1分钟"));
    fireEvent.click(screen.getByText("AI 智能挑选分镜"));
    expect(onGenerateTrailer).toHaveBeenCalledWith(60);

    fireEvent.click(screen.getByText(/action-shot-2/));
    expect(onSelectItem).toHaveBeenCalledWith("shot-2", "shot");
  });

  it("preserves disabled and calibration click semantics", () => {
    const onSelectItem = vi.fn();
    const onCalibrateSingleShot = vi.fn();
    render(
      <EpisodeTreeTrailerPanel
        shots={[shot("shot-1", 5)]}
        selectedItemId="shot-1"
        selectedItemType="shot"
        onSelectItem={onSelectItem}
        trailerConfig={{ duration: 30, shotIds: ["shot-1"], status: "idle" }}
        onCalibrateSingleShot={onCalibrateSingleShot}
      />,
    );

    expect((screen.getByRole("button", { name: "AI 智能挑选分镜" }) as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByTitle("AI 校准分镜"));
    expect(onCalibrateSingleShot).toHaveBeenCalledWith("shot-1");
    expect(onSelectItem).not.toHaveBeenCalled();
    expect(screen.getByText("请先在设置中配置 AI API 密钥")).toBeTruthy();
  });
});
