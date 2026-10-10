import { scaledTemplateParams } from "./atmosphere-layers";
import type { CompositionAudioClipProps, CompositionLayerSpec, CompositionProps, CompositionTransitionProps, CompositionVisualClipProps } from "./composition-props";
import { clipDurationInFrames, layoutVisualTimeline, usToFrames } from "./timing";
import { snapVisualTimelineToBeats } from "./beat-snap";
import { isAtmosphereTemplateId } from "@/lib/studio/remotion/atmosphere-templates";
import { DEFAULT_SUBTITLE_FONT_ID } from "@/lib/studio/remotion/subtitle-fonts";
import type { EditingEffect, TimelineRenderClip, TimelineRenderPlan } from "@/types/editing";
import { readableSubtitleCues } from "./composition-audio-subtitle";
import { overlaps } from "./composition-chapter-video";
import { VISUAL_FX_EFFECT_IDS, ambientForClip, audioKind, clampRange, compareTimelineClips, defaultTransform, envelopeForClip, fadeForClip, gradeForClip, numberParam, panZoomForClip, requireCapabilityUrl, visualFxForClip, vscMotionForClip } from "./composition-clip-effects";

/**
 * 单镜合成 props——buildCompositionProps 主链 + 层栈旧元组兼容。file-size-reduction P1 拆出,体逐字保留。
 *
 * @param beatSnap 节拍切点吸附(10-10 批D):beatTimesUs 由章级调用方提供
 * (BGM 能量峰预计算);仅在 plan.renderSettings.beatSnapEnabled === true 且
 * 有 beats 时激活,吸附加在 layoutVisualTimeline 之后、字幕/转场投影之前
 * ——同一条时序网格上所有下游(字幕 owner 锚点/转场重叠/章音频映射)一致继承。
 */
