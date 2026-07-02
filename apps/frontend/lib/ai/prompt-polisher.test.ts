// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { polishAssetPrompt } from "./prompt-polisher";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    text: vi.fn(),
  },
}));

describe("polishAssetPrompt", () => {
  beforeEach(() => {
    vi.mocked(aiManager.text).mockResolvedValue({
      success: true,
      text: "ink fantasy elder, cinematic character sheet\n\nNegative Prompt: blurry",
    });
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
    expect(aiManager.text).toHaveBeenCalled();
    const request = vi.mocked(aiManager.text).mock.calls[0]?.[0];
    expect(request?.messages[0]?.content).toContain("runtime daojie prefix");
    expect(request?.messages[0]?.content).toContain("runtime daojie character template");
  });
});
