// Cinematic camera movement presets — pure functions that compute camera
// position, lookAt, and FOV for each frame, driven by useCurrentFrame().
//
// All functions are deterministic and side-effect-free so the Player and the
// fixed bundle produce identical transforms per frame (same discipline as
// pan-zoom.ts / visual-style.ts).

import type { CinematicCameraPreset, CinematicConfig } from "./composition-props";

export interface CameraState {
  /** Camera world-space position [x, y, z]. */
  position: [number, number, number];
  /** Point the camera looks at [x, y, z]. */
  lookAt: [number, number, number];
  /** Field of view in degrees. */
  fov: number;
}

/** Default camera distance from the image plane. */
const DEFAULT_CAMERA_DISTANCE = 5;

/** Easing function: smoothstep for natural acceleration/deceleration. */
function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Ease-out cubic: fast start, gentle settle (whip/crash moves). */
function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute the camera state for a given frame, preset, and config.
 *
 * @param frame Clip-relative frame (0 = first frame of the clip).
 * @param durationInFrames Total clip duration in frames.
 * @param preset Camera movement preset.
 * @param config Cinematic config (parallaxStrength, cameraDistance, etc.).
 * @returns CameraState with position, lookAt, and fov.
 */
export function cameraStateAtFrame(
  frame: number,
  durationInFrames: number,
  preset: CinematicCameraPreset,
  config: CinematicConfig,
): CameraState {
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    throw new Error(`cinematic 时长必须是正整数帧: ${durationInFrames}`);
  }

  const span = durationInFrames - 1;
  const progress = span <= 0 ? 0 : Math.min(1, Math.max(0, frame / span));
  const eased = smoothstep(progress);

  const dist = config.cameraDistance || DEFAULT_CAMERA_DISTANCE;
  const height = config.cameraHeight || 0;
  const strength = config.parallaxStrength || 1;
  const lookAt: [number, number, number] = [0, 0, 0];

  switch (preset) {
    case "cinematic-dolly-in": {
      // Push from dist to dist*0.4
      const z = lerp(dist, dist * 0.4, eased);
      return { position: [0, height, z], lookAt, fov: 50 };
    }

    case "cinematic-dolly-out": {
      // Pull from dist*0.4 to dist
      const z = lerp(dist * 0.4, dist, eased);
      return { position: [0, height, z], lookAt, fov: 50 };
    }

    case "cinematic-crane-up": {
      // Rise from -1 to 2, slight forward
      const y = lerp(-1, 2, eased) * strength + height;
      const z = lerp(dist, dist * 0.85, eased);
      return { position: [0, y, z], lookAt, fov: 50 };
    }

    case "cinematic-orbit": {
      // Circle around the center
      const angle = lerp(0, Math.PI / 6, eased); // 0 to 30 degrees
      const radius = dist;
      const x = Math.sin(angle) * radius * strength;
      const z = Math.cos(angle) * radius;
      return { position: [x, height, z], lookAt, fov: 50 };
    }

    case "cinematic-parallax-lr": {
      // Side-to-side parallax with depth
      const x = lerp(-0.8, 0.8, eased) * strength;
      return { position: [x, height, dist], lookAt, fov: 50 };
    }

    case "cinematic-parallax-ud": {
      // Vertical parallax with depth
      const y = lerp(0.8, -0.8, eased) * strength + height;
      return { position: [0, y, dist], lookAt, fov: 50 };
    }

    case "cinematic-ken-burns-3d": {
      // Enhanced Ken Burns: scale + z push + slight x drift
      const z = lerp(dist, dist * 0.7, eased);
      const x = lerp(-0.3, 0.3, eased) * strength;
      return { position: [x, height, z], lookAt, fov: lerp(50, 55, eased) };
    }

    case "cinematic-handheld": {
      // Subtle handheld shake using layered sine waves (deterministic, no random)
      const t = frame;
      const shakeX = (Math.sin(t * 0.13) + Math.sin(t * 0.27) * 0.5) * 0.08 * strength;
      const shakeY = (Math.cos(t * 0.17) + Math.sin(t * 0.31) * 0.5) * 0.06 * strength;
      const shakeZ = Math.sin(t * 0.09) * 0.03 * strength;
      return {
        position: [shakeX, height + shakeY, dist + shakeZ],
        lookAt,
        fov: 50 + Math.sin(t * 0.07) * 0.5,
      };
    }

    case "cinematic-dutch-roll": {
      // Slow Dutch tilt (z-axis roll) with slight orbit
      const angle = lerp(0, Math.PI / 12, eased); // 0 to 15 degrees
      const radius = dist;
      const x = Math.sin(angle) * radius * 0.3 * strength;
      const z = Math.cos(angle) * radius;
      return { position: [x, height, z], lookAt, fov: 50 };
    }

    case "cinematic-vertigo": {
      // Hitchcock dolly-zoom: pull back while narrowing FOV — subject size
      // holds while the background depth stretches.
      const z = lerp(dist * 0.7, dist * 1.6, eased) * (strength * 0.5 + 0.5);
      const fov = lerp(55, 30, eased);
      return { position: [0, height, z], lookAt, fov };
    }

    case "cinematic-crane-down": {
      // Descend into the scene from above.
      const y = lerp(2, -0.8, eased) * strength + height;
      const z = lerp(dist * 0.85, dist, eased);
      return { position: [0, y, z], lookAt, fov: 50 };
    }

    case "cinematic-spiral": {
      // Rising spiral approach: orbit + ascend + push in. Epic reveals.
      const angle = lerp(0, Math.PI * 0.6, eased); // 0 → 108°
      const radius = lerp(dist, dist * 0.75, eased);
      const x = Math.sin(angle) * radius * strength;
      const z = Math.cos(angle) * radius;
      const y = lerp(-0.8, 1.2, eased) * strength + height;
      return { position: [x, y, z], lookAt, fov: lerp(52, 46, eased) };
    }

    case "cinematic-arc-left": {
      // Lateral arc (jib-style): translate along a leftward arc while facing
      // slightly ahead of the subject — distinct from a centered orbit.
      const t = lerp(0, 1, eased);
      const x = Math.cos(t * Math.PI / 2) * 0.9 * strength;
      const z = dist - Math.sin(t * Math.PI / 2) * 0.6;
      return { position: [x - 0.9 * strength, height, z], lookAt: [lerp(0, -0.4, eased) * strength, 0, 0], fov: 50 };
    }

    case "cinematic-arc-right": {
      // Mirror of arc-left.
      const t = lerp(0, 1, eased);
      const x = Math.cos(t * Math.PI / 2) * 0.9 * strength;
      const z = dist - Math.sin(t * Math.PI / 2) * 0.6;
      return { position: [0.9 * strength - x, height, z], lookAt: [lerp(0, 0.4, eased) * strength, 0, 0], fov: 50 };
    }

    case "cinematic-reveal-tilt-up": {
      // Low, mostly static camera tilts from ground to sky — reveal towers,
      // giants, skies. The tilt is expressed via the rising lookAt target.
      const z = lerp(dist, dist * 0.92, eased);
      const lookAtY = lerp(-1.4, 1.6, eased);
      return { position: [0, height + 0.6, z], lookAt: [0, lookAtY, 0], fov: 52 };
    }

    case "cinematic-drift": {
      // Dreamy slow float: gentle lateral + forward drift with a whisper of FOV.
      const x = lerp(-0.25, 0.25, eased) * strength;
      const z = lerp(dist, dist * 0.88, eased);
      const y = height + Math.sin(progress * Math.PI) * 0.15 * strength;
      return { position: [x, y, z], lookAt, fov: lerp(48, 50, eased) };
    }

    case "cinematic-fall": {
      // Accelerating downward fall (eased² for gravity) with a slight push.
      const fallEased = eased * eased;
      const y = lerp(1.6, -1.3, fallEased) * strength + height;
      const z = lerp(dist, dist * 0.9, eased);
      return { position: [0, y, z], lookAt: [0, lerp(-0.4, -1.0, fallEased), 0], fov: 54 };
    }

    case "cinematic-zoom-in": {
      // Pure optical zoom: FOV narrows with a fixed camera — compresses the
      // depth stack unlike a dolly (which changes perspective).
      return { position: [0, height, dist], lookAt, fov: lerp(55, 34, eased) };
    }

    case "cinematic-zoom-out": {
      // Pure optical zoom out: FOV widens, environment opens up.
      return { position: [0, height, dist], lookAt, fov: lerp(34, 55, eased) };
    }

    case "cinematic-tilt-down": {
      // Mirror of reveal-tilt-up: tilt from sky/high down to the subject.
      return {
        position: [0, height + 0.6, dist * 0.96],
        lookAt: [0, lerp(1.6, -1.2, eased), 0],
        fov: 52,
      };
    }

    case "cinematic-pan-left": {
      // Static camera pans (yaws) to the left — classic horizontal pan.
      return { position: [0, height, dist], lookAt: [lerp(0.9, -0.9, eased) * strength, 0, 0], fov: 50 };
    }

    case "cinematic-pan-right": {
      // Static camera pans to the right.
      return { position: [0, height, dist], lookAt: [lerp(-0.9, 0.9, eased) * strength, 0, 0], fov: 50 };
    }

    case "cinematic-whip-pan": {
      // Fast pan sweep with an ease-out settle — transition/energy beat.
      const sweep = lerp(1.15, -1.15, easeOutCubic(progress)) * strength;
      return { position: [0, height, dist], lookAt: [sweep, 0, 0], fov: lerp(48, 50, eased) };
    }

    case "cinematic-pedestal-up": {
      // Pure vertical rise (no crane z-change) — pedestal/boom up.
      const y = lerp(-0.6, 1.2, eased) * strength + height;
      return { position: [0, y, dist], lookAt, fov: 50 };
    }

    case "cinematic-pedestal-down": {
      // Pure vertical sink — pedestal/boom down.
      const y = lerp(1.2, -0.6, eased) * strength + height;
      return { position: [0, y, dist], lookAt, fov: 50 };
    }

    case "cinematic-tracking-left": {
      // Orientation-locked lateral tracking (camera faces straight ahead,
      // translating left) — unlike parallax-lr which keeps looking at origin.
      const x = lerp(0.8, -0.8, eased) * strength;
      return { position: [x, height, dist], lookAt: [x, height, 0], fov: 50 };
    }

    case "cinematic-tracking-right": {
      // Orientation-locked lateral tracking to the right.
      const x = lerp(-0.8, 0.8, eased) * strength;
      return { position: [x, height, dist], lookAt: [x, height, 0], fov: 50 };
    }

    case "cinematic-fly-through": {
      // Aggressive push deep into the scene with a slight FOV widen and a
      // whisper of lateral weave — immersive fly-in.
      const z = lerp(dist, dist * 0.32, eased);
      const x = Math.sin(progress * Math.PI) * 0.15 * strength;
      return { position: [x, height, z], lookAt, fov: lerp(50, 58, eased) };
    }

    case "cinematic-pull-back-reveal": {
      // From close-up all the way to a wide world reveal — ending shot.
      const z = lerp(dist * 0.35, dist * 1.6, eased);
      const y = height + lerp(0, 0.5, eased);
      return { position: [0, y, z], lookAt, fov: lerp(46, 54, eased) };
    }

    case "cinematic-crash-zoom": {
      // Fast punch-in optical zoom with an ease-out settle — emphasis beat.
      return { position: [0, height, dist], lookAt, fov: lerp(55, 26, easeOutCubic(progress)) };
    }

    case "cinematic-slow-push": {
      // Barely perceptible creep-in — long-take tension, interview gaze.
      const z = lerp(dist, dist * 0.92, eased);
      return { position: [0, height, z], lookAt, fov: 50 };
    }

    case "cinematic-rise-and-pull": {
      // Jib up-and-out combo: rise while pulling back — god-view endings.
      const y = lerp(0, 1.4, eased) * strength + height;
      const z = lerp(dist * 0.8, dist * 1.5, eased);
      return { position: [0, y, z], lookAt, fov: lerp(48, 52, eased) };
    }

    case "cinematic-descend-and-push": {
      // Descend while pushing in — enter a scene from above.
      const y = lerp(1.4, -0.4, eased) * strength + height;
      const z = lerp(dist * 1.3, dist * 0.8, eased);
      return { position: [0, y, z], lookAt, fov: 50 };
    }

    case "cinematic-impact": {
      // Decaying shake + FOV punch for explosions/hits/landings.
      const decay = Math.exp(-3 * progress);
      const punch = Math.exp(-5 * progress);
      const t = frame;
      const shakeX = (Math.sin(t * 0.9) + Math.sin(t * 1.7) * 0.6) * 0.18 * decay * strength;
      const shakeY = (Math.cos(t * 1.1) + Math.sin(t * 2.1) * 0.5) * 0.14 * decay * strength;
      return {
        position: [shakeX, height + shakeY, dist + 0.25 * punch],
        lookAt,
        fov: 50 + 4 * punch,
      };
    }

    case "cinematic-breathing": {
      // Subtle oscillating push-pull, like a held breath — quiet observation.
      const z = dist - Math.sin(progress * Math.PI * 2) * 0.12 * strength;
      return { position: [0, height, z], lookAt, fov: 50 + Math.sin(progress * Math.PI * 2) * 0.6 };
    }

    default: {
      // Static fallback
      return { position: [0, height, dist], lookAt, fov: 50 };
    }
  }
}

/**
 * Compute the depth displacement scale for the given frame.
 * This is a fixed value; depth displacement is applied at the vertex level
 * and doesn't change per frame — only the camera moves.
 */
export function depthDisplacementScale(
  _frame: number,
  _durationInFrames: number,
  config: CinematicConfig,
): number {
  // Scale displacement by parallax strength so deeper scenes get more separation
  return (config.parallaxStrength || 1) * 2.0;
}
