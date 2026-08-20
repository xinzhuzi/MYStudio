import { describe, expect, it } from "vitest";
import {
  validateVideoWorkflowChapterReadReply,
  validateVideoWorkflowChapterReadRequest,
  validateVideoWorkflowChapterApplyRequest,
  validateVideoWorkflowChapterRunRequest,
  validateVideoWorkflowActionReply,
  validateVideoWorkflowPluginActionRequest,
  validateVideoWorkflowReviewReply,
  validateVideoWorkflowReviewRequest,
  validateVideoWorkflowStatusReply,
} from "./video-workflow-ipc";

const hash = "a".repeat(64);
const plugin = {
  schemaVersion: 1,
  pluginId: "video-use",
  displayName: "video-use",
  sourceUrl: "https://github.com/browser-use/video-use",
  sourceCommit: hash,
  license: "MIT",
  appVersion: "0.0.1",
  pluginVersion: hash,
  runtimeState: "needs-runtime",
  dependencies: {},
  checkedAt: 1,
};

describe("video workflow IPC contracts", () => {
  it("accepts only one known plugin id and rejects unknown fields", () => {
    expect(validateVideoWorkflowPluginActionRequest({ pluginId: "video-use" }).success).toBe(true);
    expect(validateVideoWorkflowPluginActionRequest({ pluginId: "video-use", shell: "rm -rf" }).success).toBe(false);
    expect(validateVideoWorkflowPluginActionRequest({ pluginId: "unknown" }).success).toBe(false);
  });

  it("validates status and action replies at the renderer boundary", () => {
    const status = { schemaVersion: 1, checkedAt: 1, plugins: [{ ...plugin, runtimeCode: "alignment-model-missing" }] };
    expect(validateVideoWorkflowStatusReply(status).success).toBe(true);
    expect(validateVideoWorkflowStatusReply({ ...status, plugins: [{ ...plugin, runtimeCode: 1 }] }).success).toBe(false);
    expect(validateVideoWorkflowActionReply({ ...status, success: false, message: "blocked" }).success).toBe(true);
    expect(validateVideoWorkflowActionReply({ ...status, success: "false" }).success).toBe(false);
  });

  it("validates the user review request and reply", () => {
    expect(validateVideoWorkflowReviewRequest({ projectId: "p", chapterId: "c", revision: 1, reviewer: "user" }).success).toBe(true);
    expect(validateVideoWorkflowReviewRequest({ projectId: "p", chapterId: "c", revision: 0, reviewer: "user" }).success).toBe(false);
    expect(validateVideoWorkflowReviewReply({ schemaVersion: 1, success: true, projectId: "p", chapterId: "c", revision: 1, status: "accepted" }).success).toBe(true);
    expect(validateVideoWorkflowReviewReply({ schemaVersion: 1, success: true, projectId: "p", chapterId: "c", revision: 1, status: "pending" }).success).toBe(false);
  });

  it("validates latest or exact chapter restore requests and renderer-safe replies", () => {
    expect(validateVideoWorkflowChapterReadRequest({ schemaVersion: 1, projectId: "p", chapterId: "c" }).success).toBe(true);
    expect(validateVideoWorkflowChapterReadRequest({ schemaVersion: 1, projectId: "p", chapterId: "c", revision: 2 }).success).toBe(true);
    expect(validateVideoWorkflowChapterReadRequest({ schemaVersion: 1, projectId: "p", chapterId: "c", revision: 0 }).success).toBe(false);
    expect(validateVideoWorkflowChapterReadReply({ schemaVersion: 1, projectId: "p", chapterId: "c", revision: 2, videoUseState: "accepted", hyperFramesState: "noop", inputSha256: hash }).success).toBe(true);
    expect(validateVideoWorkflowChapterReadReply({ schemaVersion: 1, projectId: "p", chapterId: "c", videoUseState: "accepted", hyperFramesState: "missing" }).success).toBe(false);
  });

  it("defaults derived input handling to reject and accepts only the explicit padding policy", () => {
    const base = {
      schemaVersion: 1,
      projectId: "p",
      chapterId: "c",
      revision: 1,
      mode: "editable-edl",
      shots: [{ shotId: "shot-1" }],
      sourceSha256: hash,
      audioSha256: hash,
      textSha256: hash,
      featureFlags: { alignment: true, edl: true, subtitles: true, grade: true, preview: true, selfEval: true },
    };
    expect(validateVideoWorkflowChapterRunRequest(base).success).toBe(true);
    expect(validateVideoWorkflowChapterRunRequest({ ...base, derivedInputPolicy: "pad-video-to-audio" }).success).toBe(true);
    expect(validateVideoWorkflowChapterRunRequest({ ...base, derivedInputPolicy: "always-pad" }).success).toBe(false);
    expect(validateVideoWorkflowChapterRunRequest({
      ...base,
      boundaryIntents: [{
        fromShotId: "shot-1",
        toShotId: "shot-2",
        effectId: "gl:CrossZoom",
        durationUs: 500_000,
        styleWord: "境界跃迁",
      }],
    }).success).toBe(true);
    expect(validateVideoWorkflowChapterRunRequest({
      ...base,
      boundaryIntents: [{
        fromShotId: "shot-1",
        toShotId: "shot-2",
        effectId: "gl:NotInRegistry",
        durationUs: 500_000,
      }],
    }).success).toBe(false);
  });

  it("rejects PNG sequence at the typed apply boundary", () => {
    expect(validateVideoWorkflowChapterApplyRequest({
      schemaVersion: 1,
      projectId: "p",
      chapterId: "c",
      revision: 1,
      inputSha256: hash,
      width: 640,
      height: 360,
      fps: 30,
      alphaFormat: "png-sequence",
    }).success).toBe(false);
  });
});
