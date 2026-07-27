import { describe, expect, it } from "vitest";
import { createTimelineRenderRequest } from "../contracts/timeline-renderer";
import { routeTimelineRenderer } from "./renderer-router";

describe("routeTimelineRenderer", () => {
  it("keeps an explicit FFmpeg request on FFmpeg", () => {
    expect(routeTimelineRenderer(createTimelineRenderRequest("ffmpeg", {
      effects: [{ effectId: "blur", enabled: true }],
    }))).toEqual({
      success: true,
      decision: { requested: "ffmpeg", actual: "ffmpeg" },
    });
  });

  it("keeps supported Remotion effects on Remotion", () => {
    expect(routeTimelineRenderer(createTimelineRenderRequest("remotion", {
      effects: [
        { effectId: "panZoom", enabled: true },
        { effectId: "speed", enabled: true },
        { effectId: "blur", enabled: false },
      ],
    }))).toEqual({
      success: true,
      decision: { requested: "remotion", actual: "remotion" },
    });
  });

  it("routes enabled unsupported effects to FFmpeg in stable deduplicated order", () => {
    expect(routeTimelineRenderer(createTimelineRenderRequest("remotion", {
      effects: [
        { effectId: "grain", enabled: true },
        { effectId: "blur", enabled: true },
        { effectId: "grain", enabled: true },
      ],
    }))).toEqual({
      success: true,
      decision: {
        requested: "remotion",
        actual: "ffmpeg",
        fallback: {
          code: "unsupported-effects",
          effectIds: ["blur", "grain"],
          message: "Remotion 暂不支持效果：blur、grain",
        },
      },
    });
  });

  it("fails closed when Remotion sees an unregistered effect", () => {
    expect(routeTimelineRenderer(createTimelineRenderRequest("remotion", {
      effects: [
        { effectId: "futureEffect", enabled: true },
        { effectId: "anotherEffect", enabled: true },
      ],
    }))).toEqual({
      success: false,
      code: "unknown-remotion-effects",
      effectIds: ["anotherEffect", "futureEffect"],
      message: "Remotion 能力矩阵未登记效果：anotherEffect、futureEffect",
    });
  });
});
