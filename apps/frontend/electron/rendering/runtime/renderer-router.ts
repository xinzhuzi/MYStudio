import {
  REMOTION_UNSUPPORTED_EFFECT_IDS,
  type RemotionUnsupportedEffectId,
  type RendererFallbackReason,
  type TimelineRendererId,
  type TimelineRenderRequest,
} from "../contracts/timeline-renderer";

const REMOTION_SUPPORTED_EFFECT_IDS = [
  "panZoom",
  "speed",
  "shake",
  "glow",
  "grain",
  "chromaticAberration",
  // 成片调色（08-18-haldclut-grade）：合成层 WebGL LUT pass。
  "grade",
  "ambient",
] as const;

interface TimelineRendererRoutingPlan {
  effects: ReadonlyArray<{
    effectId: string;
    enabled: boolean;
  }>;
}

export interface TimelineRendererRouteDecision {
  requested: TimelineRendererId;
  actual: TimelineRendererId;
  /** Compatibility display contract only; this router never returns a fallback. */
  fallback?: RendererFallbackReason<RemotionUnsupportedEffectId>;
}

export type TimelineRendererRouteResult =
  | { success: true; decision: TimelineRendererRouteDecision }
  | {
    success: false;
    code: "legacy-ffmpeg-renderer" | "unsupported-remotion-effects" | "unknown-remotion-effects";
    effectIds: string[];
    message: string;
  };

export function routeTimelineRenderer(
  request: TimelineRenderRequest<TimelineRendererRoutingPlan>,
): TimelineRendererRouteResult {
  if (request.requestedRenderer === "ffmpeg") {
    return {
      success: false,
      code: "legacy-ffmpeg-renderer",
      effectIds: [],
      message: "正式时间线仅支持 Remotion 渲染；FFmpeg 渲染器已停用",
    };
  }

  const enabledEffectIds = new Set(
    request.plan.effects
      .filter((effect) => effect.enabled)
      .map((effect) => effect.effectId),
  );
  const knownEffectIds = new Set<string>([
    ...REMOTION_SUPPORTED_EFFECT_IDS,
    ...REMOTION_UNSUPPORTED_EFFECT_IDS,
  ]);
  const unknownEffectIds = [...enabledEffectIds]
    .filter((effectId) => !knownEffectIds.has(effectId))
    .sort();
  if (unknownEffectIds.length > 0) {
    return {
      success: false,
      code: "unknown-remotion-effects",
      effectIds: unknownEffectIds,
      message: `Remotion 能力矩阵未登记效果：${unknownEffectIds.join("、")}`,
    };
  }

  const fallbackEffectIds = REMOTION_UNSUPPORTED_EFFECT_IDS
    .filter((effectId) => enabledEffectIds.has(effectId));
  if (fallbackEffectIds.length > 0) {
    return {
      success: false,
      code: "unsupported-remotion-effects",
      effectIds: [...fallbackEffectIds],
      message: `Remotion 暂不支持效果：${fallbackEffectIds.join("、")}；正式流程不会回退 FFmpeg`,
    };
  }

  return {
    success: true,
    decision: { requested: "remotion", actual: "remotion" },
  };
}
