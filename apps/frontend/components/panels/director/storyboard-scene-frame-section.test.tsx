// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setPreviewItem = vi.fn();

vi.mock("@/stores/preview-store", () => ({
  usePreviewStore: () => ({ setPreviewItem }),
}));

vi.mock("@/hooks/use-resolved-image-url", () => ({
  useResolvedImageUrl: (value: string) => value,
}));

vi.mock("./character-selector", () => ({
  CharacterSelector: () => <div data-testid="character-selector" />,
}));

vi.mock("./scene-library-selector", () => ({
  SceneLibrarySelector: () => <div data-testid="scene-selector" />,
}));

vi.mock("./media-library-selector", () => ({
  MediaLibrarySelector: ({ onSelect }: { onSelect: (url: string) => void }) => (
    <button onClick={() => onSelect("media://selected")}>选择素材</button>
  ),
}));

import { StoryboardSceneFrameSection } from "./storyboard-scene-frame-section";
import type { SplitScene } from "@/stores/director-store";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function scene(overrides: Partial<SplitScene> = {}): SplitScene {
  return {
    id: 0,
    imageDataUrl: "data:image/png;base64,start",
    endFrameImageUrl: "data:image/png;base64,end",
    characterIds: [],
    ...overrides,
  } as SplitScene;
}

function renderSection(overrides: Partial<SplitScene> = {}) {
  const props = {
    scene: scene(overrides),
    onUpdateNeedsEndFrame: vi.fn(),
    onUpdateEndFrame: vi.fn(),
    onUpdateCharacters: vi.fn(),
    onUploadImage: vi.fn(),
  };
  render(<StoryboardSceneFrameSection {...props} />);
  return props;
}

describe("StoryboardSceneFrameSection", () => {
  it("keeps frame targeting and media selection project callbacks distinct", () => {
    const props = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "尾帧" }));
    fireEvent.click(screen.getByRole("button", { name: "可选" }));
    fireEvent.click(screen.getByRole("button", { name: "选择素材" }));

    expect(props.onUpdateNeedsEndFrame).toHaveBeenCalledWith(0, true);
    expect(props.onUpdateEndFrame).toHaveBeenCalledWith(0, "media://selected");
    expect(props.onUploadImage).not.toHaveBeenCalled();
  });

  it("routes start-frame media selection to the upload callback", () => {
    const props = renderSection({ endFrameImageUrl: null });

    fireEvent.click(screen.getByRole("button", { name: "选择素材" }));

    expect(props.onUploadImage).toHaveBeenCalledWith(0, "media://selected");
    expect(props.onUpdateEndFrame).not.toHaveBeenCalled();
  });
});
