// Boundary guard for CompositionProps. Both the Player (renderer) and the fixed
// render bundle validate the props they receive before mounting, so neither
// trusts a raw payload that crossed an IPC/bundle boundary. Pure and dependency
// free beyond the prop types it checks.

import type {
  ChapterVideoCompositionProps,
  CompositionProps,
  StoryboardShotCompositionProps,
} from "./composition-props";
import {
  COMPOSITION_TRANSITION_EFFECTS,
  type CompositionTransitionEffect,
} from "./timing";
import { CINEMATIC_LUT_IDS } from "../../../../../lib/studio/remotion/cinematic-luts";
import { ATMOSPHERE_TEMPLATES } from "../../../../../lib/studio/remotion/atmosphere-templates";
// 固定 bundle 走 @remotion/bundler(webpack),不解析 vite 的 @/ 别名——
// 共享注册表必须相对导入。
import { isKnownSubtitleFontId } from "../../../../../lib/studio/remotion/subtitle-fonts";

const VISUAL_KINDS = ["image", "video"] as const;
const VISUAL_FITS = ["cover", "contain"] as const;
const AUDIO_KINDS = ["voice", "bgm", "sfx", "ambience"] as const;
// 08-19 multilayer-composition Child1:层角色/混合模式/ambient 类型闭集
// (与 ambientForClip 的静默钳制不同,props 边界 fail-closed)。
const LAYER_ROLES = ["background", "subject", "foreground", "atmosphere"] as const;
const ATMOSPHERE_TEMPLATE_IDS = new Set<string>(ATMOSPHERE_TEMPLATES.map((template) => template.id));
const LAYER_BLEND_MODES = ["normal", "screen", "multiply", "overlay", "soft-light"] as const;
const AMBIENT_TYPES = ["float", "breathe", "sway", "pulse", "flow"] as const;

export type CompositionValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: Array<{ path: string; message: string }> };

type Issue = { path: string; message: string };

export function validateCompositionProps(
  value: unknown,
): CompositionValidationResult<CompositionProps> {
  if (!isRecord(value)) {
    return { success: false, issues: [{ path: "$", message: "合成属性必须是对象" }] };
  }
  const issues: Issue[] = [];
  requirePositiveInteger(value.width, "width", issues);
  requirePositiveInteger(value.height, "height", issues);
  requirePositiveNumber(value.fps, "fps", issues);
  requirePositiveInteger(value.durationInFrames, "durationInFrames", issues);
  validateArray(value.visualClips, "visualClips", issues, validateVisualClip);
  validateArray(value.transitions, "transitions", issues, validateTransition);
  validateArray(value.audioClips, "audioClips", issues, validateAudioClip);
  validateArray(value.subtitles, "subtitles", issues, validateSubtitle);
  if (value.subtitleFont !== undefined && !isKnownSubtitleFontId(value.subtitleFont)) {
    issues.push({ path: "subtitleFont", message: "字幕字体必须是注册表内的字体 id" });
  }
  if (value.customFonts !== undefined) {
    if (!Array.isArray(value.customFonts)) issues.push({ path: "customFonts", message: "customFonts 必须是数组" });
    else value.customFonts.forEach((face, index) => {
      if (!isRecord(face) || typeof (face as { family?: unknown }).family !== "string" || !(face as { family?: string }).family?.trim()) {
        issues.push({ path: `customFonts[${index}].family`, message: "字体面 family 必须是非空字符串" });
      } else if (typeof (face as { url?: unknown }).url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+\//.test((face as { url: string }).url)) {
        issues.push({ path: `customFonts[${index}].url`, message: "字体面 url 必须是本机 capability URL" });
      }
    });
  }
  if (value.overlayClips !== undefined) {
    validateArray(value.overlayClips, "overlayClips", issues, validateOverlayClip);
  }
  validateRelationships(value, issues);
  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: value as unknown as CompositionProps };
}

