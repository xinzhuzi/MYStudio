// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ImageWorkflowGraph } from "@/types/studio";

const bridgeMove = vi.hoisted(() => vi.fn());
const bridgeGetPath = vi.hoisted(() => vi.fn());
const setStateMock = vi.hoisted(() => vi.fn());

let currentGraphs: ImageWorkflowGraph[];

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: Object.assign(vi.fn(), {
    getState: () => ({ imageWorkflows: currentGraphs }),
    setState: setStateMock,
  }),
}));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({ move: bridgeMove, getAbsolutePath: bridgeGetPath }),
}));

import { ChapterMigrationDialog } from "./ChapterMigrationDialog";

function textContentIncludes(fragment: string) {
  return (_: string, element: Element | null) =>
    element?.tagName === "DIV" && Boolean(element.textContent?.includes(fragment));
}

function legacyGraph(suffix: string): ImageWorkflowGraph {
  return {
    id: `storyboard-flow-chapter-001-${suffix}`,
    name: "g",
    target: { kind: "storyboard", id: "sb-1" },
    nodes: [{
      id: "n1", type: "generated", title: "t", prompt: "", model: "m",
      aspectRatio: "16:9", resolution: "2K", status: "ready",
      position: { x: 0, y: 0 }, createdAt: 1, updatedAt: 1,
      imageUrl: `project-file://p1/workflow-images/storyboard-flow-chapter-001-${suffix}/gen-a.png`,
    }] as unknown as ImageWorkflowGraph["nodes"],
    edges: [], createdAt: 1, updatedAt: 1,
  } as ImageWorkflowGraph;
}

afterEach(() => cleanup());

describe("ChapterMigrationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentGraphs = [];
    // zustand setState 会执行函数式 updater;裸 vi.fn() 不会,须补实现
    setStateMock.mockImplementation((updater: (state: unknown) => unknown) =>
      updater({ imageWorkflows: currentGraphs }));
  });

  it("shows the clean state when no legacy layout remains", () => {
    render(<ChapterMigrationDialog projectId="p1" onClose={() => {}} />);
    expect(screen.getByText(/均已按章节归档,无需整理/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "开始整理" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("previews legacy counts, migrates via the bridge, and reports the result", async () => {
    currentGraphs = [legacyGraph("005")];
    bridgeMove.mockResolvedValue({ success: true, url: "project-file://p1/x" });
    bridgeGetPath.mockResolvedValue("/data/_p/p1/workflow-images/chapter-001/storyboard-flow-chapter-001-005/gen-a.png");
    const onFinished = vi.fn();
    render(<ChapterMigrationDialog projectId="p1" onClose={() => {}} onFinished={onFinished} />);

    expect(screen.getAllByText(textContentIncludes("1 个待整理工作流目录"))).toBeTruthy();
    expect(screen.getAllByText(textContentIncludes("1 处引用"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "开始整理" }));
    await waitFor(() => expect(screen.getAllByText(textContentIncludes("整理完成:已移动 1 个目录"))).toBeTruthy());
    expect(screen.getAllByText(textContentIncludes("更新 1 处引用"))).toBeTruthy();
    expect(onFinished).toHaveBeenCalledOnce();
    expect(bridgeMove).toHaveBeenCalledWith({
      projectId: "p1",
      fromRelative: "workflow-images/storyboard-flow-chapter-001-005",
      toRelative: "workflow-images/chapter-001/storyboard-flow-chapter-001-005",
    });
    expect(setStateMock).toHaveBeenCalled();
  });

  it("rolls back completed moves when a later one fails", async () => {
    currentGraphs = [legacyGraph("005"), legacyGraph("006")];
    bridgeMove.mockImplementation(async (payload: { toRelative: string }) =>
      payload.toRelative.includes("chapter-001-006")
        ? { success: false, error: "目标路径已存在" }
        : { success: true, url: "project-file://p1/x" });
    render(<ChapterMigrationDialog projectId="p1" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "开始整理" }));
    await waitFor(() => expect(screen.getAllByText(textContentIncludes("整理未完成"))).toBeTruthy());
    expect(screen.getAllByText(textContentIncludes("已自动还原 1 个目录"))).toBeTruthy();
    expect(bridgeMove).toHaveBeenCalledWith(expect.objectContaining({
      fromRelative: "workflow-images/chapter-001/storyboard-flow-chapter-001-005",
      toRelative: "workflow-images/storyboard-flow-chapter-001-005",
    }));
    expect(setStateMock).not.toHaveBeenCalled();
  });
});
