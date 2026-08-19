// Design §6: the pure, engine-agnostic composition input. The host projects a
// validated TimelineRenderPlan into these props, replacing every asset path with
// a capability URL (media bridge) before either the Player or the fixed bundle
// mounts. This module imports no store, plan JSON, or Studio panel — only the
// timing primitives it shares with the renderer.

import type { CompositionTransitionEffect } from "./timing";

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

// Normalised 2D transform applied per visual clip. Mirrors EditingTransform but
// stays local so the composition never depends on the editing type surface.
export interface CompositionTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

// panZoom is expressed as an interpolation from a start to an end scale/origin,
// matching the FFmpeg zoompan intent (design §6). origin values are 0..1.
export interface CompositionPanZoom {
  fromScale: number;
  toScale: number;
  originX: number;
  originY: number;
}

// ---------------------------------------------------------------------------
// Cinematic 3D config (depth-based 3D parallax / DoF / camera moves)
// ---------------------------------------------------------------------------

/** Camera movement presets for depth-based 3D cinematic effects. */
export type CinematicCameraPreset =
  | "cinematic-dolly-in"
  | "cinematic-dolly-out"
  | "cinematic-crane-up"
  | "cinematic-crane-down"
  | "cinematic-orbit"
  | "cinematic-parallax-lr"
  | "cinematic-parallax-ud"
  | "cinematic-ken-burns-3d"
  | "cinematic-handheld"
  | "cinematic-dutch-roll"
  | "cinematic-vertigo"
  | "cinematic-spiral"
  | "cinematic-arc-left"
  | "cinematic-arc-right"
  | "cinematic-reveal-tilt-up"
  | "cinematic-drift"
  | "cinematic-fall"
  | "cinematic-zoom-in"
  | "cinematic-zoom-out"
  | "cinematic-tilt-down"
  | "cinematic-pan-left"
  | "cinematic-pan-right"
  | "cinematic-whip-pan"
  | "cinematic-pedestal-up"
  | "cinematic-pedestal-down"
  | "cinematic-tracking-left"
  | "cinematic-tracking-right"
  | "cinematic-fly-through"
  | "cinematic-pull-back-reveal"
  | "cinematic-crash-zoom"
  | "cinematic-slow-push"
  | "cinematic-rise-and-pull"
  | "cinematic-descend-and-push"
  | "cinematic-impact"
  | "cinematic-breathing";

/**
 * When present on a visual clip, enables 3D cinematic mode via @remotion/three.
 * The image is mapped onto a depth-displaced plane; a PerspectiveCamera is
 * animated by `useCurrentFrame()` according to the selected preset.
 */
export interface CinematicConfig {
  preset: CinematicCameraPreset;
  /** Capability URL of the depth-map PNG (grayscale, 0=near, 255=far). */
  depthMapSrc: string;
  /** Camera distance from the plane (default 5). Larger = more parallax. */
  cameraDistance: number;
  /** Camera height offset (default 0). */
  cameraHeight: number;
  /** Depth-of-field focus distance in world units (default = cameraDistance). */
  dofFocusDistance: number;
  /** DOF aperture / bokeh size (0 = infinite DoF / no blur). */
  dofAperture: number;
  /** Motion blur sample count (0 = disabled; higher = smoother but slower). */
  motionBlurSamples: number;
  /** Parallax strength multiplier (default 1; scale camera movement). */
  parallaxStrength: number;
  /** Bloom / glow intensity for bright areas (0 = disabled). */
  bloomIntensity: number;
  /** Vignette darkness 0..1 (0 = disabled). */
  vignetteDarkness: number;
  /** Chromatic aberration offset in pixels (0 = disabled). */
  chromaticAberration: number;
}

// Frame-based envelope point (host converts microseconds -> frames up front so
// the composition performs no unit math beyond interpolation).
export interface CompositionEnvelopePoint {
  frame: number;
  gain: number;
}

export interface CompositionFade {
  fadeInFrames: number;
  fadeOutFrames: number;
}

// ---------------------------------------------------------------------------
// Visual clips
// ---------------------------------------------------------------------------

export type CompositionVisualKind = "image" | "video";

// ---------------------------------------------------------------------------
// Multi-layer stack (08-19 multilayer-composition Child1)
// ---------------------------------------------------------------------------

/** 层角色闭集:背景板/主体/前景遮挡/程序化氛围。 */
export type CompositionLayerRole = "background" | "subject" | "foreground" | "atmosphere";

/** 层混合模式闭集(atmosphere/foreground 层用;normal=缺省)。 */
export type CompositionLayerBlendMode = "normal" | "screen" | "multiply" | "overlay" | "soft-light";

/** 层自带漂移(雾带类横移/上飘;单位=屏宽/高百分比每秒,双份循环免回绕)。 */
export interface CompositionLayerDrift {
  speedX?: number;
  speedY?: number;
  /** 漂移层双份相距 100% 循环覆盖(缺省 true);false=单份不回绕。 */
  wrap?: boolean;
}

/**
 * 有序层描述(N 层合成,08-19 multilayer-composition Child1):
 * 渲染按数组顺序 z 叠放;图片层各吃 damp 折减运镜,atmosphere 层由
 * template 实例化程序化渲染(雾带/粒子),ambient/drift 每层独立。
 */
export interface CompositionLayerSpec {
  /** 图片层=capability URL;atmosphere 程序化层可省。 */
  src?: string;
  role: CompositionLayerRole;
  /** panZoom 折减(围绕 1.0 收敛,0..2):1=吃满,<1 懒、>1 灵;缺省按 role(bd 0.6/subject 1/foreground 1.15/atmosphere 0)。 */
  panZoomDamp?: number;
  ambient?: import("./pan-zoom").CompositionAmbient;
  drift?: CompositionLayerDrift;
  blendMode?: CompositionLayerBlendMode;
  opacity?: number;
  /** 程序化氛围模板(Child2 决策注入;Child1 起 atmo:fog-band/atmo:light-dust 落地)。 */
  template?: { id: string; params?: Record<string, number> };
}


