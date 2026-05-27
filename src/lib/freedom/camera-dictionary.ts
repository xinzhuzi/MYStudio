/**
 * Camera parameter dictionaries — TypeScript port of Higgsfield's promptUtils.js.
 *
 * Provides camera body, lens, focal-length, and aperture mappings together with
 * UI-friendly option arrays and a `buildCinemaPrompt` helper that compiles them
 * into a structured prompt string.
 */

// ---------------------------------------------------------------------------
// 1. CAMERA_MAP – camera body display names → prompt descriptions
// ---------------------------------------------------------------------------

export const CAMERA_MAP: Record<string, string> = {
  'Compact Rangefinder':    'compact rangefinder camera',
  'ARRI Alexa IMAX 65mm':  'ARRI Alexa 65 IMAX cinema camera',
  'Modular 8K Digital':    'modular 8K digital cinema camera',
  'Red Komodo 6K':         'RED Komodo 6K cinema camera',
  'Sony Venice Full Frame': 'Sony Venice full-frame cinema camera',
  'Blackmagic URSA 12K':   'Blackmagic URSA 12K cinema camera',
};

// ---------------------------------------------------------------------------
// 2. LENS_MAP – lens display names → prompt descriptions
// ---------------------------------------------------------------------------

export const LENS_MAP: Record<string, string> = {
  'Cine Macro':             'cinema macro lens',
  'Vintage Anamorphic':     'vintage anamorphic lens',
  'Halation Diffusion':     'halation diffusion vintage lens',
  'Bokeh Master Portrait':  'bokeh master portrait lens',
  'Swirl Bokeh Portrait':   'swirl bokeh portrait lens',
  'Tilt-Shift Miniature':   'tilt-shift miniature lens',
  'Ultra Wide Rectilinear': 'ultra-wide rectilinear lens',
  'Fast Prime Cine':        'fast prime cinema lens',
  'Telephoto Cine':         'telephoto cinema lens',
  'Wide Angle Cine':        'wide-angle cinema lens',
  '70s Cinema Prime':       '70s cinema prime lens',
};

// ---------------------------------------------------------------------------
// 3. FOCAL_PERSPECTIVE – focal length (mm) → perspective description
// ---------------------------------------------------------------------------

export const FOCAL_PERSPECTIVE: Record<number, string> = {
  14:  'ultra-wide dramatic perspective with spatial distortion',
  24:  'wide environmental context with depth',
  35:  'natural cinematic perspective',
  50:  'standard human eye perspective',
  85:  'portrait compression, flattering perspective',
  200: 'extreme telephoto compression, stacked planes',
};

// ---------------------------------------------------------------------------
// 4. APERTURE_EFFECT – aperture value → depth-of-field / bokeh description
// ---------------------------------------------------------------------------

export const APERTURE_EFFECT: Record<string, string> = {
  'f/1.4': 'extremely shallow depth of field, creamy bokeh, subject isolation',
  'f/2.8': 'moderate depth of field, gentle background separation',
  'f/8':   'deep focus, sharp from foreground to background',
};

// ---------------------------------------------------------------------------
// 5. UI option arrays
// ---------------------------------------------------------------------------

export const CAMERA_OPTIONS: string[]   = Object.keys(CAMERA_MAP);
export const LENS_OPTIONS: string[]     = Object.keys(LENS_MAP);
export const FOCAL_OPTIONS: number[]    = Object.keys(FOCAL_PERSPECTIVE).map(Number);
export const APERTURE_OPTIONS: string[] = Object.keys(APERTURE_EFFECT);

// ---------------------------------------------------------------------------
// 6. buildCinemaPrompt – assemble a structured cinema prompt string
// ---------------------------------------------------------------------------

/**
 * Compile individual camera parameters into a single structured prompt string.
 *
 * @param basePrompt   - The user's original prompt / scene description.
 * @param camera       - Display name of the camera body (key in `CAMERA_MAP`).
 * @param lens         - Display name of the lens (key in `LENS_MAP`).
 * @param focalLength  - Focal length in mm (key in `FOCAL_PERSPECTIVE`).
 * @param aperture     - Aperture string such as `"f/1.4"` (key in `APERTURE_EFFECT`).
 * @returns A comma-separated prompt string incorporating all parameters.
 */
export function buildCinemaPrompt(
  basePrompt: string,
  camera: string,
  lens: string,
  focalLength: number,
  aperture: string,
): string {
  const cameraDesc  = CAMERA_MAP[camera] ?? camera;
  const lensDesc    = LENS_MAP[lens] ?? lens;
  const perspective = FOCAL_PERSPECTIVE[focalLength] ?? '';
  const depthEffect = APERTURE_EFFECT[aperture] ?? '';

  const parts: string[] = [
    basePrompt,
    `shot on a ${cameraDesc}`,
    `using a ${lensDesc} at ${focalLength}mm (${perspective})`,
    `aperture ${aperture}`,
    depthEffect,
    'cinematic lighting',
    'natural color science',
    'high dynamic range',
    'professional photography, ultra-detailed, 8K resolution',
  ];

  return parts.filter((p) => p && p.trim() !== '').join(', ');
}
