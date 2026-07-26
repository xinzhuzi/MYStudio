// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Character } from "@/stores/library/character-library-store";
import { ScreenplayInput } from "./screenplay-input";

const mocks = vi.hoisted(() => ({
  createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
  revokeObjectURL: vi.fn(),
  setScreenplayDraft: vi.fn(),
  setActiveTab: vi.fn(),
  characters: [] as Character[],
}));

vi.mock("@/stores/director/director-store", () => {
  const useDirectorStore = Object.assign(
    () => ({
      startScreenplayGeneration: vi.fn(),
      setScreenplayError: vi.fn(),
      config: {},
      updateConfig: vi.fn(),
      setScreenplayDraft: mocks.setScreenplayDraft,
    }),
    { getState: () => ({ onScreenplayGenerated: vi.fn() }) },
  );
  return {
    useDirectorStore,
    useActiveDirectorProject: () => null,
  };
});

vi.mock("@/stores/ai/api-config-store", () => ({
  useAPIConfigStore: () => ({
    checkVideoGenerationKeys: vi.fn(),
    checkChatKeys: () => ({ isAllConfigured: true }),
    isFeatureConfigured: () => true,
    getApiKey: vi.fn(),
  }),
}));

vi.mock("@/stores/library/character-library-store", () => ({
  useCharacterLibraryStore: () => ({ characters: mocks.characters }),
}));

vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: () => ({
    resourceSharing: { shareCharacters: true },
    imageGenerationSettings: {
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
    },
  }),
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: () => ({ activeProjectId: null }),
}));

vi.mock("@/stores/navigation/media-panel-store", () => ({
  useMediaPanelStore: () => ({
    setActiveTab: mocks.setActiveTab,
    pendingDirectorData: null,
    setPendingDirectorData: vi.fn(),
  }),
}));

vi.mock("@/components/features/visual-style/style-picker", () => ({
  StylePicker: () => <div data-testid="style-picker" />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  SelectValue: () => null,
  SelectSeparator: () => null,
  SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const PopoverContext = React.createContext({
    open: false,
    onOpenChange: (_open: boolean) => {},
  });

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <PopoverContext.Provider value={{ open, onOpenChange }}>
        {children}
      </PopoverContext.Provider>
    ),
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const { open } = React.useContext(PopoverContext);
      return open ? <div>{children}</div> : null;
    },
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const { open, onOpenChange } = React.useContext(PopoverContext);
      return <span onClick={() => onOpenChange(!open)}>{children}</span>;
    },
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function makeCharacter(): Character {
  return {
    id: "character-1",
    name: "洛青",
    description: "持剑修士",
    visualTraits: "black hair, green robe",
    views: [],
    variations: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: mocks.createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: mocks.revokeObjectURL,
  });
});

afterAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectURL,
  });
});

beforeEach(() => {
  mocks.characters = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScreenplayInput reference images", () => {
  it("caps selected files, renders object URLs, and restores the add control after removal", () => {
    const files = [
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.png", { type: "image/png" }),
      new File(["three"], "three.png", { type: "image/png" }),
      new File(["four"], "four.png", { type: "image/png" }),
    ];
    const createdInputs: HTMLInputElement[] = [];
    const inputClick = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(function (this: HTMLInputElement) {
        createdInputs.push(this);
        Object.defineProperty(this, "files", {
          configurable: true,
          value: files,
        });
        this.dispatchEvent(new Event("change", { bubbles: true }));
      });

    const { container } = render(<ScreenplayInput onGenerateStoryboard={vi.fn()} />);
    const addControl = container.querySelector(".lucide-image-plus")?.parentElement;
    expect(addControl).toBeTruthy();

    fireEvent.click(addControl!);

    expect(inputClick).toHaveBeenCalledTimes(1);
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0].accept).toBe("image/*");
    expect(createdInputs[0].multiple).toBe(true);
    expect(screen.getByText("3/3")).toBeTruthy();
    expect(screen.getByAltText("Reference 1").getAttribute("src")).toBe("blob:one.png");
    expect(screen.getByAltText("Reference 2").getAttribute("src")).toBe("blob:two.png");
    expect(screen.getByAltText("Reference 3").getAttribute("src")).toBe("blob:three.png");
    expect(screen.queryByAltText("Reference 4")).toBeNull();
    expect(container.querySelector(".lucide-image-plus")).toBeNull();

    const firstRemoveButton = screen.getByAltText("Reference 1").parentElement?.querySelector("button");
    expect(firstRemoveButton).toBeTruthy();
    fireEvent.click(firstRemoveButton!);

    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.queryByAltText("Reference 3")).toBeNull();
    expect(container.querySelector(".lucide-image-plus")).toBeTruthy();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:one.png");
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:two.png");
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:three.png");
  });
});

describe("ScreenplayInput character picker", () => {
  it("adds and removes a visible character through the picker", () => {
    mocks.characters = [makeCharacter()];
    const { container } = render(<ScreenplayInput onGenerateStoryboard={vi.fn()} />);

    expect(screen.queryByText("1 个")).toBeNull();
    expect(screen.queryByRole("button", { name: "洛青" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "选择角色" }));
    fireEvent.click(screen.getByRole("button", { name: "洛青" }));

    expect(screen.getByText("1 个")).toBeTruthy();
    expect(container.querySelector(".lucide-check")).toBeTruthy();
    expect(screen.getByRole("button", { name: "洛青" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "添加角色" }));
    expect(screen.queryByRole("button", { name: "洛青" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加角色" }));
    fireEvent.click(screen.getByRole("button", { name: "洛青" }));

    expect(screen.queryByText("1 个")).toBeNull();
    expect(container.querySelector(".lucide-check")).toBeNull();
    expect(screen.getByRole("button", { name: "洛青" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("removes a selected character through its chip control", () => {
    mocks.characters = [makeCharacter()];
    render(<ScreenplayInput onGenerateStoryboard={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "选择角色" }));
    fireEvent.click(screen.getByRole("button", { name: "洛青" }));
    fireEvent.click(screen.getByRole("button", { name: "移除角色 洛青" }));

    expect(screen.queryByText("1 个")).toBeNull();
  });

  it("routes an empty library to the character panel", () => {
    render(<ScreenplayInput onGenerateStoryboard={vi.fn()} />);

    expect(screen.queryByText("角色库为空")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "选择角色" }));
    expect(screen.getByText("角色库为空")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "去创建角色" }));

    expect(mocks.setActiveTab).toHaveBeenCalledWith("characters");
    expect(screen.queryByText("角色库为空")).toBeNull();
  });
});
