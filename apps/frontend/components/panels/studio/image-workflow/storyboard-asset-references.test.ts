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
  scene?: Array<{ name: string; assetName?: string; id?: string; previewUrl?: string }>;
  role?: Array<{ name: string; assetName?: string; id?: string; previewUrl?: string }>;
}) {
  return {
    batchMatch: vi.fn(({ type }: { type: string }) => Promise.resolve(
      (type === "scene" ? entries.scene ?? [] : entries.role ?? []).map((entry) => ({
        name: entry.name,
        asset: {
          id: entry.id ?? `id-${entry.name}`,
          name: entry.assetName ?? entry.name,
          previewUrl: entry.previewUrl === undefined ? `file:///assets/${entry.name}.png` : entry.previewUrl,
        },
      })),
    )),
  } as never;
}

describe("resolveStoryboardAssetReferences", () => {
  it("collects lightweight file:// urls scene-first then characters with caps", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "金水河码头" }, { name: "道口镇" }],
      role: [
        { name: "独孤剑尘" }, { name: "赵四" }, { name: "老苦力" }, { name: "铁山" },
      ],
    }));

    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["金水河码头", "道口镇", "独孤剑尘", "赵四", "老苦力", "铁山"],
    });

    expect(refs?.map((ref) => [ref.title, ref.assetType, ref.imageUrl.startsWith("file://")])).toEqual([
      ["金水河码头", "scene", true],
      ["独孤剑尘", "character", true],
      ["赵四", "character", true],
      ["老苦力", "character", true],
    ]);
  });

  it("never returns data: urls (persistence discipline) and skips imageless matches", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [
        { name: "赵四", previewUrl: "" },
        { name: "旧资产", previewUrl: "data:image/png;base64,QUJD" },
        { name: "临时预览", previewUrl: "blob:https://example.test/transient" },
        { name: "老苦力" },
      ],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["赵四", "旧资产", "临时预览", "老苦力"],
    });
    expect(refs?.map((ref) => ref.title)).toEqual(["老苦力"]);
    expect(refs?.every((ref) => !/^(?:data|blob):/.test(ref.imageUrl))).toBe(true);
  });

  it("fails empty when the bridge is missing or names are absent", async () => {
    bridgeMock.mockReturnValue(undefined);
    expect(await resolveStoryboardAssetReferences({ associateAssetsNames: ["赵四"] })).toEqual([]);
    bridgeMock.mockReturnValue(makeBridge({}));
    expect(await resolveStoryboardAssetReferences({ associateAssetsNames: [] })).toEqual([]);
  });
  it("filters off-frame characters when frame text exists (S08 身份防线)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "金水河码头" }],
      role: [
        { name: "独孤剑尘" }, { name: "监工赵四" }, { name: "小杂役" },
      ],
    }));
    // S08 画面: 小杂役+赵四扬鞭;独孤剑尘在 associateAssetsNames 但不在画面
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["金水河码头", "独孤剑尘", "小杂役", "灵矿藤筐"],
      videoDesc: "小杂役指腹被灵矿倒刺扎破，抬头时赵四已从右侧逼近并扬起长鞭；小杂役缩住肩膀。",
    });
    expect(refs?.map((ref) => [ref.title, ref.assetType])).toEqual([
      ["金水河码头", "scene"],
      ["监工赵四", "character"],
      ["小杂役", "character"],
    ]);
  });

  it("keeps a character referenced by full name in frame text", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      role: [{ name: "独孤剑尘" }, { name: "赵四" }],
    }));
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["独孤剑尘", "赵四"],
      prompt: "独孤剑尘低头从两人侧后方经过；赵四手腕压下。",
    });
    expect(refs?.map((ref) => ref.title)).toEqual(["独孤剑尘", "赵四"]);
  });

  it("keeps a character referenced by short name in frame text (R17 正文短名方向)", async () => {
    bridgeMock.mockReturnValue(makeBridge({
      scene: [{ name: "金水塾馆" }],
      role: [{ name: "独孤剑尘" }, { name: "管事", assetName: "李先生;管事" }],
    }));
    // 正文只写「独孤」不写全名——旧逻辑静默滤掉参考,模型自由发挥画成黑发青年
    // (08-28 S10/S21/S35 等实锤);前缀截取(独孤/独孤剑)命中即视为提名
    const refs = await resolveStoryboardAssetReferences({
      associateAssetsNames: ["金水塾馆", "独孤剑尘", "管事"],
      videoDesc: "独孤观察、抬手又停，管事在门口持筹",
    });
    expect(refs?.map((ref) => ref.title)).toEqual(["金水塾馆", "独孤剑尘", "李先生;管事"]);
  });
});

