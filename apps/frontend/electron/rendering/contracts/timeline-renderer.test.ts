import { describe, expect, it } from "vitest";
import {
  REMOTION_UNSUPPORTED_EFFECT_IDS,
  TIMELINE_RENDER_PROGRESS_STAGES,
  TIMELINE_RENDERER_IDS,
  createTimelineRenderRequest,
  isTimelineRenderProgressStage,
  isTimelineRendererId,
  validateTimelineRenderProgress,
  validateTimelineRenderRequestEnvelope,
  validateTimelineRendererEvidence,
} from "./timeline-renderer";

describe("timeline renderer contracts", () => {
  it("accepts a versioned renderer request envelope", () => {
    expect(validateTimelineRenderRequestEnvelope({
      schemaVersion: 1,
      requestedRenderer: "remotion",
      plan: { jobId: "job-1" },
    })).toEqual({
      success: true,
      value: {
        schemaVersion: 1,
        requestedRenderer: "remotion",
        plan: { jobId: "job-1" },
      },
    });
  });

  it("creates the single canonical request envelope", () => {
    const plan = { jobId: "job-1" };
    expect(createTimelineRenderRequest("ffmpeg", plan)).toEqual({
      schemaVersion: 1,
      requestedRenderer: "ffmpeg",
      plan,
    });
  });

  it("rejects invalid schema, renderer and plan at the boundary", () => {
    expect(validateTimelineRenderRequestEnvelope({
      schemaVersion: 2,
      requestedRenderer: "automatic",
      plan: null,
    })).toEqual({
      success: false,
      issues: [
        { path: "schemaVersion", message: "仅支持渲染请求 schemaVersion=1" },
        { path: "requestedRenderer", message: "渲染器必须是 remotion 或 ffmpeg" },
        { path: "plan", message: "渲染计划必须是对象" },
      ],
    });
  });

  it("keeps renderer and unsupported-effect ids explicit and stable", () => {
    expect(TIMELINE_RENDERER_IDS).toEqual(["remotion", "ffmpeg"]);
    // shake/glow/grain/chromaticAberration 已转正为 Remotion 支持（合成层完整实现），
    // 仍不支持的是 glitch/blur。
    expect(REMOTION_UNSUPPORTED_EFFECT_IDS).toEqual([
      "glitch",
      "blur",
    ]);
    expect(isTimelineRendererId("ffmpeg")).toBe(true);
    expect(isTimelineRendererId("auto")).toBe(false);
  });

  it("accepts postprocessing as a canonical progress stage", () => {
    expect(TIMELINE_RENDER_PROGRESS_STAGES).toContain("postprocessing");
    expect(isTimelineRenderProgressStage("postprocessing")).toBe(true);
    expect(validateTimelineRenderProgress({
      jobId: "job-1",
      stage: "postprocessing",
      ratio: 0.75,
      message: "正在执行音频响度后处理",
    })).toEqual({
      success: true,
      value: {
        jobId: "job-1",
        stage: "postprocessing",
        ratio: 0.75,
        message: "正在执行音频响度后处理",
      },
    });
  });

  it("rejects malformed progress payloads", () => {
    expect(validateTimelineRenderProgress({
      jobId: " ",
      stage: "encoding",
      ratio: Number.NaN,
      message: 1,
    })).toEqual({
      success: false,
      issues: [
        { path: "jobId", message: "渲染进度 jobId 必须是非空字符串" },
        { path: "stage", message: "渲染进度阶段无效" },
        { path: "ratio", message: "渲染进度比例必须是 0 到 1 的有限数值" },
        { path: "message", message: "渲染进度消息必须是字符串" },
      ],
    });
  });

  it("accepts structured compatibility fallback evidence", () => {
    expect(validateTimelineRendererEvidence({
      requested: "remotion",
      actual: "ffmpeg",
      fallback: {
        code: "unsupported-effects",
        effectIds: ["blur", "grain"],
        message: "Remotion 暂不支持：blur、grain",
      },
    })).toEqual({
      success: true,
      value: {
        requested: "remotion",
        actual: "ffmpeg",
        fallback: {
          code: "unsupported-effects",
          effectIds: ["blur", "grain"],
          message: "Remotion 暂不支持：blur、grain",
        },
      },
    });
  });

  it("rejects fallback evidence that does not route to ffmpeg", () => {
    expect(validateTimelineRendererEvidence({
      requested: "remotion",
      actual: "remotion",
      fallback: {
        code: "unsupported-effects",
        effectIds: [],
        message: "",
      },
    })).toEqual({
      success: false,
      issues: [
        { path: "fallback.effectIds", message: "回退效果列表必须包含非空字符串" },
        { path: "fallback.message", message: "渲染器回退说明必须是非空字符串" },
        { path: "fallback", message: "兼容性回退必须从 remotion 路由到 ffmpeg" },
      ],
    });
  });
});
