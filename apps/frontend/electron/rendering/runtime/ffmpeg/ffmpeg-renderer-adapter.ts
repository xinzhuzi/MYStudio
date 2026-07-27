import type { TimelineRendererAdapter } from "../renderer-registry";

export function createFfmpegRendererAdapter(
  runtime: Pick<TimelineRendererAdapter, "render" | "cancel">,
): TimelineRendererAdapter {
  return {
    id: "ffmpeg",
    render: (plan, context) => runtime.render(plan, context),
    cancel: (jobId) => runtime.cancel(jobId),
  };
}