export function validateStoryboardShotCompositionProps(
  value: unknown,
): CompositionValidationResult<StoryboardShotCompositionProps> {
  const base = validateCompositionProps(value);
  const issues = base.success ? [] : [...base.issues];
  if (!isRecord(value)) return { success: false, issues };
  requireExactValue(value.target, "shot", "target", issues);
  validateTargetIdentity(value, issues);
  requireNonEmptyString(value.shotId, "shotId", issues);
  requirePositiveInteger(value.shotRevision, "shotRevision", issues);
  if (Array.isArray(value.visualClips) && value.visualClips.length !== 1) {
    issues.push({ path: "visualClips", message: "StoryboardShot 必须且只能包含一个视觉片段" });
  }
  validateAudioScope(value.audioClips, "shot", issues);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as StoryboardShotCompositionProps };
}

export function validateChapterVideoCompositionProps(
  value: unknown,
): CompositionValidationResult<ChapterVideoCompositionProps> {
  const base = validateCompositionProps(value);
  const issues = base.success ? [] : [...base.issues];
  if (!isRecord(value)) return { success: false, issues };
  requireExactValue(value.target, "chapter", "target", issues);
  validateTargetIdentity(value, issues);
  requireNonEmptyString(value.editingProjectId, "editingProjectId", issues);
  requirePositiveInteger(value.editingRevision, "editingRevision", issues);
  if (Array.isArray(value.visualClips) && value.visualClips.length === 0) {
    issues.push({ path: "visualClips", message: "ChapterVideo 至少需要一个 current shot MP4" });
  }
  if (Array.isArray(value.visualClips)) {
    value.visualClips.forEach((clip, index) => {
      if (isRecord(clip) && clip.kind !== "video") {
        issues.push({
          path: `visualClips[${index}].kind`,
          message: "ChapterVideo 视觉输入必须是 current shot MP4",
        });
      }
    });
  }
  validateAudioScope(value.audioClips, "chapter", issues);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, value: value as unknown as ChapterVideoCompositionProps };
}

function validateTargetIdentity(value: Record<string, unknown>, issues: Issue[]): void {
  requireNonEmptyString(value.projectId, "projectId", issues);
  requireNonEmptyString(value.chapterId, "chapterId", issues);
}

function validateAudioScope(
  value: unknown,
  expected: "shot" | "chapter",
  issues: Issue[],
): void {
  if (!Array.isArray(value)) return;
  // 08-18-sfx-beat：chapter 侧 sfx=转场音效（派生音轨，无 ducking）。
  const allowedKinds: readonly string[] = expected === "shot"
    ? ["voice", "sfx"]
    : ["bgm", "ambience", "sfx"];
  value.forEach((clip, index) => {
    if (!isRecord(clip)) return;
    if (clip.renderScope !== expected) {
      issues.push({
        path: `audioClips[${index}].renderScope`,
        message: `renderScope 必须为 ${expected}`,
      });
    }
    if (typeof clip.kind === "string" && !allowedKinds.includes(clip.kind)) {
      issues.push({
        path: `audioClips[${index}].kind`,
        message: expected === "shot"
          ? "StoryboardShot 音频只允许 voice 或 sfx"
          : "ChapterVideo 音频只允许 bgm/ambience/sfx",
      });
    }
  });
}

function requireExactValue(
  value: unknown,
  expected: string,
  path: string,
  issues: Issue[],
): void {
  if (value !== expected) issues.push({ path, message: `${path} 必须为 ${expected}` });
}

function validateVisualClip(clip: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(clip)) {
    issues.push({ path, message: "视觉片段必须是对象" });
    return;
  }
  requireNonEmptyString(clip.clipId, `${path}.clipId`, issues);
  requireEnum(clip.kind, VISUAL_KINDS, `${path}.kind`, issues);
  requireNonEmptyString(clip.src, `${path}.src`, issues);
  requireCapabilityUrl(clip.src, `${path}.src`, issues);
  requireNonNegativeInteger(clip.from, `${path}.from`, issues);
  requirePositiveInteger(clip.durationInFrames, `${path}.durationInFrames`, issues);
  validateTransform(clip.transform, `${path}.transform`, issues);
  if (clip.fit !== undefined) requireEnum(clip.fit, VISUAL_FITS, `${path}.fit`, issues);
  validateGrade(clip.grade, `${path}.grade`, issues);
  validateAmbient(clip.ambient, `${path}.ambient`, issues);
  validateLayerFields(clip, path, issues);
  validateOptionalClipFields(clip, path, issues);
}

