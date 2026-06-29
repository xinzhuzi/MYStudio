// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkflowStageStatusBar } from "./WorkflowStageStatusBar";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";

afterEach(cleanup);

const readiness: WorkflowReadiness = {
  progress: 35,
  nextStageId: "script",
  nextActionLabel: "生成故事骨架、改编策略和结构化剧本",
  nextAction: {
    kind: "open-stage",
    stageId: "script",
    label: "进入剧本生产阶段",
    enabled: true,
  },
  stages: [
    {
      id: "manuals",
      label: "风格与导演",
      status: "ready",
      completed: ["手册已选择"],
      missing: [],
      actionLabel: "选择视觉与导演手册",
    },
    {
      id: "script",
      label: "剧本生产阶段",
      status: "active",
      completed: [],
      missing: ["还没有剧本"],
      actionLabel: "生成故事骨架、改编策略和结构化剧本",
    },
  ],
};

describe("WorkflowStageStatusBar", () => {
  it("renders the next workflow stage as a compact horizontal header", () => {
    render(
      <WorkflowStageStatusBar
        readiness={readiness}
        activeStage="manuals"
        onStageChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("当前所在：风格与导演")).toBeNull();
    expect(screen.queryByText("进度 35%")).toBeNull();
    expect(screen.queryByText("当前阶段：风格与导演")).toBeNull();
    expect(screen.getByText("待推进：剧本生产阶段")).toBeTruthy();
    expect(screen.getByText("切换阶段")).toBeTruthy();
    expect(
      screen.getAllByText("生成故事骨架、改编策略和结构化剧本").length,
    ).toBeGreaterThan(0);
  });

  it("opens the stage menu and switches to the selected stage", () => {
    const onStageChange = vi.fn();
    render(
      <WorkflowStageStatusBar
        readiness={readiness}
        activeStage="manuals"
        onStageChange={onStageChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: /切换阶段/ });
    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByText("风格与导演"));

    expect(onStageChange).toHaveBeenCalledWith("manuals");
  });

  it("renders script sub-stage actions beside the stage switch only on script stage", () => {
    const scriptSubStages = (
      <div>
        <button>1. 故事骨架</button>
        <button>2. 改编策略</button>
        <button>3. 剧本</button>
      </div>
    );
    const { rerender } = render(
      <WorkflowStageStatusBar
        readiness={readiness}
        activeStage="script"
        onStageChange={vi.fn()}
        stageActions={scriptSubStages}
      />,
    );

    expect(screen.getByText("1. 故事骨架")).toBeTruthy();
    expect(screen.getByText("2. 改编策略")).toBeTruthy();
    expect(screen.getByText("3. 剧本")).toBeTruthy();

    rerender(
      <WorkflowStageStatusBar
        readiness={readiness}
        activeStage="assets"
        onStageChange={vi.fn()}
        stageActions={scriptSubStages}
      />,
    );

    expect(screen.queryByText("1. 故事骨架")).toBeNull();
    expect(screen.queryByText("2. 改编策略")).toBeNull();
    expect(screen.queryByText("3. 剧本")).toBeNull();
  });
});