export function buildCompositionProps(
  plan: TimelineRenderPlan,
  mediaUrlByClipId: Readonly<Record<string, string>>,
  lutUrlById?: Readonly<Record<string, string>>,
  layerUrlByClipId?: Readonly<Record<string, { backgroundSrc: string; subjectSrc: string; parallax?: number }>>,
  beatSnap?: { beatTimesUs: readonly number[] },
): CompositionProps {
  const fps = plan.renderSettings.fps;
  // ambient（环境动画）效果：sin/cos 周期运动叠加在 panZoom 之上(2026-08-19)。
  const ambientEffectByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "ambient" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  // grade（成片调色）效果：params{lutId,blend}，lutId 闭集 fail-closed。
  const gradeEffectByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "grade" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  // onTwos(帧步进)/gradePulse(调色脉动)效果:08-19 第二批决策层接入。
  const onTwosByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "onTwos" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, Math.round(clampRange(numberParam(effect.params.step, 2), 2, 3))]),
  );
  const gradePulseByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "gradePulse" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, {
        amp: clampRange(numberParam(effect.params.amp, 0.08), 0.01, 0.5),
        freq: clampRange(numberParam(effect.params.freq, 0.3), 0.05, 2),
      }]),
  );
  // 氛围层效果（08-19 multilayer Child2）：同镜可多条（每模板一条）。
  const atmosphereEffectsByClipId = new Map<string, EditingEffect[]>();
  for (const effect of plan.effects) {
    if (!effect.enabled || effect.effectId !== "atmosphere" || !effect.targetClipId) continue;
    const list = atmosphereEffectsByClipId.get(effect.targetClipId);
    if (list) list.push(effect);
    else atmosphereEffectsByClipId.set(effect.targetClipId, [effect]);
  }
  const visualClips = plan.clips
    .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
    .sort(compareTimelineClips);
  const transitionInputs = plan.transitions.map((transition) => ({
    fromClipId: transition.fromClipId,
    toClipId: transition.toClipId,
    effectId: transition.effectId,
    durationUs: transition.durationUs,
  }));
  const visualTiming = layoutVisualTimeline(
    visualClips.map((clip) => ({ clipId: clip.id, durationUs: clip.durationUs })),
    transitionInputs,
    fps,
  );
  // 节拍切点吸附(10-10 批D,决议 D5):章级开关(默认关)+BGM 有 beats 才激活;
  // 只经转场重叠通道平移切点(每镜 durationInFrames 不变),timingById 之后
  // 的一切投影(视觉 from/字幕 owner 锚/转场重叠)统一落在吸附后的网格上。
  const beatSnapActive = plan.renderSettings.beatSnapEnabled === true
    && beatSnap !== undefined
    && beatSnap.beatTimesUs.length > 0;
  const snappedClips = beatSnapActive
    ? snapVisualTimelineToBeats(visualTiming.clips, transitionInputs, beatSnap!.beatTimesUs, fps)
    : visualTiming.clips;
  const timingById = new Map(snappedClips.map((timing) => [timing.clipId, timing]));
  const timelineDurationInFrames = beatSnapActive && snappedClips.length > 0
    ? Math.max(1, snappedClips[snappedClips.length - 1]!.from + snappedClips[snappedClips.length - 1]!.durationInFrames)
    : visualTiming.durationInFrames;
  const panZoomByClipId = new Map(
    plan.effects
      .filter((effect) => effect.effectId === "panZoom" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  // vscMotion 效果(10-10 批B):camera 五卡→CompositionVisualClipProps.vsc(组件
  // 整体接管,panZoom 抑制);depth 两卡→layerStack 层系数(panZoom 驱动保留)。
  // 未知 recipe id 在 vscMotionForClip throw(渲染前 fail-closed)。
  const vscMotionByClipId = new Map(
    plan.effects
      .filter((effect) => effect.enabled && effect.effectId === "vscMotion" && effect.targetClipId)
      .map((effect) => [effect.targetClipId!, effect]),
  );
  const fxEffectsByClipId = new Map<string, EditingEffect[]>();
  for (const effect of plan.effects) {
    if (!effect.enabled || !effect.targetClipId) continue;
    if (!VISUAL_FX_EFFECT_IDS.has(effect.effectId)) continue;
    const list = fxEffectsByClipId.get(effect.targetClipId);
    if (list) list.push(effect);
    else fxEffectsByClipId.set(effect.targetClipId, [effect]);
  }
  const compositionVisuals: CompositionVisualClipProps[] = visualClips.map((clip) => {
    const timing = timingById.get(clip.id);
    if (!timing) throw new Error(`视觉片段缺少统一时序: ${clip.id}`);
    const vscProjection = vscMotionForClip(vscMotionByClipId.get(clip.id), clip.id);
    return {
      clipId: clip.id,
      kind: clip.source.kind === "storyboardVideo" || clip.source.kind === "videoCandidate"
        ? "video"
        : clip.trackKind === "video" && clip.source.kind !== "storyboardImage"
          ? "video"
          : "image",
      src: requireCapabilityUrl(mediaUrlByClipId[clip.id], clip.id),
      from: timing.from,
      durationInFrames: timing.durationInFrames,
      transform: clip.transform ?? defaultTransform(),
      // camera 五卡:配方组件自带相机曲线,panZoom 抑制(叠加=双重变换);
      // depth 两卡与 legacy 运镜:panZoom 照常(驱动/运镜通道)。
      panZoom: vscProjection.vsc ? undefined : panZoomForClip(panZoomByClipId.get(clip.id)),
      ...(vscProjection.vsc ? { vsc: vscProjection.vsc } : {}),
      fx: visualFxForClip(fxEffectsByClipId.get(clip.id)),
      ...gradeForClip(gradeEffectByClipId.get(clip.id), lutUrlById, clip.id, gradePulseByClipId.get(clip.id)),
      ...(onTwosByClipId.has(clip.id) ? { frameStep: onTwosByClipId.get(clip.id) } : {}),
      ...ambientForClip(ambientEffectByClipId.get(clip.id)),
      trimStartFrames: usToFrames(clip.trimStartUs, fps),
      playbackRate: clip.speed,
      muted: clip.muted,
      // 图层分离分层渲染(08-19):仅静帧片段;注入时把旧二元组转换为
      // layerStack(bg damp=1-0.4·parallax 与旧公式一致→既有成片像素级不变);
      // atmosphere 效果(08-19 multilayer Child2)追加 template 层——两类层源
      // 合成同一条有序 layerStack,N 层渲染统一接管。
      // vsc depth 两卡(10-10 批B):层系数配方在此施加(damp 梯度+blur/降饱和锚)。
      ...layerStackForClip(clip, layerUrlByClipId, atmosphereEffectsByClipId.get(clip.id), vscProjection.vscDepthLayers),
    };
  });
  const audioClips: CompositionAudioClipProps[] = plan.clips
    .filter((clip) => clip.trackKind === "voice" || clip.trackKind === "bgm" || clip.trackKind === "sfx")
    .sort(compareTimelineClips)
    .map((clip) => ({
      clipId: clip.id,
      kind: audioKind(clip),
      src: requireCapabilityUrl(mediaUrlByClipId[clip.id], clip.id),
      from: usToFrames(clip.startUs, fps),
      durationInFrames: clipDurationInFrames(clip.durationUs, fps),
      volume: clip.muted ? 0 : clip.volume,
      trimStartFrames: usToFrames(clip.trimStartUs, fps),
      playbackRate: clip.speed,
      fade: fadeForClip(clip, fps),
      envelope: envelopeForClip(clip, fps),
    }));
  const subtitles = plan.renderSettings.subtitleMode === "burn-in"
    ? readableSubtitleCues(
        plan.clips
          .filter((clip) => clip.trackKind === "text" && typeof clip.source.text === "string")
          .sort(compareTimelineClips)
          .map((clip) => {
            // 字幕与视觉 clip 在 plan 层同处"音频时间线"（各镜时长直加），而视觉经
            // layoutVisualTimeline 压缩（转场重叠）——字幕必须用同一份 layout 偏移
            // 换算，否则随片长线性滞后（片尾可达数十秒）。
            const owner = visualClips.find((visual) => overlaps(clip.startUs, clip.durationUs, visual.startUs, visual.durationUs));
            const ownerTiming = owner ? timingById.get(owner.id) : undefined;
            const layoutShiftFrames = owner && ownerTiming
              ? usToFrames(owner.startUs, fps) - ownerTiming.from
              : 0;
            const from = Math.max(0, usToFrames(clip.startUs, fps) - layoutShiftFrames);
            return {
              cueId: clip.id,
              text: clip.source.text!.trim(),
              from,
              audioSpanFrames: clipDurationInFrames(clip.durationUs, fps),
            };
          })
          .filter((cue) => cue.text.length > 0 && cue.from < timelineDurationInFrames),
        timelineDurationInFrames,
        fps,
      )
    : [];
  const transitions: CompositionTransitionProps[] = plan.transitions.map((transition) => {
    const from = timingById.get(transition.fromClipId);
    const to = timingById.get(transition.toClipId);
    if (!from || !to) throw new Error(`转场引用不存在的视觉片段: ${transition.id}`);
    return {
      fromClipId: transition.fromClipId,
      toClipId: transition.toClipId,
      effectId: transition.effectId,
      overlapFrames: Math.max(0, from.from + from.durationInFrames - to.from),
    };
  });
  return {
    width: plan.renderSettings.width,
    height: plan.renderSettings.height,
    fps,
    durationInFrames: timelineDurationInFrames,
    visualClips: compositionVisuals,
    transitions,
    audioClips,
    subtitles,
    subtitleFont: plan.renderSettings.subtitleFont ?? DEFAULT_SUBTITLE_FONT_ID,
  };
}

/**
 * 旧 layers 二元组 → layerStack(08-19 multilayer-composition Child1):
 * 背景层 damp=1-0.4·parallax(与旧 bgDamp 公式逐值一致,既有双层成片像素级
 * 不变),主体层 damp=1(吃满运镜)。ambient 保留在 clip 级(旧路径主体独享
 * ambient 的行为由渲染端 layerStack 分支同样支持——此处不迁移,避免双重施加)。
 */
export function layerStackFromLegacyTuple(tuple: {
  backgroundSrc: string;
  subjectSrc: string;
  parallax?: number;
}): CompositionLayerSpec[] {
  const parallax = Math.min(1, Math.max(0, tuple.parallax ?? 0.5));
  return [
    { role: "background", src: tuple.backgroundSrc, panZoomDamp: 1 - 0.4 * parallax },
    { role: "subject", src: tuple.subjectSrc, panZoomDamp: 1 },
  ];
}

/** 层源合成:深度拆层/原生分层的二元组(静帧)→ N 层 + atmosphere 模板层。
 * vscDepthLayers(10-10 批B,parallax-glide/dolly-zoom 层系数配方):按 role
 * 施加 damp 梯度与 blur/降饱和锚——覆盖旧二元组的 damp 默认(配方即该镜的
 * 层间关系真源;无 vsc 时行为逐字节不变)。 */
export function layerStackForClip(
  clip: TimelineRenderClip,
  layerUrlByClipId: Readonly<Record<string, { backgroundSrc: string; subjectSrc: string; parallax?: number }>> | undefined,
  atmosphereEffects: readonly EditingEffect[] | undefined,
  vscDepthLayers?: import("@/lib/studio/remotion/shot-fx-decisions").ShotFxVscLayerCoefficients,
): { layerStack?: CompositionLayerSpec[] } {
  const staticImage = clip.source.kind === "storyboardImage" || clip.trackKind === "image";
  const legacyStack = staticImage && layerUrlByClipId?.[clip.id]
    ? layerStackFromLegacyTuple(layerUrlByClipId[clip.id])
    : [];
  const imageLayers = vscDepthLayers
    ? legacyStack.map((layer) => applyVscDepthCoefficients(layer, vscDepthLayers))
    : legacyStack;
  const atmoLayers: CompositionLayerSpec[] = [];
  for (const effect of atmosphereEffects ?? []) {
    const template = effect.params.template;
    if (typeof template !== "string" || !isAtmosphereTemplateId(template)) {
      // fail-closed(同 gradeForClip):未知模板拒渲染,不静默丢层。
      throw new Error(`atmosphere 效果的模板不在闭集: ${String(template)} (clip ${clip.id})`);
    }
    const intensityRaw = Number(effect.params.intensity ?? 1);
    const intensity = Number.isFinite(intensityRaw) ? Math.min(2, Math.max(0, intensityRaw)) : 1;
    atmoLayers.push({
      role: "atmosphere",
      template: { id: template, params: scaledTemplateParams(template, undefined, intensity) },
      ...(atmoLayers.length === 0 ? { blendMode: "screen" as const } : {}),
    });
  }
  const layerStack = [...imageLayers, ...atmoLayers];
  return layerStack.length > 0 ? { layerStack } : {};
}

/** vsc depth 层系数施加:图片层按 role 取 damp/锚(前景锚只在有 foreground 层的
 * 栈上生效——legacy 二元组只有 bg/subject,foreground 系数由 N 层源消费)。 */
function applyVscDepthCoefficients(
  layer: CompositionLayerSpec,
  layers: import("@/lib/studio/remotion/shot-fx-decisions").ShotFxVscLayerCoefficients,
): CompositionLayerSpec {
  if (layer.role === "background") {
    return {
      ...layer,
      panZoomDamp: layers.background.panZoomDamp,
      ...(layers.background.opacity !== undefined ? { opacity: layers.background.opacity } : {}),
      ...(layers.background.blurFromPx !== undefined || layers.background.blurToPx !== undefined || layers.background.saturate !== undefined
        ? {
            depthAnchor: {
              ...(layers.background.blurFromPx !== undefined ? { blurFromPx: layers.background.blurFromPx } : {}),
              ...(layers.background.blurToPx !== undefined ? { blurToPx: layers.background.blurToPx } : {}),
              ...(layers.background.saturate !== undefined ? { saturate: layers.background.saturate } : {}),
            },
          }
        : {}),
    };
  }
  if (layer.role === "subject") {
    // 主体/主阅读层必须高清无锚(卡片已知坑):只改 damp,不加 blur/降饱和。
    return { ...layer, panZoomDamp: layers.subject.panZoomDamp };
  }
  if (layer.role === "foreground" && layers.foreground) {
    return {
      ...layer,
      panZoomDamp: layers.foreground.panZoomDamp,
      ...(layers.foreground.blurFromPx !== undefined || layers.foreground.blurToPx !== undefined
        ? {
            depthAnchor: {
              ...(layers.foreground.blurFromPx !== undefined ? { blurFromPx: layers.foreground.blurFromPx } : {}),
              ...(layers.foreground.blurToPx !== undefined ? { blurToPx: layers.foreground.blurToPx } : {}),
            },
          }
        : {}),
    };
  }
  return layer;
}