// ambient(环境动画):类型 5 枚举+数值域(与 ambientForClip 钳制域一致);
// clip 级与层内共用。旧路径无校验(非法 type 静默丢弃),props 边界收紧为 fail-closed。
function validateAmbient(ambient: unknown, path: string, issues: Issue[]): void {
  if (ambient === undefined) return;
  if (!isRecord(ambient)) {
    issues.push({ path, message: "ambient 必须是对象" });
    return;
  }
  requireEnum(ambient.type, AMBIENT_TYPES, `${path}.type`, issues);
  const ambientRange = (key: string, min: number, max: number): void => {
    const value = ambient[key];
    if (value === undefined) return;
    if (!isFiniteNumber(value) || value < min || value > max) {
      issues.push({ path: `${path}.${key}`, message: `${key} 必须是位于 ${min}..${max} 的数值` });
    }
  };
  ambientRange("ampX", 0, 0.05);
  ambientRange("ampY", 0, 0.05);
  ambientRange("ampScale", 0, 0.03);
  ambientRange("ampRot", 0, 1);
  ambientRange("freq", 0.1, 0.8);
  ambientRange("phase", 0, 1);
}

// layers(旧二元组)/layerStack(N 层)分发:同现 fail-closed。
function validateLayerFields(clip: Record<string, unknown>, path: string, issues: Issue[]): void {
  const legacy = clip.layers;
  const stack = clip.layerStack;
  if (legacy !== undefined && stack !== undefined) {
    issues.push({ path: `${path}.layerStack`, message: "layerStack 与旧 layers 二元组互斥,不得同现" });
    return;
  }
  if (legacy !== undefined) {
    if (!isRecord(legacy)) {
      issues.push({ path: `${path}.layers`, message: "layers 必须是对象" });
      return;
    }
    requireNonEmptyString(legacy.backgroundSrc, `${path}.layers.backgroundSrc`, issues);
    requireCapabilityUrl(legacy.backgroundSrc, `${path}.layers.backgroundSrc`, issues);
    requireNonEmptyString(legacy.subjectSrc, `${path}.layers.subjectSrc`, issues);
    requireCapabilityUrl(legacy.subjectSrc, `${path}.layers.subjectSrc`, issues);
    if (isFiniteNumber(legacy.parallax) && (legacy.parallax < 0 || legacy.parallax > 1)) {
      issues.push({ path: `${path}.layers.parallax`, message: "parallax 必须位于 0..1" });
    }
    return;
  }
  if (stack === undefined) return;
  if (!Array.isArray(stack) || stack.length === 0) {
    issues.push({ path: `${path}.layerStack`, message: "layerStack 必须是非空数组" });
    return;
  }
  if (stack.length > 8) {
    issues.push({ path: `${path}.layerStack`, message: "layerStack 至多 8 层" });
  }
  stack.forEach((layer, index) => validateLayerSpec(layer, `${path}.layerStack[${index}]`, issues));
}

