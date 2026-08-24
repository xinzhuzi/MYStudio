import { describe, expect, it } from "vitest";
import {
  validateRemotionRenderWorkerCommand,
  validateRemotionRenderWorkerEvent,
} from "./remotion-render-worker-protocol";

const input = {
  plan: { jobId: "job-1" },
  bundlePath: "/tmp/bundle",
  outputPath: "/tmp/output.mp4",
  browserExecutable: "/tmp/headless-shell",
  remotionVersion: "4.0.499",
  mediaUrlByClipId: {},
};

describe("Remotion render worker protocol", () => {
  it("accepts render/cancel commands and rejects unknown fields", () => {
    expect(validateRemotionRenderWorkerCommand({ schemaVersion: 1, requestId: "r1", action: "render", input })).toMatchObject({ success: true });
    expect(validateRemotionRenderWorkerCommand({ schemaVersion: 1, requestId: "r1", action: "cancel", jobId: "job-1" })).toMatchObject({ success: true });
    expect(validateRemotionRenderWorkerCommand({ schemaVersion: 1, requestId: "r1", action: "render", input, source: "unsafe" })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerCommand({
      schemaVersion: 1,
      requestId: "shot-r1",
      action: "render",
      input: {
        target: "shot",
        jobId: "shot:job-1",
        shotPlan: {},
        compositionProps: {},
        compositionId: "StoryboardShot",
        bundlePath: "/tmp/bundle",
        outputPath: "/tmp/output.mp4",
        browserExecutable: "/tmp/headless-shell",
        remotionVersion: "4.0.499",
      },
    })).toMatchObject({ success: true });
    expect(validateRemotionRenderWorkerCommand({
      schemaVersion: 1,
      requestId: "chapter-r1",
      action: "render",
      input: {
        target: "chapter",
        jobId: "chapter:job-1",
        compositionProps: {},
        compositionId: "ChapterVideo",
        bundlePath: "/tmp/bundle",
        outputPath: "/tmp/chapter.mp4",
        browserExecutable: "/tmp/headless-shell",
        remotionVersion: "4.0.499",
      },
    })).toMatchObject({ success: true });
  });

  it("accepts chapter input with inclusive frameRange (scene segment)", () => {
    expect(validateRemotionRenderWorkerCommand({
      schemaVersion: 1,
      requestId: "scene-r1",
      action: "render",
      input: {
        target: "chapter",
        jobId: "chapter-scene:job-1",
        compositionProps: {},
        compositionId: "ChapterVideo",
        bundlePath: "/tmp/bundle",
        outputPath: "/tmp/scene.mp4",
        browserExecutable: "/tmp/headless-shell",
        remotionVersion: "4.0.499",
        frameRange: [12, 240],
      },
    })).toMatchObject({ success: true });
  });

  it("rejects malformed chapter frameRange", () => {
    const base = {
      schemaVersion: 1,
      requestId: "scene-r2",
      action: "render" as const,
      input: {
        target: "chapter",
        jobId: "chapter-scene:job-1",
        compositionProps: {},
        compositionId: "ChapterVideo",
        bundlePath: "/tmp/bundle",
        outputPath: "/tmp/scene.mp4",
        browserExecutable: "/tmp/headless-shell",
        remotionVersion: "4.0.499",
      },
    };
    expect(validateRemotionRenderWorkerCommand({ ...base, input: { ...base.input, frameRange: [240, 12] } })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerCommand({ ...base, input: { ...base.input, frameRange: [1.5, 12] } })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerCommand({ ...base, input: { ...base.input, frameRange: [-1, 12] } })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerCommand({ ...base, input: { ...base.input, frameRange: [12] } })).toMatchObject({ success: false });
  });

  it("rejects frameRange on shot input (scene segments are chapter-scoped)", () => {
    expect(validateRemotionRenderWorkerCommand({
      schemaVersion: 1,
      requestId: "shot-r1",
      action: "render",
      input: {
        target: "shot",
        jobId: "shot:job-1",
        shotPlan: {},
        compositionProps: {},
        compositionId: "StoryboardShot",
        bundlePath: "/tmp/bundle",
        outputPath: "/tmp/shot.mp4",
        browserExecutable: "/tmp/headless-shell",
        remotionVersion: "4.0.499",
        frameRange: [0, 10],
      },
    } as never)).toMatchObject({ success: false });
  });

  it("validates progress and terminal events", () => {
    expect(validateRemotionRenderWorkerEvent({ kind: "progress", requestId: "r1", progress: { jobId: "job-1", stage: "rendering", ratio: 0.5 } })).toMatchObject({ success: true });
    expect(validateRemotionRenderWorkerEvent({ kind: "result", requestId: "r1", result: { success: false, jobId: "job-1", canceled: true, error: "cancelled" } })).toMatchObject({ success: true });
    expect(validateRemotionRenderWorkerEvent({ kind: "progress", requestId: "r1", progress: { jobId: "job-1", stage: "rendering", ratio: 2 } })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerEvent({ kind: "result", requestId: "r1", result: { success: true } })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerEvent({ kind: "result", requestId: "r1", result: { success: false, jobId: "job-1" } })).toMatchObject({ success: false });
  });
});
