import type { ModelInput } from "./model-registry-types";

export const promptInput = (): ModelInput => ({
  type: 'string',
  description: 'Text prompt for generation',
});

export const widthHeightInputs = (
  min: number,
  max: number,
  step: number,
  defaults?: { width?: number; height?: number },
): Record<string, ModelInput> => ({
  width: {
    type: 'integer',
    minValue: min,
    maxValue: max,
    step,
    ...(defaults?.width !== undefined ? { default: defaults.width } : {}),
    description: 'Image width in pixels',
  },
  height: {
    type: 'integer',
    minValue: min,
    maxValue: max,
    step,
    ...(defaults?.height !== undefined ? { default: defaults.height } : {}),
    description: 'Image height in pixels',
  },
});

export const aspectRatioInput = (
  ratios: string[],
  defaultRatio?: string,
): ModelInput => ({
  type: 'string',
  enum: ratios,
  ...(defaultRatio !== undefined ? { default: defaultRatio } : {}),
  description: 'Aspect ratio',
});

export const numImagesInput = (
  min: number,
  max: number,
): ModelInput => ({
  type: 'integer',
  minValue: min,
  maxValue: max,
  description: 'Number of images to generate',
});

export const durationInput = (
  opts: { default?: number; enum?: number[] },
): ModelInput => ({
  type: 'integer',
  ...(opts.enum ? { enum: opts.enum } : {}),
  ...(opts.default !== undefined ? { default: opts.default } : {}),
  description: 'Video duration in seconds',
});

export const resolutionInput = (
  values: string[],
  defaultVal?: string,
): ModelInput => ({
  type: 'string',
  enum: values,
  ...(defaultVal !== undefined ? { default: defaultVal } : {}),
  description: 'Output resolution',
});
