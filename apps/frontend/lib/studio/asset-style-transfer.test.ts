import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiManager } from "@/lib/ai/ai-manager";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import {
  saveGeneratedAssetImage,
  updateStoreWithResult,
} from "./asset-generation-store-writers";
import {
  buildDaojieStyleTransferInstruction,
  generateAssetStyleTransferImage,
  STYLE_TRANSFER_MODEL,
} from "./asset-style-transfer";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { generateImage: vi.fn() },
}));

vi.mock("./asset-generation-store-writers", () => ({
  saveGeneratedAssetImage: vi.fn(),
  updateStoreWithResult: vi.fn(),
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: vi.fn(() => "asset-style-transfer-fallback"),
  logEvent: vi.fn(),
}));

const generateImage = vi.mocked(aiManager.generateImage);
const logEventMock = vi.mocked(logEvent);
const createOperationIdMock = vi.mocked(createOperationId);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildDaojieStyleTransferInstruction(10-19 画风转换主体句槽终稿)", () => {
  it("三轨变体快照(差异仅在首段保真主语)", () => {
    expect(buildDaojieStyleTransferInstruction("character")).toBe(
      "保持画中人物的身份、姿态与构图不变,画面全部内容与元素位置原样保留;在此前提下,将整幅画面的绘画风格整体转换为美术风格底座所定的画风。",
    );
    expect(buildDaojieStyleTransferInstruction("scene")).toBe(
      "保持画中场景的空间结构与构图不变,画面全部内容与元素位置原样保留;在此前提下,将整幅画面的绘画风格整体转换为美术风格底座所定的画风。",
    );
    expect(buildDaojieStyleTransferInstruction("prop")).toBe(
      "保持画中道具的形态与构图不变,画面全部内容与元素位置原样保留;在此前提下,将整幅画面的绘画风格整体转换为美术风格底座所定的画风。",
    );
  });

  it("守 09 篇纪律:槽内禁复写底座(无标签正文/无底座画法词)", () => {
    for (const assetType of ["character", "scene", "prop"] as const) {
      const text = buildDaojieStyleTransferInstruction(assetType);
      // 底座由装配层(道劫美术风格转换=join(主体句,锁层A))自动追加——槽内禁双写
      expect(text).not.toContain("美术风格底座:");
      expect(text).not.toContain("国风");
      expect(text).not.toContain("线描");
      expect(text).not.toContain("罩染");
      expect(text).not.toContain("连环画");
    }
  });

  it("守 09 篇纪律:单段无换行/保真+操作两段在场/肯定式无否定词", () => {
    for (const assetType of ["character", "scene", "prop"] as const) {
      const text = buildDaojieStyleTransferInstruction(assetType);
      expect(text).not.toContain("\n");
      // 保真段先行+操作段收束(1015 两式并存,本役取保真先行)
      expect(text).toContain("保持");
      expect(text).toContain("原样保留");
      expect(text).toContain("转换为美术风格底座");
      // i2i 路否定式门:无「不要/不得/不能」
      expect(text).not.toContain("不要");
      expect(text).not.toContain("不得");
      expect(text).not.toContain("不能");
    }
  });
});

