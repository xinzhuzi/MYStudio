// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
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

  it("uses the active theme instead of a fixed dark editor skin", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/WorkflowNodeEditDialog.tsx",
      "utf8",
    );

    expect(source).toContain("useThemeStore");
    expect(source).toContain("theme={theme}");
    expect(source).toContain("bg-card");
    expect(source).toContain("text-card-foreground");
    expect(source).not.toContain('theme="dark"');
    expect(source).not.toContain("bg-[#171817]");
    expect(source).not.toContain("border-white/10");
    expect(source).not.toContain("text-zinc-100");
  });
});
