import { describe, expect, it, vi } from "vitest";
import type {
  EditingValidationResult,
  TimelineRenderEvidence,
  TimelineRenderPlan,
} from "@/types/editing";
import { createTimelineRenderRequest } from "../contracts/timeline-renderer";
import type { TimelineRendererAdapter } from "./renderer-registry";
import { createTimelineRenderHost } from "./timeline-render-host";

describe("createTimelineRenderHost", () => {
  it("runs direct FFmpeg requests through the FFmpeg adapter", async () => {
    const plan = planFixture([]);
    const ffmpeg = adapter("ffmpeg");
    const host = hostWith(plan, [ffmpeg.value]);

    await expect(host.render(createTimelineRenderRequest("ffmpeg", plan))).resolves.toEqual({
      success: true,
      evidence: {
        ...evidenceFixture(plan.jobId),
        renderer: { requested: "ffmpeg", actual: "ffmpeg" },
      },
    });
    expect(ffmpeg.render).toHaveBeenCalledWith(plan, {
      renderer: { requested: "ffmpeg", actual: "ffmpeg" },
    });
  });

  it("routes unsupported Remotion effects to FFmpeg with structured evidence", async () => {
    const plan = planFixture([
      { effectId: "grain", enabled: true },
      { effectId: "blur", enabled: true },
    ]);
    const ffmpeg = adapter("ffmpeg");
    const host = hostWith(plan, [ffmpeg.value]);

    const result = await host.render(createTimelineRenderRequest("remotion", plan));

    expect(result).toMatchObject({
      success: true,
      evidence: {
        renderer: {
          requested: "remotion",
          actual: "ffmpeg",
          fallback: {
            code: "unsupported-effects",
            effectIds: ["blur", "grain"],
          },
        },
      },
    });
    expect(ffmpeg.render).toHaveBeenCalledOnce();
  });

  it("does not call FFmpeg after a Remotion runtime failure", async () => {
    const plan = planFixture([{ effectId: "panZoom", enabled: true }]);
    const ffmpeg = adapter("ffmpeg");
    const remotion = adapter("remotion", {
      success: false,
      jobId: plan.jobId,
      canceled: false,
      error: "Remotion worker crashed",
    });
    const host = hostWith(plan, [ffmpeg.value, remotion.value]);

    await expect(host.render(createTimelineRenderRequest("remotion", plan))).resolves.toEqual({
      success: false,
      jobId: plan.jobId,
      canceled: false,
      error: "Remotion worker crashed",
    });
    expect(remotion.render).toHaveBeenCalledOnce();
    expect(ffmpeg.render).not.toHaveBeenCalled();
  });

  it("fails explicitly when the selected Remotion adapter is absent", async () => {
    const plan = planFixture([]);
    const ffmpeg = adapter("ffmpeg");
    const progress = vi.fn();
    const host = createTimelineRenderHost({
      adapters: [ffmpeg.value],
      emitProgress: progress,
      validatePlan: () => ({ success: true, value: plan }),
    });

    await expect(host.render(createTimelineRenderRequest("remotion", plan))).resolves.toEqual({
      success: false,
      jobId: plan.jobId,
      canceled: false,
      error: "时间线渲染器未注册: remotion",
    });
    expect(ffmpeg.render).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      jobId: plan.jobId,
      stage: "failed",
    }));
  });
});

function hostWith(
  plan: TimelineRenderPlan,
  adapters: TimelineRendererAdapter[],
) {
  const validation: EditingValidationResult<TimelineRenderPlan> = {
    success: true,
    value: plan,
  };
  return createTimelineRenderHost({
    adapters,
    emitProgress: vi.fn(),
    validatePlan: () => validation,
  });
}

function adapter(
  id: TimelineRendererAdapter["id"],
  result: Awaited<ReturnType<TimelineRendererAdapter["render"]>> = {
    success: true,
    evidence: evidenceFixture("job-1"),
  },
) {
  const render = vi.fn(async (
    _plan: TimelineRenderPlan,
    context: Parameters<TimelineRendererAdapter["render"]>[1],
  ) => result.success
    ? {
      ...result,
      evidence: { ...result.evidence, renderer: context.renderer },
    }
    : result);
  const cancel = vi.fn(() => ({
    success: true as const,
    jobId: "job-1",
    canceled: true,
  }));
  return { render, cancel, value: { id, render, cancel } };
}

function planFixture(
  effects: Array<{ effectId: string; enabled: boolean }>,
): TimelineRenderPlan {
  return { jobId: "job-1", effects } as unknown as TimelineRenderPlan;
}

function evidenceFixture(jobId: string): TimelineRenderEvidence {
  return {
    jobId,
    path: "/tmp/output.mp4",
    sizeBytes: 1,
    mtimeMs: 1,
    sha256: "a".repeat(64),
    duration: 1,
    width: 1080,
    height: 1920,
    streams: ["video", "audio"],
    snapshotHash: "b".repeat(64),
    snapshotPath: "/tmp/snapshot.json",
  };
}
