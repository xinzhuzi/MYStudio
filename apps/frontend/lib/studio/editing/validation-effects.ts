import type { EditingValidationIssue } from "@/types/editing";
import { getEditingEffectDefinition } from "./effect-registry";
import { issue, optionalString, isRecord, booleanValue, rangedNumber, type EffectTargetInfo } from "./validation-shared";
/**
 * 效果校验层——目标/参数/视觉语义三段校验与轨道白名单常量。
 * 08-31 深网专批,体逐字保留。
 */

export const VISUAL_EFFECT_TRACK_KINDS = new Set(["video", "image"]);
export const FORBIDDEN_RENDER_KEYS = new Set([
  "command",
  "args",
  "extraArgs",
  "outputPath",
  "shell",
  "filterGraph",
  "filter_complex",
  "token",
  "sessionId",
  "assetId",
  "url",
  "src",
  "mediaUrlByClipId",
  "composition",
]);

export function validateEffectTarget(
  value: Record<string, unknown>,
  clipIds: Set<string>,
  trackIds: Set<string>,
  issues: EditingValidationIssue[],
  path: string,
) {
  const clipId = optionalString(value.targetClipId, issues, `${path}.targetClipId`);
  const trackId = optionalString(value.targetTrackId, issues, `${path}.targetTrackId`);
  if (!clipId && !trackId) {
    issue(issues, "editing.effect.target", path, "效果必须指定片段或轨道目标");
  }
  if (clipId && trackId) {
    issue(issues, "editing.effect.target_ambiguous", path, "效果只能指定一个片段目标");
  }
  if (clipId && !clipIds.has(clipId)) issue(issues, "editing.effect.clip_missing", `${path}.targetClipId`, "效果目标片段不存在");
  if (trackId && !trackIds.has(trackId)) issue(issues, "editing.effect.track_missing", `${path}.targetTrackId`, "效果目标轨道不存在");
  if (trackId) issue(issues, "editing.effect.track_unsupported", `${path}.targetTrackId`, "首期效果不支持轨道目标");
  return clipId;
}

export function validateVisualEffectSemantics(
  value: Record<string, unknown>,
  targetClipId: string | null,
  targetByClipId: Map<string, EffectTargetInfo>,
  issues: EditingValidationIssue[],
  path: string,
) {
  const definition = getEditingEffectDefinition(value.effectId);
  if (!definition) {
    issue(issues, "editing.effect.id", `${path}.effectId`, "未知效果 ID");
    return;
  }
  if (definition.category === "transition") {
    issue(issues, "editing.effect.category", `${path}.effectId`, "转场必须使用 EditingTransition");
  }
  if (!targetClipId) return;
  const target = targetByClipId.get(targetClipId);
  if (!target) return;
  if (!VISUAL_EFFECT_TRACK_KINDS.has(String(target.trackKind))) {
    issue(issues, "editing.effect.visual_target", `${path}.targetClipId`, "效果目标必须是视觉片段");
  }

  const startUs = value.startUs;
  const durationUs = value.durationUs;
  if (
    typeof startUs === "number"
    && Number.isSafeInteger(startUs)
    && typeof durationUs === "number"
    && Number.isSafeInteger(durationUs)
    && typeof target.startUs === "number"
    && Number.isSafeInteger(target.startUs)
    && typeof target.durationUs === "number"
    && Number.isSafeInteger(target.durationUs)
  ) {
    const targetEndUs = target.startUs + target.durationUs;
    if (startUs < target.startUs || startUs + durationUs > targetEndUs) {
      issue(issues, "editing.effect.window_bounds", `${path}.durationUs`, "效果时间窗必须完整位于目标片段内");
    }
    if (
      (definition.id === "panZoom" || definition.id === "speed")
      && (startUs !== target.startUs || durationUs !== target.durationUs)
    ) {
      issue(issues, "editing.effect.full_clip_required", path, `${definition.id} 必须覆盖完整目标片段`);
    }
  }
  if (definition.id === "speed" && target.sourceKind === "storyboardImage") {
    issue(issues, "editing.effect.speed_visual", `${path}.targetClipId`, "静态图片不支持速度效果");
  }
}

export function validateEffectParams(
  effectId: unknown,
  value: unknown,
  issues: EditingValidationIssue[],
  path: string,
) {
  if (!isRecord(value)) {
    issue(issues, "editing.effect.params", path, "效果参数必须是对象");
    return;
  }
  const definition = getEditingEffectDefinition(effectId);
  if (!definition) return;
  const parameters = new Map(definition.parameters.map((item) => [item.name, item]));
  for (const [key, parameterValue] of Object.entries(value)) {
    const parameter = parameters.get(key);
    if (!parameter) {
      issue(issues, "editing.effect.param_unknown", `${path}.${key}`, "效果参数不在白名单");
      continue;
    }
    if (parameter.kind === "number") {
      rangedNumber(parameterValue, parameter.min ?? -Infinity, parameter.max ?? Infinity, issues, `${path}.${key}`, "editing.effect.param_number");
    } else if (parameter.kind === "boolean") {
      booleanValue(parameterValue, issues, `${path}.${key}`);
    } else if (typeof parameterValue !== "string" || !parameter.values?.includes(parameterValue)) {
      issue(issues, "editing.effect.param_enum", `${path}.${key}`, "效果枚举参数无效");
    }
  }
}
