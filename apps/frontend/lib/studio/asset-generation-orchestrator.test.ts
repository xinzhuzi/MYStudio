// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { generateAsset } from "./asset-generation-orchestrator";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    image: vi.fn().mockResolvedValue({ imageUrl: "https://example.com/prop.png" }),
  },
}));

vi.mock("@/lib/ai/prompt-polisher", () => ({
  polishAssetPrompt: vi.fn().mockResolvedValue({
    status: "success",
    prompt: "polished prop prompt",
    negativePrompt: "avoid modern plastic",
  }),
}));

vi.mock("@/lib/image-storage", () => ({
  saveImageToLocal: vi
    .fn()
    .mockResolvedValue("local-image://props/prop-1.png"),
}));

beforeEach(() => {
  (usePropsLibraryStore as any).persist?.setOptions({
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
  usePropsLibraryStore.setState({
    items: [
      {
        id: "prop-1",
        name: "断剑",
        description: "一柄断裂的古剑",
        imageUrl: "",
        folderId: null,
        createdAt: 1,
      },
    ],
    folders: [],
    selectedFolderId: "all",
  });
});

describe("asset-generation-orchestrator", () => {
  it("writes generated prop prompt and image back to the props store", async () => {
    const result = await generateAsset({
      assetId: "prop-1",
      assetType: "prop",
      name: "断剑",
      description: "一柄断裂的古剑",
      isDerivative: false,
      visualManualId: "ink",
    });

    expect(result.phase).toBe("done");
    const prop = usePropsLibraryStore
      .getState()
      .items.find((item) => item.id === "prop-1");
    expect(prop?.visualPrompt).toBe("polished prop prompt");
    expect(prop?.promptState).toBe("ready");
    expect(prop?.imageUrl).toBe("local-image://props/prop-1.png");
  });
});
