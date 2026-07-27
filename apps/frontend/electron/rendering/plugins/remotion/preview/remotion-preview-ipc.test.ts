import { describe, expect, it } from "vitest";
import {
  REMOTION_PREVIEW_CREATE_CHANNEL,
  REMOTION_PREVIEW_RELEASE_CHANNEL,
  validateRemotionPreviewCreateReply,
  validateRemotionPreviewCreateRequest,
  validateRemotionPreviewReleaseReply,
  validateRemotionPreviewReleaseRequest,
} from "./remotion-preview-ipc";

describe("Remotion preview IPC contracts", () => {
  it("uses fixed channels and rejects unvalidated plans or caller fields", () => {
    expect(REMOTION_PREVIEW_CREATE_CHANNEL).toBe("remotion-preview-create");
    expect(REMOTION_PREVIEW_RELEASE_CHANNEL).toBe("remotion-preview-release");
    expect(validateRemotionPreviewCreateRequest({ plan: {}, outputPath: "/tmp/out.mp4" }).success).toBe(false);
    expect(validateRemotionPreviewCreateRequest({ plan: {} }).success).toBe(false);
  });

  it("accepts only exact non-empty release session IDs", () => {
    expect(validateRemotionPreviewReleaseRequest({ sessionId: "preview-1" }).success).toBe(true);
    expect(validateRemotionPreviewReleaseRequest({ sessionId: "", token: "secret" }).success).toBe(false);
    expect(validateRemotionPreviewReleaseReply({ sessionId: "preview-1", released: true }).success).toBe(true);
    expect(validateRemotionPreviewReleaseReply({ sessionId: "preview-1", released: false }).success).toBe(false);
  });

  it("rejects malformed create replies before Player receives them", () => {
    expect(validateRemotionPreviewCreateReply({
      sessionId: "preview-1",
      composition: { width: 0 },
    }).success).toBe(false);
  });
});
