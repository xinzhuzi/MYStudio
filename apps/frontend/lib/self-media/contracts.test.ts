import { describe, expect, it } from "vitest";
import { validateSelfMediaDraft } from "./contracts";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    projectId: "project-1",
    contentType: "video",
    title: "测试视频",
    description: "",
    topics: [],
    assets: [{ assetId: "asset-1", projectId: "project-1", kind: "video" }],
    accountIds: ["account-1"],
    visibility: "public",
    platformOptions: { platform: "xhs" },
    updatedAt: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateSelfMediaDraft", () => {
  it("accepts a project-scoped video draft", () => {
    expect(validateSelfMediaDraft(draft())).toMatchObject({ success: true });
  });

  it("rejects arbitrary filesystem paths and cross-project assets", () => {
    expect(validateSelfMediaDraft(draft({
      assets: [{ assetId: "/tmp/private/video.mp4", projectId: "project-1", kind: "video" }],
    }))).toMatchObject({ success: false });
    expect(validateSelfMediaDraft(draft({
      assets: [{ assetId: "asset-1", projectId: "other-project", kind: "video" }],
    }))).toMatchObject({ success: false });
  });

  it("rejects a platform/content mismatch before IPC", () => {
    const result = validateSelfMediaDraft(draft({ contentType: "image-text", platformOptions: { platform: "wxSph" }, assets: [{ assetId: "image-1", projectId: "project-1", kind: "image" }] }));
    expect(result).toMatchObject({ success: false });
  });

  it("accepts a douyin image-text draft because the local bridge implements publishImageWorkApi", () => {
    const result = validateSelfMediaDraft(draft({ contentType: "image-text", platformOptions: { platform: "douyin" }, assets: [{ assetId: "image-1", projectId: "project-1", kind: "image" }] }));
    expect(result).toMatchObject({ success: true });
  });
});
