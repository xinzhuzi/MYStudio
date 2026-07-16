// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => ({ onValueChange: undefined as ((value: string) => void) | undefined }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange: (value: string) => void }) => {
    selectMock.onValueChange = onValueChange;
    return <div>{children}</div>;
  },
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <button type="button" onClick={() => selectMock.onValueChange?.(value)}>{children}</button>
  ),
  SelectTrigger: ({ children, ...props }: HTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
  SelectValue: () => <span>当前策略</span>,
}));

import { StoryboardMergedGenerationControls } from "./storyboard-merged-generation-controls";

afterEach(cleanup);

function baseProps() {
  return {
    frameMode: "first" as const,
    onFrameModeChange: vi.fn(),
    refStrategy: "cluster" as const,
    onRefStrategyChange: vi.fn(),
    useExemplar: true,
    onUseExemplarChange: vi.fn(),
    isGenerating: false,
    isMergedRunning: false,
    sceneCount: 2,
    onGenerate: vi.fn(),
    onStop: vi.fn(),
  };
}

describe("StoryboardMergedGenerationControls", () => {
  it("delegates controlled frame, strategy, exemplar, and generation values", () => {
    const props = baseProps();
    render(<StoryboardMergedGenerationControls {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "仅尾帧" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimal（单参考）" }));
    fireEvent.click(screen.getByRole("button", { name: "范例锚图 开" }));
    fireEvent.click(screen.getByRole("button", { name: "执行合并生成" }));

    expect(props.onFrameModeChange).toHaveBeenCalledWith("last");
    expect(props.onRefStrategyChange).toHaveBeenCalledWith("minimal");
    expect(props.onUseExemplarChange).toHaveBeenCalledWith(false);
    expect(props.onGenerate).toHaveBeenCalledWith("first", "cluster", true);
  });

  it("keeps the established disabled and stop states", () => {
    const props = baseProps();
    const { rerender } = render(<StoryboardMergedGenerationControls {...props} sceneCount={0} />);

    expect((screen.getByRole("button", { name: "执行合并生成" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<StoryboardMergedGenerationControls {...props} isMergedRunning />);

    expect((screen.getByRole("button", { name: "合并生成中..." }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(props.onStop).toHaveBeenCalledOnce();
  });
});
