import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";

vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: vi.fn(),
}));

const bridgeMock = vi.mocked(getStudioAssetsBridge);

afterEach(() => {
  bridgeMock.mockReset();
});

function makeBridge(entries: {
  scene?: Array<{ name: string; id?: string }>;
  role?: Array<{ name: string; id?: string }>;
  imageDataUrls?: Record<string, string | null>;
}) {
  return {
    batchMatch: vi.fn(({ type }: { type: string }) => Promise.resolve(
      (type === "scene" ? entries.scene ?? [] : entries.role ?? []).map((entry) => ({
        name: entry.name,
        asset: { id: entry.id ?? `id-${entry.name}`, name: entry.name },
      })),
    )),
    readImageDataUrl: vi.fn((id: string) => Promise.resolve(
      entries.imageDataUrls?.[id] === undefined
        ? `data:image/png;base64,${id}`
        : entries.imageDataUrls[id],
    )),
  } as never;
}

describe("resolveStoryboardAssetReferences", () => {
  it("collects scene-first then character references via dataURL reads", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "金水河码头" }, { name: "道口镇" }],
      role: [
        { name: "独孤剑尘" }, { name: "赵四" }, { name: "老苦力" }, { name: "铁山" },
      ],
    }));

    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["金水河码头", "道口镇", "独孤剑尘", "赵四", "老苦力", "铁山"],
    });

    expect(refs?.map((ref) => [ref.title, ref.assetType, ref.imageUrl.startsWith("data:image/")])).toEqual([
      ["金水河码头", "scene", true],
      ["独孤剑尘", "character", true],
      ["赵四", "character", true],
      ["老苦力", "character", true],
    ]);
  });

  it("skips assets whose image read fails or is missing", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [{ name: "赵四" }, { name: "老苦力" }],
      imageDataUrls: { "id-赵四": null, "id-老苦力": "data:image/png;base64,ok" },
    }));
    const refs = await resolveStoryboardAssetReferences({ associateAssetsNames: ["赵四", "老苦力"] });
    expect(refs?.map((ref) => ref.title)).toEqual(["老苦力"]);
  });

  it("fails empty when the bridge is missing or names are absent", async () => {
    bridgeMock.mockReturnValue(undefined);
    expect(await resolveStoryboardAssetReferences({ associateAssetsNames: ["赵四"] })).toEqual([]);
    bridgeMock.mockReturnValue(makeBridge({}));
    expect(await resolveStoryboardAssetReferences({ associateAssetsNames: [] })).toEqual([]);
  });
});
