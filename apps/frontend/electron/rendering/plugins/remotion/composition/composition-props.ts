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
  /** When present, renders in 3D cinematic mode via @remotion/three. */
  cinematic?: CinematicConfig;
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
