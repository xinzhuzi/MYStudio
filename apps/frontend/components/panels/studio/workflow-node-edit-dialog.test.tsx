// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkflowNodeEditDialog } from "./WorkflowNodeEditDialog";

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

describe("WorkflowNodeEditDialog", () => {
  it("renders writable node editing controls", () => {
    render(
      <WorkflowNodeEditDialog
        open
        title="编辑剧本节点"
        value="剧本 markdown"
        writable
        onValueChange={vi.fn()}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onEnterStage={vi.fn()}
      />,
    );

    expect(screen.getByText("编辑剧本节点")).toBeTruthy();
    expect(
      screen.getByText("编辑当前节点 FlowData Markdown，保存后会回写工作流数据。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "进入阶段" })).toBeNull();
  });
});
