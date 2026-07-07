// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { polishAssetPrompt } from "./prompt-polisher";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    text: vi.fn(),
    featureText: vi.fn(),
  },
}));

describe("polishAssetPrompt", () => {
  beforeEach(() => {
    vi.mocked(aiManager.text).mockResolvedValue({
      success: true,
      text: "ink fantasy elder, cinematic character sheet\n\nNegative Prompt: blurry",
    });
    vi.mocked(aiManager.featureText).mockResolvedValue(
      "feature-bound ink fantasy elder, cinematic character sheet\n\nNegative Prompt: blurry",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.studioVisualManuals;
  });

  it("loads visual manual modules from runtime storage before falling back to bundled manuals", async () => {
    const readManual = vi.fn().mockResolvedValue({
      success: true,
      manual: {
        modules: [
          { value: "prefix", content: "runtime daojie prefix" },
          { value: "art_character", content: "runtime daojie character template" },
        ],
      },
    });
    window.studioVisualManuals = {
      read: readManual,
    } as any;

    const result = await polishAssetPrompt({
      assetType: "character",
      name: "老苦力",
      description: "年迈、粗布衣、长期劳作",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    expect(readManual).toHaveBeenCalledWith("daojie_ink_guofeng");
    expect(aiManager.featureText).toHaveBeenCalled();
    const request = vi.mocked(aiManager.featureText).mock.calls[0];
    expect(request?.[1]).toContain("runtime daojie prefix");
    expect(request?.[1]).toContain("runtime daojie character template");
  });

  it("uses feature-bound text generation instead of the universal agent by default", async () => {
    window.studioVisualManuals = {
      read: vi.fn().mockResolvedValue({
        success: true,
        manual: {
          modules: [
            { value: "prefix", content: "runtime prefix" },
            { value: "art_character", content: "runtime character template" },
          ],
        },
      }),
    } as any;

    const result = await polishAssetPrompt({
      assetType: "character",
      name: "老苦力",
      description: "年迈、粗布衣、长期劳作",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    expect(result.prompt).toContain("feature-bound ink fantasy elder");
    expect(aiManager.featureText).toHaveBeenCalledWith(
      "script_analysis",
      expect.stringContaining("runtime prefix"),
      expect.stringContaining("角色名称:老苦力"),
      expect.objectContaining({ maxTokens: 2048 }),
    );
    expect(aiManager.text).not.toHaveBeenCalled();
  });

  it("adds denoise and clean-image constraints to polished image prompts", async () => {
    vi.mocked(aiManager.featureText).mockResolvedValue(
      "ink fantasy elder, cinematic character sheet\n\nNegative Prompt: blurry",
    );
    window.studioVisualManuals = {
      read: vi.fn().mockResolvedValue({
        success: true,
        manual: {
          modules: [
            { value: "prefix", content: "runtime prefix" },
            { value: "art_character", content: "runtime character template" },
          ],
        },
      }),
    } as any;

    const result = await polishAssetPrompt({
      assetType: "character",
      name: "老苦力",
      description: "年迈、粗布衣、长期劳作",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    expect(result.prompt).toContain("clean image");
    expect(result.prompt).toContain("low visual noise");
    expect(result.negativePrompt).toContain("visual noise");
    expect(result.negativePrompt).toContain("dirty texture");
    expect(result.negativePrompt).toContain("jpeg artifacts");
  });

  it("falls back to a local visual-manual prompt when text models are unavailable", async () => {
    vi.mocked(aiManager.featureText).mockRejectedValue(new Error("Invalid token"));
    vi.mocked(aiManager.text).mockResolvedValue({
      success: false,
      error: "OpenAI 兼容: fetch failed",
    });
    window.studioVisualManuals = {
      read: vi.fn().mockResolvedValue({
        success: true,
        manual: {
          modules: [
            {
              value: "prefix",
              content: "| 质量锚定 | `(best quality, masterpiece), Chinese fantasy ink render, sharp focus` |",
            },
            { value: "art_character", content: "角色立绘模板" },
          ],
        },
      }),
    } as any;

    const result = await polishAssetPrompt({
      assetType: "character",
      name: "老苦力",
      description: "",
      isDerivative: false,
      visualManualId: "daojie_ink_guofeng",
    });

    expect(result.status).toBe("success");
    expect(result.prompt).toContain("老苦力");
    expect(result.prompt).toContain("Chinese fantasy ink render");
    expect(result.negativePrompt).toContain("watermark");
  });
});
