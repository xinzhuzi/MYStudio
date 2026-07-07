import { describe, expect, it, vi } from "vitest";
import { prepareImageWorkflowReferenceImages } from "./image-workflow-references";

describe("image workflow reference images", () => {
  it("converts project-file references to base64 before model calls", async () => {
    const readProjectFileAsBase64 = vi.fn().mockResolvedValue({
      success: true,
      base64: "data:image/png;base64,PROJECT_IMAGE",
    });

    await expect(
      prepareImageWorkflowReferenceImages(
        ["project-file://daojie/workflow-images/flow/ref.png", "https://example.test/ref.png"],
        { readProjectFileAsBase64 },
      ),
    ).resolves.toEqual([
      "data:image/png;base64,PROJECT_IMAGE",
      "https://example.test/ref.png",
    ]);
  });

  it("preserves reference order while converting only project-file values", async () => {
    const readProjectFileAsBase64 = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        base64: "data:image/png;base64,CHAR",
      })
      .mockResolvedValueOnce({
        success: true,
        base64: "data:image/png;base64,SCENE",
      });

    await expect(
      prepareImageWorkflowReferenceImages(
        [
          "project-file://dao/assets/char.png",
          "https://example.test/variation.png",
          "project-file://dao/assets/scene.png",
          "data:image/png;base64,PROP",
        ],
        { readProjectFileAsBase64 },
      ),
    ).resolves.toEqual([
      "data:image/png;base64,CHAR",
      "https://example.test/variation.png",
      "data:image/png;base64,SCENE",
      "data:image/png;base64,PROP",
    ]);
    expect(readProjectFileAsBase64).toHaveBeenNthCalledWith(1, "project-file://dao/assets/char.png");
    expect(readProjectFileAsBase64).toHaveBeenNthCalledWith(2, "project-file://dao/assets/scene.png");
  });

  it("throws instead of sending unreadable project-file URLs to external image APIs", async () => {
    await expect(
      prepareImageWorkflowReferenceImages(
        ["project-file://daojie/workflow-images/flow/missing.png"],
        {
          readProjectFileAsBase64: vi.fn().mockResolvedValue({
            success: false,
            error: "missing",
          }),
        },
      ),
    ).rejects.toThrow("项目内参考图读取失败");
  });
});