function validateLayerSpec(layer: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(layer)) {
    issues.push({ path, message: "层描述必须是对象" });
    return;
  }
  requireEnum(layer.role, LAYER_ROLES, `${path}.role`, issues);
  if (layer.src !== undefined) {
    requireNonEmptyString(layer.src, `${path}.src`, issues);
    requireCapabilityUrl(layer.src, `${path}.src`, issues);
  }
  if (layer.src === undefined && layer.template === undefined) {
    issues.push({ path, message: "图片层需要 src,程序化层需要 template,二者不得同时缺省" });
  }
  if (layer.panZoomDamp !== undefined
    && (!isFiniteNumber(layer.panZoomDamp) || layer.panZoomDamp < 0 || layer.panZoomDamp > 2)) {
    issues.push({ path: `${path}.panZoomDamp`, message: "panZoomDamp 必须位于 0..2" });
  }
  if (layer.opacity !== undefined
    && (!isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) {
    issues.push({ path: `${path}.opacity`, message: "opacity 必须位于 0..1" });
  }
  if (layer.blendMode !== undefined) {
    requireEnum(layer.blendMode, LAYER_BLEND_MODES, `${path}.blendMode`, issues);
  }
  if (layer.drift !== undefined) {
    if (!isRecord(layer.drift)) {
      issues.push({ path: `${path}.drift`, message: "drift 必须是对象" });
    } else {
      for (const key of ["speedX", "speedY"]) {
        if (layer.drift[key] !== undefined
          && (!isFiniteNumber(layer.drift[key]) || Math.abs(layer.drift[key] as number) > 100)) {
          issues.push({ path: `${path}.drift.${key}`, message: `${key} 必须是 |值|≤100 的有限数值` });
        }
      }
    }
  }
  if (layer.template !== undefined) {
    if (!isRecord(layer.template)) {
      issues.push({ path: `${path}.template`, message: "template 必须是对象" });
    } else {
      requireNonEmptyString(layer.template.id, `${path}.template.id`, issues);
      if (typeof layer.template.id === "string" && !ATMOSPHERE_TEMPLATE_IDS.has(layer.template.id)) {
        issues.push({ path: `${path}.template.id`, message: `模板不在氛围闭集: ${layer.template.id}` });
      }
      if (layer.template.params !== undefined) {
        if (!isRecord(layer.template.params)) {
          issues.push({ path: `${path}.template.params`, message: "template.params 必须是数值记录" });
        } else {
          for (const [key, param] of Object.entries(layer.template.params)) {
            if (!isFiniteNumber(param)) {
              issues.push({ path: `${path}.template.params.${key}`, message: "模板参数必须是有限数值" });
            }
          }
        }
      }
    }
  }
  validateAmbient(layer.ambient, `${path}.ambient`, issues);
}

// grade（成片调色）：lutId 闭集 fail-closed（未知值拒渲染，铁律2）；blend 钳 0..1。
function validateGrade(grade: unknown, path: string, issues: Issue[]): void {
  if (grade === undefined) return;
  if (!isRecord(grade)) {
    issues.push({ path, message: "grade 必须是对象" });
    return;
  }
  if (typeof grade.lutId === "string" && CINEMATIC_LUT_IDS.includes(grade.lutId)) {
    if (typeof grade.lutSrc !== "string" || !grade.lutSrc) {
      issues.push({ path: `${path}.lutSrc`, message: "grade 需要 LUT 资源 URL" });
    }
  } else {
    issues.push({ path: `${path}.lutId`, message: `grade.lutId 不在 LUT 闭集: ${String(grade.lutId)}` });
  }
  if (!isFiniteNumber(grade.blend) || grade.blend < 0 || grade.blend > 1) {
    issues.push({ path: `${path}.blend`, message: "grade.blend 必须是 0..1" });
  }
}

function validateTransform(value: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "变换必须是对象" });
    return;
  }
  for (const key of ["x", "y", "scaleX", "scaleY", "rotation", "opacity"]) {
    if (!isFiniteNumber(value[key])) {
      issues.push({ path: `${path}.${key}`, message: `${key} 必须是有限数值` });
    }
  }
  for (const key of ["scaleX", "scaleY"]) {
    if (isFiniteNumber(value[key]) && value[key] <= 0) {
      issues.push({ path: `${path}.${key}`, message: `${key} 必须大于 0` });
    }
  }
  if (isFiniteNumber(value.opacity) && (value.opacity < 0 || value.opacity > 1)) {
    issues.push({ path: `${path}.opacity`, message: "opacity 必须位于 0..1" });
  }
}

