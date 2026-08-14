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