// A visual clip already placed on the frame grid by the timing layout. `src` is
// a capability URL; there are no filesystem paths in composition props.
export interface CompositionVisualClipProps {
  clipId: string;
  kind: CompositionVisualKind;
  src: string;
  from: number;
  durationInFrames: number;
  transform: CompositionTransform;
  // Defaults to cover. Use contain when the complete source frame must remain visible.
  fit?: "cover" | "contain";
  panZoom?: CompositionPanZoom;
  /** 环境动画(sin/cos 周期运动叠加在 panZoom 上;2026-08-19 让画面活起来)。 */
  ambient?: import("./pan-zoom").CompositionAmbient;
  /** When present, renders in 3D cinematic mode via @remotion/three. */
  cinematic?: CinematicConfig;
  /** 3D 贴图静帧 URL（TextureLoader 只能解码图片；src 保留视频供音轨取声）。 */
  cinematicImageSrc?: string;
  /** 镜头级 2D 特效（shake/glow/grain/chroma），合成层注入。 */
  fx?: import("./visual-fx").CompositionVisualFx;
  /** 成片调色（08-18-haldclut-grade）：LUT 闭集见 cinematic-luts.ts；lutSrc 为
   * media-bridge URL（build 侧由 lutUrlById 注入）。渲染期由 GLGradeMedia 上屏。 */
  grade?: { lutId: string; lutSrc?: string; blend: number; blendPulse?: { amp: number; freq: number; phase?: number } };
  /** 帧步进(On Twos,08-19 第二批):运镜/环境动画按 N 帧一档采样(2=on twos,3=on threes)。 */
  frameStep?: number;
  /** 图层分离分层渲染（08-19 图层分离探索）：存在时走 LayeredVisualClip
   * 双层视差（背景运镜折减+主体 ambient），忽略单层媒体位（src 保留供音轨/转场）。 */
  layers?: { backgroundSrc: string; subjectSrc: string; parallax?: number };
  /** N 层合成（08-19 multilayer-composition Child1）：存在时走 LayeredVisualClip
   * N 层渲染,与旧 layers 二元组互斥(校验闸 fail-closed);src 保留供音轨/转场。 */
  layerStack?: CompositionLayerSpec[];
  // Video-only playback controls; ignored for images.
  trimStartFrames?: number;
  playbackRate?: number;
  muted?: boolean;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

// A transition between two adjacent visual clips, with its overlap already
// resolved to frames. "cut" carries a zero overlap and renders no blend.
export interface CompositionTransitionProps {
  fromClipId: string;
  toClipId: string;
  effectId: CompositionTransitionEffect;
  overlapFrames: number;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type CompositionAudioKind = "voice" | "bgm" | "sfx" | "ambience";

// An audio clip mounted by time. Volume is combined by the host/composition from
// clip volume, fades, envelope and ducking; `src` is a capability URL.
export interface CompositionAudioClipProps {
  clipId: string;
  kind: CompositionAudioKind;
  src: string;
  from: number;
  durationInFrames: number;
  volume: number;
  // Legacy timeline composition props omit scope. Parameterized shot/chapter inputs
  // require it and are validated by their target-specific metadata boundary.
  renderScope?: "shot" | "chapter";
  trimStartFrames?: number;
  playbackRate?: number;
  fade?: CompositionFade;
  envelope?: CompositionEnvelopePoint[];
  duckingEnvelope?: CompositionEnvelopePoint[];
}

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

// A burn-in subtitle cue, already placed on the frame grid.
export interface CompositionSubtitleCueProps {
  cueId: string;
  text: string;
  from: number;
  durationInFrames: number;
}

// A transparent motion layer generated by HyperFrames and consumed by the
// single formal Remotion renderer. The source is still a localhost capability
// URL; filesystem paths never cross the composition boundary.
export interface CompositionOverlayClipProps {
  clipId: string;
  src: string;
  from: number;
  durationInFrames: number;
}

// ---------------------------------------------------------------------------
// Top-level composition props
// ---------------------------------------------------------------------------

export type CompositionProps = Record<string, unknown> & {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  visualClips: CompositionVisualClipProps[];
  transitions: CompositionTransitionProps[];
  audioClips: CompositionAudioClipProps[];
  subtitles: CompositionSubtitleCueProps[];
  /** 烧录字幕字体 id（注册表白名单+custom:* 形态；缺省回落毛笔楷书）。 */
  subtitleFont?: string;
  /** 运行时注入的字体面（自定义字体经 media bridge URL 加载；渲染端
   * delayRender+FontFace 挂载后再出帧）。 */
  customFonts?: Array<{ family: string; url: string }>;
  overlayClips?: CompositionOverlayClipProps[];
};

type TargetCompositionIdentity = {
  projectId: string;
  chapterId: string;
};

export type StoryboardShotCompositionProps = CompositionProps
  & TargetCompositionIdentity
  & {
    target: "shot";
    shotId: string;
    shotRevision: number;
    audioClips: Array<CompositionAudioClipProps & { renderScope: "shot" }>;
  };

export type ChapterVideoCompositionProps = CompositionProps
  & TargetCompositionIdentity
  & {
    target: "chapter";
    editingProjectId: string;
    editingRevision: number;
    audioClips: Array<CompositionAudioClipProps & { renderScope: "chapter" }>;
  };
