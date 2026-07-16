// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import {
  SClassTrailerScenesPanel,
  type SClassTrailerScenesPanelProps,
} from "./sclass-trailer-scenes-panel";

const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("../director/storyboard-config-toolbar", () => ({
  StoryboardConfigToolbar: () => <div data-testid="storyboard-config-toolbar" />,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function scene(id: number, updates: Partial<SplitScene> = {}): SplitScene {
  return {
    id,
    sceneName: `预告片分镜 ${id + 1}`,
    duration: 5,
    imageDataUrl: `image-${id}`,
    videoStatus: "idle",
    ...updates,
  } as SplitScene;
}

function createProps(
  overrides: Partial<SClassTrailerScenesPanelProps> = {},
): SClassTrailerScenesPanelProps {
  return {
    trailerScenes: [scene(0)],
    isGenerating: false,
    renderSceneCard: (currentScene) => <div key={currentScene.id}>分镜卡片 {currentScene.id}</div>,
    onDeleteScene: vi.fn(),
    onClearTrailer: vi.fn(),
    onGenerateVideo: vi.fn(),
    styleId: "ink",
    onStyleChange: vi.fn(),
    aspectRatio: "16:9",
    onAspectRatioChange: vi.fn(),
    imageResolution: "2K",
    onImageResolutionChange: vi.fn(),
    videoResolution: "720p",
    onVideoResolutionChange: vi.fn(),
    styleTokens: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SClassTrailerScenesPanel", () => {
  it("shows the trailer empty state without toolbar or actions", () => {
    render(<SClassTrailerScenesPanel {...createProps({ trailerScenes: [] })} />);

    expect(screen.getByText("预告片功能")).toBeTruthy();
    expect(screen.queryByTestId("storyboard-config-toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "清空分镜" })).toBeNull();
    expect(screen.queryByRole("button", { name: /生成预告片视频/ })).toBeNull();
  });

  it("clears every trailer scene before clearing the trailer configuration", () => {
    const onDeleteScene = vi.fn();
    const onClearTrailer = vi.fn();
    render(<SClassTrailerScenesPanel {...createProps({
      trailerScenes: [scene(3), scene(4)],
      onDeleteScene,
      onClearTrailer,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "确认清空" }));

    expect(onDeleteScene.mock.calls).toEqual([[3], [4]]);
    expect(onClearTrailer).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("已清空 2 个预告片分镜");
  });

  it("generates only trailer scenes with an unfinished video and a first frame", () => {
    const onGenerateVideo = vi.fn();
    const renderSceneCard = vi.fn((currentScene: SplitScene) => (
      <div key={currentScene.id}>分镜卡片 {currentScene.id}</div>
    ));
    render(<SClassTrailerScenesPanel {...createProps({
      trailerScenes: [
        scene(0, { duration: 4 }),
        scene(1, { imageDataUrl: "" }),
        scene(2, { videoStatus: "completed", duration: 8 }),
      ],
      renderSceneCard,
      onGenerateVideo,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "生成预告片视频 (3)" }));

    expect(screen.getByText("预计 17 秒")).toBeTruthy();
    expect(renderSceneCard).toHaveBeenCalledTimes(3);
    expect(onGenerateVideo).toHaveBeenCalledTimes(1);
    expect(onGenerateVideo).toHaveBeenCalledWith(0);
    expect(toast.info).toHaveBeenCalledWith("开始生成 3 个预告片视频...");
  });

  it("disables destructive and generation actions while generation is active", () => {
    render(<SClassTrailerScenesPanel {...createProps({ isGenerating: true })} />);

    expect((screen.getByRole("button", { name: "清空分镜" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "生成中..." }) as HTMLButtonElement).disabled).toBe(true);
  });
});
