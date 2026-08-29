// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Character } from "@/stores/library/character-library-store";
import { WardrobeModal } from "./wardrobe-modal";

const mocks = vi.hoisted(() => ({
  addVariation: vi.fn(),
  updateVariation: vi.fn(),
  deleteVariation: vi.fn(),
  generateVariation: vi.fn(),
  featureConfig: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/stores/library/character-library-store", () => ({
  useCharacterLibraryStore: () => ({
    addVariation: mocks.addVariation,
    updateVariation: mocks.updateVariation,
    deleteVariation: mocks.deleteVariation,
  }),
}));

vi.mock("@/stores/media/media-store", () => ({
  useMediaStore: () => ({
    addMediaFromUrl: vi.fn(),
    getOrCreateCategoryFolder: vi.fn(),
  }),
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: () => ({ activeProjectId: "project-1" }),
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    featureConfig: mocks.featureConfig,
    featureNotConfiguredMessage: vi.fn(),
  },
}));

vi.mock("@/lib/media/image-storage", () => ({
  saveImageToLocal: vi.fn(),
}));

vi.mock("@/lib/ai/wardrobe-image-generation", () => ({
  generateVariationImage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/local-image", () => ({
  LocalImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
}));

vi.mock("@/components/ui/media-preview-modal", () => ({
  ImagePreviewModal: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WardrobeModal legacy generation compatibility", () => {
  it("uses the external generator without requiring a base portrait", async () => {
    const character: Character = {
      id: "character-1",
      name: "云昭",
      description: "",
      visualTraits: "",
      views: [],
      variations: [
        {
          id: "variation-1",
          name: "战斗装",
          visualPrompt: "battle outfit",
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.generateVariation.mockResolvedValue("https://example.com/variation.png");

    render(
      <WardrobeModal
        character={character}
        open
        onOpenChange={vi.fn()}
        onGenerateVariation={mocks.generateVariation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));

    await waitFor(() => {
      expect(mocks.generateVariation).toHaveBeenCalledWith(
        "character-1",
        "variation-1",
        "battle outfit",
      );
    });
    expect(mocks.featureConfig).not.toHaveBeenCalled();
    expect(mocks.updateVariation).toHaveBeenCalledWith(
      "character-1",
      "variation-1",
      expect.objectContaining({
        referenceImage: "https://example.com/variation.png",
        generatedAt: expect.any(Number),
      }),
    );
  });
});