describe("generateAssetStyleTransferImage", () => {
  it("直通本地渠道:model/prompt/referenceImages 透传,落盘按三轨 category,写回 store", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,StyleTransferred" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/role-styled.png");

    const result = await generateAssetStyleTransferImage({
      assetId: "asset-role-1",
      assetType: "character",
      assetName: "主角",
      referenceImage: "asset-file://role/main.png",
      projectId: "proj-1",
    });

    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage).toHaveBeenCalledWith({
      model: STYLE_TRANSFER_MODEL,
      prompt: buildDaojieStyleTransferInstruction("character"),
      promptPolicy: "raw",
      referenceImages: ["asset-file://role/main.png"],
    });
    expect(STYLE_TRANSFER_MODEL).toBe("qwen-image-2-1");
    expect(saveGeneratedAssetImage).toHaveBeenCalledWith({
      source: "data:image/png;base64,StyleTransferred",
      assetType: "character",
      assetId: "asset-role-1",
      assetName: "主角",
      projectId: "proj-1",
      isDerivative: false,
      category: "characters",
    });
    expect(updateStoreWithResult).toHaveBeenCalledWith("asset-role-1", "character", {
      imageLocalPath: "local-image://characters/role-styled.png",
    });
    expect(result).toEqual({
      phase: "done",
      imageLocalPath: "local-image://characters/role-styled.png",
    });
  });

  it("scene/prop 轨落盘 category 各归 scenes/props", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,IMG" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://scenes/s.png");

    await generateAssetStyleTransferImage({
      assetId: "a-scene",
      assetType: "scene",
      assetName: "山门",
      referenceImage: "asset-file://scene/s.png",
    });
    expect(vi.mocked(saveGeneratedAssetImage).mock.calls[0][0].category).toBe("scenes");

    await generateAssetStyleTransferImage({
      assetId: "a-prop",
      assetType: "prop",
      assetName: "铜钱",
      referenceImage: "asset-file://tool/t.png",
    });
    expect(vi.mocked(saveGeneratedAssetImage).mock.calls[1][0].category).toBe("props");
  });

  it("指令以 raw 策略直发——传输层禁 normalize 再追加(终稿≠漂移复核锁)", async () => {
    // 复核实锤修复锁:缺 promptPolicy:"raw" 时 image-generation-engine 入口
    // normalizeImagePromptForGeneration 会向 prompt 尾拼 CLEAN_IMAGE_PROMPT_TERMS
    // 六条英文清洗词(ai-sdk-bridge.ts appendUniqueTerms),终稿静默漂移且
    // 装配层否定式门只查中文拦不住英文词条——本断言钉死 raw 在场。
    generateImage.mockResolvedValue({ url: "data:image/png;base64,IMG" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/ok.png");

    await generateAssetStyleTransferImage({
      assetId: "asset-raw",
      assetType: "character",
      assetName: "主角",
      referenceImage: "asset-file://role/main.png",
    });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ promptPolicy: "raw" }),
    );
    const sentPrompt = generateImage.mock.calls[0][0].prompt;
    expect(sentPrompt).toBe(buildDaojieStyleTransferInstruction("character"));
    for (const englishTerm of ["clean image", "low visual noise", "denoised details", "clear readable surfaces", "smooth matte finish", "controlled ink wash"]) {
      expect(sentPrompt).not.toContain(englishTerm);
    }
  });

  it("诊断打点贯通:operationId 贯穿构造摘要/发起/成功三事件(10-19 用户令)", async () => {
    generateImage.mockResolvedValue({ url: "data:image/png;base64,IMG" });
    vi.mocked(saveGeneratedAssetImage).mockResolvedValue("local-image://characters/log.png");

    await generateAssetStyleTransferImage({
      assetId: "asset-log",
      assetType: "character",
      assetName: "主角",
      referenceImage: "asset-file://role/main.png",
      operationId: "op-from-handler",
    });

    const entries = logEventMock.mock.calls.map(([entry]) => entry);
    const threaded = entries.filter((entry) => entry.operationId === "op-from-handler");
    expect(threaded.map((entry) => entry.message)).toEqual([
      "Daojie style-transfer instruction built",
      "Asset style transfer generation started",
      "Asset style transfer image saved",
    ]);
    expect(createOperationIdMock).not.toHaveBeenCalled();
    const built = threaded[0];
    expect(built.category).toBe("ai");
    expect(built.context).toMatchObject({ assetType: "character", chars: buildDaojieStyleTransferInstruction("character").length });
  });

  it('生成失败异常透传为 {phase:"failed"}', async () => {
    generateImage.mockRejectedValue(new Error("本地图片生成失败:引擎不在驾"));

    const result = await generateAssetStyleTransferImage({
      assetId: "asset-role-2",
      assetType: "character",
      assetName: "配角",
      referenceImage: "asset-file://role/sub.png",
    });

    expect(result).toEqual({
      phase: "failed",
      error: "本地图片生成失败:引擎不在驾",
    });
    expect(saveGeneratedAssetImage).not.toHaveBeenCalled();
    expect(updateStoreWithResult).not.toHaveBeenCalled();
    // 失败也留痕:兜底 operationId(未传时自造)+ error 事件在场
    const failureEntries = logEventMock.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry.message === "Asset style transfer failed");
    expect(failureEntries).toHaveLength(1);
    expect(failureEntries[0].level).toBe("error");
    expect(failureEntries[0].operationId).toBe("asset-style-transfer-fallback");
    expect(failureEntries[0].context).toMatchObject({ stage: "generating" });
  });

  it("生成未返回 URL 按 failed 收口", async () => {
    generateImage.mockResolvedValue({ url: "" });

    const result = await generateAssetStyleTransferImage({
      assetId: "asset-role-3",
      assetType: "character",
      assetName: "龙套",
      referenceImage: "asset-file://role/x.png",
    });

    expect(result.phase).toBe("failed");
    expect(saveGeneratedAssetImage).not.toHaveBeenCalled();
  });
});