function validateTransition(value: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "转场必须是对象" });
    return;
  }
  requireNonEmptyString(value.fromClipId, `${path}.fromClipId`, issues);
  requireNonEmptyString(value.toClipId, `${path}.toClipId`, issues);
  if (!isTransitionEffect(value.effectId)) {
    issues.push({ path: `${path}.effectId`, message: "转场效果无效" });
  }
  requireNonNegativeInteger(value.overlapFrames, `${path}.overlapFrames`, issues);
}

function validateAudioClip(value: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "音频片段必须是对象" });
    return;
  }
  requireNonEmptyString(value.clipId, `${path}.clipId`, issues);
  requireEnum(value.kind, AUDIO_KINDS, `${path}.kind`, issues);
  requireNonEmptyString(value.src, `${path}.src`, issues);
  requireCapabilityUrl(value.src, `${path}.src`, issues);
  requireNonNegativeInteger(value.from, `${path}.from`, issues);
  requirePositiveInteger(value.durationInFrames, `${path}.durationInFrames`, issues);
  if (!isFiniteNumber(value.volume) || (value.volume as number) < 0) {
    issues.push({ path: `${path}.volume`, message: "音量必须是非负有限数值" });
  }
  validateOptionalClipFields(value, path, issues);
}

function validateOptionalClipFields(value: Record<string, unknown>, path: string, issues: Issue[]): void {
  const trimStartFrames = value.trimStartFrames;
  if (trimStartFrames !== undefined && !isNonNegativeInteger(trimStartFrames)) {
    issues.push({ path: `${path}.trimStartFrames`, message: "trimStartFrames 必须是非负整数" });
  }
  if (value.playbackRate !== undefined
    && (!isFiniteNumber(value.playbackRate) || value.playbackRate <= 0)) {
    issues.push({ path: `${path}.playbackRate`, message: "播放速率必须是正有限数值" });
  }
  if (value.muted !== undefined && typeof value.muted !== "boolean") {
    issues.push({ path: `${path}.muted`, message: "muted 必须是布尔值" });
  }
  validateFade(value.fade, value.durationInFrames, `${path}.fade`, issues);
  validateEnvelope(value.envelope, value.durationInFrames, `${path}.envelope`, issues);
  validateEnvelope(value.duckingEnvelope, value.durationInFrames, `${path}.duckingEnvelope`, issues);
  validatePanZoom(value.panZoom, `${path}.panZoom`, issues);
}

function requireCapabilityUrl(value: unknown, path: string, issues: Issue[]): void {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "http:"
      || url.hostname !== "127.0.0.1"
      || !url.port
      || url.username
      || url.password
      || parts.length !== 2
      || !/^[a-f0-9]{64}$/.test(parts[0] ?? "")
      || !(parts[1] ?? "")
      || url.search
      || url.hash) {
      throw new Error();
    }
  } catch { issues.push({ path, message: "src 必须是 127.0.0.1 的 HTTP capability URL" }); }
}

function validateFade(
  value: unknown,
  durationInFrames: unknown,
  path: string,
  issues: Issue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path, message: "fade 必须是对象" });
    return;
  }
  for (const key of ["fadeInFrames", "fadeOutFrames"]) {
    const frames = value[key];
    if (!isNonNegativeInteger(frames)) {
      issues.push({ path: `${path}.${key}`, message: `${key} 必须是非负整数` });
    } else if (isNonNegativeInteger(durationInFrames) && frames > durationInFrames) {
      issues.push({ path: `${path}.${key}`, message: `${key} 不得超过片段时长` });
    }
  }
}

