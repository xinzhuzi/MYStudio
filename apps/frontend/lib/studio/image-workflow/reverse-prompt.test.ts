import { afterEach, describe, expect, it, vi } from "vitest";
import { reversePromptFromImage, REVERSE_PROMPT_SYSTEM } from "./reverse-prompt";

vi.mock("@/lib/ai/feature-router", () => ({
  callFeatureMultimodalAPI: vi.fn(async (_feature, messages) => {
    const user = messages[1];
    const content = user.content as Array<{ type: string }>;
    if (!Array.isArray(content) || !content.some((part) => part.type === "image_url")) {
      throw new Error("缺少图片内容");
    }
    return "  一位白发剑客立于山巅,水墨国风,冷色调,晨雾逆光,35mm 镜头  ";
  }),
}));

vi.mock("@/lib/ai/image-transfer", () => ({
  prepareReferenceImageForTransfer: vi.fn(async (source: string) => source),
}));

vi.mock("@/lib/media/preview-src", () => ({
  toPreviewSrc: (source: string) => source,
}));

afterEach(() => vi.clearAllMocks());

describe("reversePromptFromImage", () => {
  it("缩略后走多模态,返回去空白正文,system 提示词含『只输出提示词正文』", async () => {
    const text = await reversePromptFromImage("project-file://x/a.png", {
      toDataUrl: async () => "data:image/png;base64,QQ==",
    });
    expect(text).toBe("一位白发剑客立于山巅,水墨国风,冷色调,晨雾逆光,35mm 镜头");
    const { callFeatureMultimodalAPI } = await import("@/lib/ai/feature-router");
    const call = vi.mocked(callFeatureMultimodalAPI).mock.calls[0];
    expect(call[0]).toBe("image_understanding");
    expect(String(call[1][0].content)).toContain("只输出提示词正文");
    expect(REVERSE_PROMPT_SYSTEM).toContain("提示词");
  });

  it("空返回显式报错", async () => {
    const { callFeatureMultimodalAPI } = await import("@/lib/ai/feature-router");
    vi.mocked(callFeatureMultimodalAPI).mockResolvedValueOnce("   ");
    await expect(reversePromptFromImage("project-file://x/b.png", { toDataUrl: async () => "data:image/png;base64,QQ==" })).rejects.toThrow("未返回提示词");
  });
});
