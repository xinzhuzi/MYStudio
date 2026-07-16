// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EpisodeTreeAIResultCard } from "./episode-tree-ai-result-card";

afterEach(cleanup);

describe("EpisodeTreeAIResultCard", () => {
  it("renders a successful lookup with its detail content", () => {
    const { container } = render(
      <EpisodeTreeAIResultCard found message="已找到场景">
        <span>场景详情</span>
      </EpisodeTreeAIResultCard>,
    );

    expect(screen.getByText("已找到场景")).toBeTruthy();
    expect(screen.getByText("场景详情")).toBeTruthy();
    expect(container.querySelector(".text-green-500")).toBeTruthy();
  });

  it("renders an unsuccessful lookup with the warning treatment", () => {
    const { container } = render(
      <EpisodeTreeAIResultCard found={false} message="未找到角色" />,
    );

    expect(screen.getByText("未找到角色")).toBeTruthy();
    expect(container.querySelector(".text-amber-500")).toBeTruthy();
  });
});
