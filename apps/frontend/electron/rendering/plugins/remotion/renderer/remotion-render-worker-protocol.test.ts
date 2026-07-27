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
  });

  it("validates progress and terminal events", () => {
    expect(validateRemotionRenderWorkerEvent({ kind: "progress", requestId: "r1", progress: { jobId: "job-1", stage: "rendering", ratio: 0.5 } })).toMatchObject({ success: true });
    expect(validateRemotionRenderWorkerEvent({ kind: "result", requestId: "r1", result: { success: false, jobId: "job-1", canceled: true, error: "cancelled" } })).toMatchObject({ success: true });
    expect(validateRemotionRenderWorkerEvent({ kind: "progress", requestId: "r1", progress: { jobId: "job-1", stage: "rendering", ratio: 2 } })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerEvent({ kind: "result", requestId: "r1", result: { success: true } })).toMatchObject({ success: false });
    expect(validateRemotionRenderWorkerEvent({ kind: "result", requestId: "r1", result: { success: false, jobId: "job-1" } })).toMatchObject({ success: false });
  });
});
