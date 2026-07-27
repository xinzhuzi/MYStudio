import { describe, expect, it } from "vitest";
import {
  decodeSelfMediaIpcReply,
  decodeSelfMediaProgressEvent,
  decodeSelfMediaTaskResult,
} from "./ipc-contract";
import { validateSelfMediaDraft } from "./contracts";

const task = {
  id: "task-1",
  attemptId: "attempt-1",
  projectId: "project-1",
  providerId: "aitoearn-local",
  accountId: "account-1",
  sourceAssetIds: ["asset-1"],
  status: "success",
  progress: 100,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:01.000Z",
};

describe("self-media IPC runtime contracts", () => {
  it("rejects an unknown task status in a successful reply", () => {
    expect(() => decodeSelfMediaIpcReply({
      success: true,
      value: [{ ...task, status: "provider-new-status" }],
    })).toThrow("Invalid self-media task payload");
  });

  it("rejects NaN and unknown statuses in progress events", () => {
    expect(() => decodeSelfMediaProgressEvent({
      projectId: "project-1",
      taskId: "task-1",
      status: "provider-new-status",
      progress: 20,
    })).toThrow("Invalid self-media progress event");
    expect(() => decodeSelfMediaProgressEvent({
      projectId: "project-1",
      taskId: "task-1",
      status: "running",
      progress: Number.NaN,
    })).toThrow("Invalid self-media progress event");
  });

  it("rejects malformed provider task results before state transition", () => {
    expect(() => decodeSelfMediaTaskResult({ status: "provider-new-status" })).toThrow("Invalid self-media task status");
    expect(() => decodeSelfMediaTaskResult({ status: "running", progress: Number.NaN })).toThrow("Invalid self-media task progress");
  });

  it("rebuilds drafts from allowlisted fields and rejects credential-shaped input", () => {
    const draft = {
      id: "draft-1",
      projectId: "project-1",
      contentType: "video",
      title: "标题",
      description: "描述",
      topics: ["话题"],
      assets: [{ assetId: "asset-1", projectId: "project-1", kind: "video", ignored: true }],
      accountIds: ["account-1"],
      visibility: "public",
      platformOptions: { platform: "xhs", ignored: "discarded" },
      updatedAt: "2026-07-27T00:00:00.000Z",
      ignored: "discarded",
    };
    const result = validateSelfMediaDraft(draft);
    expect(result).toEqual({
      success: true,
      value: expect.objectContaining({
        platformOptions: { platform: "xhs" },
        assets: [{ assetId: "asset-1", projectId: "project-1", kind: "video", approvedUrl: undefined, thumbnailUrl: undefined }],
      }),
    });
    if (result.success) expect("ignored" in result.value).toBe(false);
    expect(validateSelfMediaDraft({ ...draft, apiKey: "do-not-persist" })).toMatchObject({ success: false });
  });
});
