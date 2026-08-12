// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeriesMeta } from "@/types/script";
import { OverviewPanel } from "./index";

const mocks = vi.hoisted(() => ({
  updateSeriesMeta: vi.fn(),
  addEpisodeBundle: vi.fn(),
  updateEpisodeBundle: vi.fn(),
  enterEpisode: vi.fn(),
  setActiveTab: vi.fn(),
  meta: null as SeriesMeta | null,
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: () => ({ activeProjectId: "project-1" }),
}));

vi.mock("@/stores/script/script-store", () => ({
  useScriptStore: () => ({
    updateSeriesMeta: mocks.updateSeriesMeta,
    addEpisodeBundle: mocks.addEpisodeBundle,
    updateEpisodeBundle: mocks.updateEpisodeBundle,
  }),
  useActiveScriptProject: () => ({
    seriesMeta: mocks.meta,
    episodeRawScripts: [],
    scriptData: null,
  }),
}));

vi.mock("@/stores/navigation/media-panel-store", () => ({
  useMediaPanelStore: () => ({
    enterEpisode: mocks.enterEpisode,
    setActiveTab: mocks.setActiveTab,
  }),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
  mocks.meta = {
    title: "原始标题",
    characters: [],
    keyItems: [{ name: "古剑", desc: "旧描述" }],
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OverviewPanel", () => {
  it("saves single-line metadata on Enter", () => {
    render(<OverviewPanel />);

    fireEvent.click(screen.getByText("原始标题"));
    const input = screen.getByDisplayValue("原始标题");
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.updateSeriesMeta).toHaveBeenCalledWith("project-1", {
      title: "新标题",
    });
  });

  it("cancels an inline edit on Escape without saving", () => {
    render(<OverviewPanel />);

    fireEvent.click(screen.getByText("原始标题"));
    const input = screen.getByDisplayValue("原始标题");
    fireEvent.change(input, { target: { value: "不应保存" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mocks.updateSeriesMeta).not.toHaveBeenCalled();
    expect(screen.getAllByText("原始标题").length).toBeGreaterThan(0);
  });

  it("updates one named entity without mutating its siblings", () => {
    mocks.meta = {
      ...mocks.meta!,
      keyItems: [
        { name: "古剑", desc: "旧描述" },
        { name: "玉印", desc: "保留描述" },
      ],
    };
    render(<OverviewPanel />);

    fireEvent.click(screen.getByText("旧描述"));
    const input = screen.getByDisplayValue("旧描述");
    fireEvent.change(input, { target: { value: "新描述" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.updateSeriesMeta).toHaveBeenCalledWith("project-1", {
      keyItems: [
        { name: "古剑", desc: "新描述" },
        { name: "玉印", desc: "保留描述" },
      ],
    });
  });

  it("navigates to production stage tab when clicking '进入阶段' button", () => {
    mocks.meta = null; // empty project triggers overview workflow/stage guide view
    render(<OverviewPanel />);

    const buttons = screen.getAllByRole("button", { name: /进入阶段/ });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(mocks.setActiveTab).toHaveBeenCalledWith("studio");
  });
});
