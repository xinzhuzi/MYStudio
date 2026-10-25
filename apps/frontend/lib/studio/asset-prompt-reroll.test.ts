import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiManager } from "@/lib/ai/ai-manager";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";
import {
  PROMPT_REROLL_MODEL,
  buildPromptRerollImageName,
  rerollAssetImageFromPromptText,
} from "./asset-prompt-reroll";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { generateImage: vi.fn() },
}));

vi.mock("./asset-generation-store-writers", () => ({
  saveGeneratedAssetImage: vi.fn(),
  updateStoreWithResult: vi.fn(),
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: vi.fn(() => "asset-prompt-reroll-fallback"),
  logEvent: vi.fn(),
}));

const generateImage = vi.mocked(aiManager.generateImage);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveGeneratedAssetImage).mockResolvedValue("/tmp/saved-role.png");
});

describe("buildPromptRerollImageName · 命名(废主图名号令族)", () => {
  it("原图名_重掷_中文日期;「重掷」非型标记,归型仍随原图名(右最标记不动)", () => {
    const name = buildPromptRerollImageName("晏燎_金丹期_海报_v1", new Date(2026, 9, 25));
    expect(name).toBe("晏燎_金丹期_海报_v1_重掷_2026年10月25日");
  });
});

describe("rerollAssetImageFromPromptText · B-4 用此词重掷(10-25 追加令)", () => {
  const baseTask = {
    assetId: "a1",
    assetName: "晏燎",
    assetType: "role" as const,
    imageName: "晏燎_金丹期_海报_v1",
    finalText: "以画中人物为基准,重绘为叙事海报(引擎实收终稿逐字)",
    routeHint: "i2i" as const,
    hasInjectedLayers: true,
    referenceImageUrl: "asset-file://role/yanliao-poster.png",
  };

  it("i2i+注入层在场:终稿逐字 raw 重发+原图参考+按名归型重注 base_type;seed 不复用", async () => {
    generateImage.mockResolvedValue({ url: "http://gen/result.png" } as never);
    const progress: string[] = [];
    const result = await rerollAssetImageFromPromptText(baseTask, (p) => progress.push(p.phase));

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: PROMPT_REROLL_MODEL,
        prompt: baseTask.finalText,
        promptPolicy: "raw",
        referenceImages: [baseTask.referenceImageUrl],
        extraParams: { base_type: "人物海报" },
      }),
    );
    expect(result.phase).toBe("done");
    expect(result.resultImageName).toContain("_重掷_");
    expect(result.resultKind).toBe("人物海报");
    expect(progress).toEqual(["generating", "saving"]);
    expect(updateStoreWithResult).toHaveBeenCalled();
  });

  it("i2i+注入层缺席(画风转换族):不带 base_type(忠实原路,不注型)", async () => {
    generateImage.mockResolvedValue({ url: "http://gen/result.png" } as never);
    await rerollAssetImageFromPromptText({ ...baseTask, hasInjectedLayers: false });
    const call = generateImage.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(call.extraParams).toBeUndefined();
    expect(call.referenceImages).toEqual([baseTask.referenceImageUrl]);
  });

  it("t2i 路:无参考图纯文字重发,注入层在场仍带 base_type", async () => {
    generateImage.mockResolvedValue({ url: "http://gen/result.png" } as never);
    const r = await rerollAssetImageFromPromptText({
      ...baseTask,
      imageName: "独孤剑尘_高清大脸_2026年10月21日",
      routeHint: "t2i",
      hasInjectedLayers: true,
      referenceImageUrl: undefined,
    });
    expect(r.phase).toBe("done");
    const call = generateImage.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(call.referenceImages).toBeUndefined();
    expect(call.extraParams).toEqual({ base_type: "高清人脸" });
    expect(r.resultKind).toBe("高清人脸");
  });

  it("守卫:空终稿/三轨外资产/i2i 缺参考图各自拒收(禁静默)", async () => {
    await expect(rerollAssetImageFromPromptText({ ...baseTask, finalText: "  " })).resolves.toMatchObject({
      phase: "failed",
      error: expect.stringContaining("正向终稿为空"),
    });
    await expect(
      rerollAssetImageFromPromptText({ ...baseTask, assetType: "audio" as never }),
    ).resolves.toMatchObject({ phase: "failed", error: expect.stringContaining("三轨") });
    await expect(
      rerollAssetImageFromPromptText({ ...baseTask, referenceImageUrl: undefined }),
    ).resolves.toMatchObject({ phase: "failed", error: expect.stringContaining("参考图") });
    expect(generateImage).not.toHaveBeenCalled();
  });
});