function validateEnvelope(
  value: unknown,
  durationInFrames: unknown,
  path: string,
  issues: Issue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, message: "envelope 必须是数组" });
    return;
  }
  value.forEach((point, index) => {
    const pointPath = `${path}[${index}]`;
    if (!isRecord(point)) {
      issues.push({ path: pointPath, message: "包络点必须是对象" });
      return;
    }
    if (!isNonNegativeInteger(point.frame)) {
      issues.push({ path: `${pointPath}.frame`, message: "frame 必须是非负整数" });
    } else if (isNonNegativeInteger(durationInFrames) && point.frame > durationInFrames) {
      issues.push({ path: `${pointPath}.frame`, message: "frame 不得超过片段时长" });
    }
    if (!isFiniteNumber(point.gain) || point.gain < 0) {
      issues.push({ path: `${pointPath}.gain`, message: "gain 必须是非负有限数值" });
    }
  });
}

function validatePanZoom(value: unknown, path: string, issues: Issue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path, message: "panZoom 必须是对象" });
    return;
  }
  for (const key of ["fromScale", "toScale"]) {
    if (!isFiniteNumber(value[key]) || value[key] <= 0) {
      issues.push({ path: `${path}.${key}`, message: `${key} 必须是正有限数值` });
    }
  }
  for (const key of ["originX", "originY"]) {
    if (!isFiniteNumber(value[key]) || value[key] < 0 || value[key] > 1) {
      issues.push({ path: `${path}.${key}`, message: `${key} 必须位于 0..1` });
    }
  }
  if (value.easing !== undefined && value.easing !== "cubic" && value.easing !== "spring") {
    issues.push({ path: `${path}.easing`, message: "easing 必须是 cubic 或 spring" });
  }
}

function validateSubtitle(value: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "字幕必须是对象" });
    return;
  }
  requireNonEmptyString(value.cueId, `${path}.cueId`, issues);
  requireNonEmptyString(value.text, `${path}.text`, issues);
  requireNonNegativeInteger(value.from, `${path}.from`, issues);
  requirePositiveInteger(value.durationInFrames, `${path}.durationInFrames`, issues);
}

function validateOverlayClip(value: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: "透明 overlay 片段必须是对象" });
    return;
  }
  requireNonEmptyString(value.clipId, `${path}.clipId`, issues);
  requireNonEmptyString(value.src, `${path}.src`, issues);
  requireCapabilityUrl(value.src, `${path}.src`, issues);
  requireNonNegativeInteger(value.from, `${path}.from`, issues);
  requirePositiveInteger(value.durationInFrames, `${path}.durationInFrames`, issues);
}

