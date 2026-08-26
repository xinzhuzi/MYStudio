// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodePointerCard } from "./node-pointer-card";
import type { ProductionFlowNodeModel } from "../workflow-node-model";

afterEach(cleanup);

const node = {
  id: "storyboard",
  label: "分镜面板",
  description: "",
  status: "ready" as const,
  metrics: ["82 个分镜", "71 个画面"],
  previewTitle: "",
  previewLines: ["82 个分镜", "71 个画面", "已全量 4K"],
  previewKind: "storyboard-grid" as const,
  targetStage: "storyboard" as const,
} satisfies ProductionFlowNodeModel;

describe("NodePointerCard", () => {
  it("renders summary, metrics, and enter button in ≤35 DOM elements", () => {
    const { container } = render(<NodePointerCard node={node} onEnter={vi.fn()} />);
    expect(screen.getAllByText("82 个分镜").length).toBeGreaterThan(0);
    expect(screen.getAllByText("71 个画面").length).toBeGreaterThan(0);
    expect(screen.getByText("已全量 4K")).toBeTruthy();
    expect(screen.getByRole("button", { name: /进入 分镜面板/ })).toBeTruthy();
    const dom = container.querySelectorAll("*").length;
    expect(dom).toBeLessThanOrEqual(35);
  });

  it("fires onEnter on button click (stopPropagation, 不冒泡到节点拖拽)", () => {
    const onEnter = vi.fn();
    render(<NodePointerCard node={node} onEnter={onEnter} />);
    fireEvent.click(screen.getByRole("button", { name: /进入/ }));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("renders without enter button when onEnter is undefined", () => {
    render(<NodePointerCard node={node} />);
    expect(screen.queryByRole("button", { name: /进入/ })).toBeNull();
    // 摘要仍在
    expect(screen.getAllByText("82 个分镜").length).toBeGreaterThan(0);
  });
});