function validateRelationships(value: Record<string, unknown>, issues: Issue[]): void {
  const compositionDuration = value.durationInFrames;
  const visuals = Array.isArray(value.visualClips)
    ? value.visualClips.filter(isRecord)
    : [];
  const visualIndexById = new Map<string, number>();

  visuals.forEach((clip, index) => {
    const clipId = typeof clip.clipId === "string" ? clip.clipId : "";
    if (clipId && visualIndexById.has(clipId)) {
      issues.push({ path: `visualClips[${index}].clipId`, message: "视觉片段 ID 重复" });
    } else if (clipId) {
      visualIndexById.set(clipId, index);
    }
    validateWithinComposition(
      clip.from,
      clip.durationInFrames,
      compositionDuration,
      `visualClips[${index}]`,
      issues,
    );
  });

  if (Array.isArray(value.transitions)) {
    const seenPairs = new Set<string>();
    value.transitions.forEach((transition, index) => {
      if (!isRecord(transition)) return;
      const path = `transitions[${index}]`;
      const fromId = typeof transition.fromClipId === "string"
        ? transition.fromClipId
        : "";
      const toId = typeof transition.toClipId === "string"
        ? transition.toClipId
        : "";
      const fromIndex = visualIndexById.get(fromId);
      const toIndex = visualIndexById.get(toId);
      if (fromIndex === undefined) {
        issues.push({ path: `${path}.fromClipId`, message: "转场来源片段不存在" });
      }
      if (toIndex === undefined) {
        issues.push({ path: `${path}.toClipId`, message: "转场目标片段不存在" });
      }
      if (fromIndex !== undefined && toIndex !== undefined && toIndex !== fromIndex + 1) {
        issues.push({ path: `${path}.toClipId`, message: "转场只能连接相邻视觉片段" });
      }

      const pair = `${fromId}->${toId}`;
      if (seenPairs.has(pair)) {
        issues.push({ path, message: "相邻片段转场重复" });
      }
      seenPairs.add(pair);

      if (transition.effectId === "cut" && transition.overlapFrames !== 0) {
        issues.push({ path: `${path}.overlapFrames`, message: "cut 转场重叠必须为 0" });
      } else if (isTransitionEffect(transition.effectId)
        && transition.effectId !== "cut"
        && transition.overlapFrames === 0) {
        issues.push({ path: `${path}.overlapFrames`, message: "非 cut 转场重叠必须大于 0" });
      }

      if (fromIndex === undefined
        || toIndex === undefined
        || !isNonNegativeInteger(transition.overlapFrames)) {
        return;
      }
      const from = visuals[fromIndex];
      const to = visuals[toIndex];
      if (isPositiveInteger(from.durationInFrames)
        && isPositiveInteger(to.durationInFrames)
        && transition.overlapFrames
          > Math.max(0, Math.min(from.durationInFrames, to.durationInFrames) - 1)) {
        issues.push({ path: `${path}.overlapFrames`, message: "转场重叠不能耗尽相邻片段" });
      }
      if (isNonNegativeInteger(from.from)
        && isPositiveInteger(from.durationInFrames)
        && isNonNegativeInteger(to.from)
        && to.from !== from.from + from.durationInFrames - transition.overlapFrames) {
        issues.push({ path: `${path}.overlapFrames`, message: "转场重叠与片段时序不一致" });
      }
    });
  }

  for (const [collectionName, collection] of [
    ["audioClips", value.audioClips],
    ["subtitles", value.subtitles],
    ["overlayClips", value.overlayClips],
  ] as const) {
    if (!Array.isArray(collection)) continue;
    collection.forEach((item, index) => {
      if (!isRecord(item)) return;
      validateWithinComposition(
        item.from,
        item.durationInFrames,
        compositionDuration,
        `${collectionName}[${index}]`,
        issues,
      );
    });
  }
}

function validateWithinComposition(
  from: unknown,
  duration: unknown,
  compositionDuration: unknown,
  path: string,
  issues: Issue[],
): void {
  if (isNonNegativeInteger(from)
    && isPositiveInteger(duration)
    && isPositiveInteger(compositionDuration)
    && from + duration > compositionDuration) {
    issues.push({ path: `${path}.durationInFrames`, message: "片段结束帧超出 composition 时长" });
  }
}

function isTransitionEffect(value: unknown): value is CompositionTransitionEffect {
  return typeof value === "string"
    && (COMPOSITION_TRANSITION_EFFECTS as readonly string[]).includes(value);
}

function validateArray<_T>(
  value: unknown,
  path: string,
  issues: Issue[],
  validateItem: (item: unknown, itemPath: string, issues: Issue[]) => void,
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: `${path} 必须是数组` });
    return;
  }
  value.forEach((item, index) => validateItem(item, `${path}[${index}]`, issues));
}

function requireEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: Issue[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({ path, message: `${path} 必须是 ${allowed.join(" / ")} 之一` });
  }
}

function requireNonEmptyString(value: unknown, path: string, issues: Issue[]): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path, message: `${path} 必须是非空字符串` });
  }
}

function requirePositiveNumber(value: unknown, path: string, issues: Issue[]): void {
  if (!isFiniteNumber(value) || (value as number) <= 0) {
    issues.push({ path, message: `${path} 必须是正有限数值` });
  }
}

function requirePositiveInteger(value: unknown, path: string, issues: Issue[]): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    issues.push({ path, message: `${path} 必须是正整数` });
  }
}

function requireNonNegativeInteger(value: unknown, path: string, issues: Issue[]): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    issues.push({ path, message: `${path} 必须是非负整数` });
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
