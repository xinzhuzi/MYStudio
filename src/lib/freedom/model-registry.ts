// =============================================================================
// Model Registry — ported from Open-Higgsfield-AI models.js
// =============================================================================
// Contains ALL 49 T2I (text-to-image) and ALL 40 T2V (text-to-video) models
// with full metadata, parameter definitions, and helper query functions.
// =============================================================================

// ---------------------------------------------------------------------------
// §1  TypeScript Interfaces
// ---------------------------------------------------------------------------

export interface ModelInput {
  type: 'string' | 'integer' | 'number' | 'array';
  enum?: (string | number)[];
  minValue?: number;
  maxValue?: number;
  step?: number;
  default?: any;
  description?: string;
  isEdit?: boolean;
  maxItems?: number;
}

export interface BaseModel {
  id: string;
  name: string;
  endpoint?: string;
  category?: 'premium' | 'open-source' | 'fast' | 'latest';
  inputs: Record<string, ModelInput>;
  /** 供应商侧的模型 ID 别名列表（用于匹配供应商实际拥有的模型）。省略时以 id 本身做 fallback。 */
  providerAliases?: string[];
}

export type T2IModel = BaseModel;
export type T2VModel = BaseModel;

// ---------------------------------------------------------------------------
// §2  Shared input helpers (DRY)
// ---------------------------------------------------------------------------

const promptInput = (): ModelInput => ({
  type: 'string',
  description: 'Text prompt for generation',
});

const widthHeightInputs = (
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

const aspectRatioInput = (
  ratios: string[],
  defaultRatio?: string,
): ModelInput => ({
  type: 'string',
  enum: ratios,
  ...(defaultRatio !== undefined ? { default: defaultRatio } : {}),
  description: 'Aspect ratio',
});

const numImagesInput = (
  min: number,
  max: number,
): ModelInput => ({
  type: 'integer',
  minValue: min,
  maxValue: max,
  description: 'Number of images to generate',
});

const durationInput = (
  opts: { default?: number; enum?: number[] },
): ModelInput => ({
  type: 'integer',
  ...(opts.enum ? { enum: opts.enum } : {}),
  ...(opts.default !== undefined ? { default: opts.default } : {}),
  description: 'Video duration in seconds',
});

const resolutionInput = (
  values: string[],
  defaultVal?: string,
): ModelInput => ({
  type: 'string',
  enum: values,
  ...(defaultVal !== undefined ? { default: defaultVal } : {}),
  description: 'Output resolution',
});

// ---------------------------------------------------------------------------
// §3  T2I (Text-to-Image) Models — 49 total
// ---------------------------------------------------------------------------

export const T2I_MODELS: T2IModel[] = [
  // 1
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    providerAliases: ["nano-banana","gemini-imagen","gemini-2.5-flash-image","gemini-2.5-flash-image-preview"],
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3', '5:4', '4:5', '21:9',
      ]),
    },
  },
  // 2
  {
    id: 'flux-dev',
    name: 'Flux Dev',
    providerAliases: ["flux-dev","flux-dev-image","flux.1-dev"],
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(128, 2048, 64),
      num_images: numImagesInput(1, 4),
    },
  },
  // 3
  {
    id: 'flux-dev-lora',
    name: 'Flux Dev LoRA',
    providerAliases: ["flux-dev-lora"],
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(128, 2048, 64),
      num_images: numImagesInput(1, 4),
      model_id: {
        type: 'array',
        maxItems: 4,
        description: 'LoRA model IDs to apply',
      },
    },
  },
  // 4
  {
    id: 'flux-kontext-dev-t2i',
    providerAliases: ["flux-kontext-dev-t2i","flux.1-kontext-dev"],
    name: 'Flux Kontext Dev T2I',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21',
      ]),
      num_images: numImagesInput(1, 4),
    },
  },
  // 5
  {
    id: 'hidream-i1-fast',
    providerAliases: ["hidream-i1-fast"],
    name: 'HiDream I1 Fast',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(128, 2048, 64),
      num_images: numImagesInput(1, 4),
    },
  },
  // 6
  {
    id: 'hidream-i1-dev',
    providerAliases: ["hidream-i1-dev"],
    name: 'HiDream I1 Dev',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(128, 2048, 64),
      num_images: numImagesInput(1, 4),
    },
  },
  // 7
  {
    id: 'hidream-i1-full',
    providerAliases: ["hidream-i1-full"],
    name: 'HiDream I1 Full',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(128, 2048, 64),
      num_images: numImagesInput(1, 4),
    },
  },
  // 8
  {
    id: 'ai-anime-generator',
    providerAliases: ["ai-anime-generator"],
    name: 'AI Anime Generator',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 9
  {
    id: 'wan2.1-text-to-image',
    providerAliases: ["wan2.1-text-to-image"],
    name: 'Wan 2.1 Text to Image',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 10
  {
    id: 'flux-kontext-pro-t2i',
    providerAliases: ["flux-kontext-pro-t2i","flux-kontext-pro","flux.1-kontext-pro"],
    name: 'Flux Kontext Pro T2I',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '16:21',
      ]),
    },
  },
  // 11
  {
    id: 'flux-kontext-max-t2i',
    providerAliases: ["flux-kontext-max-t2i","flux-kontext-max"],
    name: 'Flux Kontext Max T2I',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '16:21',
      ]),
    },
  },
  // 12
  {
    id: 'gpt4o-text-to-image',
    providerAliases: ["gpt4o-text-to-image","gpt-4o-image","gpt-4o-image-vip"],
    name: 'GPT-4o Text to Image',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['1:1', '2:3', '3:2']),
      num_images: {
        type: 'integer',
        enum: [1, 2, 4],
        description: 'Number of images to generate',
      },
    },
  },
  // 13
  {
    id: 'midjourney-v7-text-to-image',
    providerAliases: ["midjourney-v7-text-to-image","midjourney-v7","mj_imagine","midjourney","niji-6"],
    name: 'Midjourney V7 Text to Image',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '16:9', '9:16', '3:4', '4:3', '1:2', '2:1', '2:3', '3:2', '5:6', '6:5',
      ]),
      speed: {
        type: 'string',
        enum: ['relaxed', 'fast', 'turbo'],
        description: 'Generation speed tier',
      },
      variety: {
        type: 'integer',
        minValue: 0,
        maxValue: 100,
        step: 5,
        default: 5,
        description: 'Variety level',
      },
      stylization: {
        type: 'integer',
        minValue: 0,
        maxValue: 1000,
        default: 1,
        description: 'Stylization strength',
      },
      weirdness: {
        type: 'integer',
        minValue: 0,
        maxValue: 3000,
        default: 1,
        description: 'Weirdness factor',
      },
    },
  },
  // 14
  {
    id: 'flux-schnell',
    providerAliases: ["flux-schnell","flux-schnell-image"],
    name: 'Flux Schnell',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(128, 2048, 64),
      num_images: numImagesInput(1, 4),
    },
  },
  // 15
  {
    id: 'bytedance-seedream-v3',
    providerAliases: ["bytedance-seedream-v3","doubao-seedream-3","doubao-seedream-3-0-t2i-250415"],
    name: 'ByteDance SeDream V3',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['1:1', '16:9', '9:16', '3:4', '4:3']),
    },
  },
  // 16
  {
    id: 'qwen-image',
    providerAliases: ["qwen-image","qwen-vl-max","aigc-image-qwen","qwen-image-max","qwen-image-max-2025-12-30"],
    name: 'Qwen Image',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', '3:2', '2:3',
      ]),
      num_images: numImagesInput(1, 4),
    },
  },
  // 17
  {
    id: 'flux-pulid',
    providerAliases: ["flux-pulid"],
    name: 'Flux PuLID',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1', '4:3', '3:4']),
      image_url: {
        type: 'string',
        description: 'Reference image URL for identity',
      },
    },
  },
  // 18
  {
    id: 'ideogram-v3-t2i',
    providerAliases: ["ideogram-v3-t2i","ideogram-v3","ideogram_generate_V_3_DEFAULT","ideogram_generate_V_3_QUALITY","ideogram_generate_V_3_TURBO","ideogram_generate_V_1","ideogram_generate_V_1_TURBO","ideogram_generate_V_2","ideogram_generate_V_2_TURBO"],
    name: 'Ideogram V3 T2I',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['1:1', '3:4', '4:3', '9:16', '16:9']),
      render_speed: {
        type: 'string',
        enum: ['Turbo', 'Balanced', 'Quality'],
        description: 'Rendering speed preset',
      },
      style: {
        type: 'string',
        enum: ['Auto', 'General', 'Realistic', 'Design'],
        description: 'Image style',
      },
      num_images: numImagesInput(1, 4),
    },
  },
  // 19
  {
    id: 'google-imagen4',
    providerAliases: ["google-imagen4","imagen-4.0-generate-001"],
    name: 'Google Imagen 4',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1', '4:3', '3:4']),
      num_images: numImagesInput(1, 4),
    },
  },
  // 20
  {
    id: 'google-imagen4-fast',
    providerAliases: ["google-imagen4-fast","imagen-4.0-flash-generate-001"],
    name: 'Google Imagen 4 Fast',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1', '4:3', '3:4']),
      num_images: numImagesInput(1, 4),
    },
  },
  // 21
  {
    id: 'google-imagen4-ultra',
    providerAliases: ["google-imagen4-ultra","imagen-4.0-ultra-generate-001"],
    name: 'Google Imagen 4 Ultra',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1', '4:3', '3:4']),
    },
  },
  // 22
  {
    id: 'sdxl-image',
    providerAliases: ["sdxl-image","sdxl"],
    name: 'SDXL Image',
    category: 'open-source',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 23
  {
    id: 'bytedance-seedream-v4',
    providerAliases: ["bytedance-seedream-v4","doubao-seedream-4-0-250828"],
    name: 'ByteDance SeDream V4',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '16:9', '9:16', '3:4', '4:3', '2:3', '3:2', '21:9',
      ]),
      resolution: resolutionInput(['1K', '2K', '4K']),
      num_images: numImagesInput(1, 4),
    },
  },
  // 24
  {
    id: 'hunyuan-image-2.1',
    providerAliases: ["hunyuan-image-2.1","hunyuan-image"],
    name: 'Hunyuan Image 2.1',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 25
  {
    id: 'chroma-image',
    providerAliases: ["chroma-image","chroma"],
    name: 'Chroma Image',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 26
  {
    id: 'flux-redux',
    providerAliases: ["flux-redux"],
    name: 'Flux Redux',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21',
      ]),
      image_url: {
        type: 'string',
        description: 'Reference image URL',
      },
      num_images: numImagesInput(1, 4),
    },
  },
  // 27
  {
    id: 'flux-krea-dev',
    providerAliases: ["flux-krea-dev"],
    name: 'Flux KREA Dev',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21',
      ]),
      num_images: numImagesInput(1, 4),
    },
  },
  // 28
  {
    id: 'perfect-pony-xl',
    providerAliases: ["perfect-pony-xl"],
    name: 'Perfect Pony XL',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 29
  {
    id: 'neta-lumina',
    providerAliases: ["neta-lumina"],
    name: 'Neta Lumina',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 30
  {
    id: 'wan2.5-text-to-image',
    providerAliases: ["wan2.5-text-to-image"],
    name: 'Wan 2.5 Text to Image',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(768, 1440, 1, { height: 1322 }),
    },
  },
  // 31
  {
    id: 'hunyuan-image-3.0',
    providerAliases: ["hunyuan-image-3.0"],
    name: 'Hunyuan Image 3.0',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 32
  {
    id: 'leonardoai-phoenix-1.0',
    providerAliases: ["leonardoai-phoenix-1.0","leonardo-phoenix"],
    name: 'LeonardoAI Phoenix 1.0',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '16:9', '9:16', '3:4', '4:3', '4:5', '5:4', '2:3', '3:2',
      ]),
    },
  },
  // 33
  {
    id: 'leonardoai-lucid-origin',
    providerAliases: ["leonardoai-lucid-origin","leonardo-lucid-origin"],
    name: 'LeonardoAI Lucid Origin',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '16:9', '9:16', '3:4', '4:3', '4:5', '5:4', '2:3', '3:2',
      ]),
    },
  },
  // 34
  {
    id: 'reve-text-to-image',
    providerAliases: ["reve-text-to-image","reve-image"],
    name: 'Reve Text to Image',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21',
      ]),
    },
  },
  // 35
  {
    id: 'grok-imagine-text-to-image',
    providerAliases: ["grok-imagine-text-to-image","grok-2-image","grok-3-image","grok-4-image"],
    name: 'Grok Imagine Text to Image',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['9:16', '16:9', '2:3', '3:2', '1:1']),
    },
  },
  // 36
  {
    id: 'nano-banana-2',
    providerAliases: ["nano-banana-2","gemini-3.1-pro-image-preview"],
    name: 'Nano Banana 2',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3', '5:4', '4:5', '21:9',
      ]),
      resolution: resolutionInput(['1k', '2k', '4k']),
    },
  },
  // 37
  {
    id: 'nano-banana-pro',
    providerAliases: ["nano-banana-pro","gemini-3-pro-image-preview"],
    name: 'Nano Banana Pro',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3', '5:4', '4:5', '21:9',
      ]),
      resolution: resolutionInput(['1k', '2k', '4k']),
    },
  },
  // 37
  {
    id: 'kling-o1-text-to-image',
    providerAliases: ["kling-o1-text-to-image","kling-o1-image","kling-image","kling-omni-image","kling-image-v1","kling-image-v1-5","kling-image-v2","kling-image-v2-new","kling-image-v2-1"],
    name: 'Kling O1 Text to Image',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2', '21:9',
      ]),
      resolution: resolutionInput(['1k', '2k']),
      num_images: numImagesInput(1, 9),
    },
  },
  // 38
  {
    id: 'z-image-turbo',
    providerAliases: ["z-image-turbo"],
    name: 'Z Image Turbo',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 39
  {
    id: 'flux-2-dev',
    providerAliases: ["flux-2-dev"],
    name: 'Flux 2 Dev',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 40
  {
    id: 'flux-2-flex',
    providerAliases: ["flux-2-flex"],
    name: 'Flux 2 Flex',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2',
      ]),
      resolution: resolutionInput(['1k', '2k']),
    },
  },
  // 41
  {
    id: 'flux-2-pro',
    providerAliases: ["flux-2-pro","flux-pro","flux-pro-max","flux-1.1-pro","flux.1.1-pro","flux-pro-1.1-ultra"],
    name: 'Flux 2 Pro',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2',
      ]),
      resolution: resolutionInput(['1k', '2k']),
    },
  },
  // 42
  {
    id: 'vidu-q2-text-to-image',
    providerAliases: ["vidu-q2-text-to-image","vidu-q2-image","viduq2","viduq2-pro","viduq2-turbo","viduq3-pro"],
    name: 'Vidu Q2 Text to Image',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2', '21:9',
      ]),
      resolution: resolutionInput(['1k', '2k', '4k']),
    },
  },
  // 43
  {
    id: 'bytedance-seedream-v4.5',
    providerAliases: ["bytedance-seedream-v4.5","doubao-seedream-4-5","doubao-seedream-4-5-251128"],
    name: 'ByteDance SeDream V4.5',
    category: 'latest',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2', '21:9',
      ]),
      quality: {
        type: 'string',
        enum: ['basic', 'high'],
        description: 'Output quality level',
      },
    },
  },
  // 44
  {
    id: 'gpt-image-1.5',
    providerAliases: ["gpt-image-1.5","gpt-image-1","gpt-image-1.5-all","gpt-image-1-all","gpt-image-1-mini"],
    name: 'GPT Image 1.5',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['1:1', '2:3', '3:2']),
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Output quality level',
      },
    },
  },
  // 45
  {
    id: 'wan2.6-text-to-image',
    providerAliases: ["wan2.6-text-to-image"],
    name: 'Wan 2.6 Text to Image',
    category: 'latest',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(768, 1440, 1),
    },
  },
  // 46
  {
    id: 'qwen-text-to-image-2512',
    providerAliases: ["qwen-text-to-image-2512"],
    name: 'Qwen Text to Image 2512',
    inputs: {
      prompt: promptInput(),
      ...widthHeightInputs(256, 1536, 1),
    },
  },
  // 47
  {
    id: 'flux-2-klein-4b',
    providerAliases: ["flux-2-klein-4b"],
    name: 'Flux 2 Klein 4B',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '3:4', '4:3', '21:9', '9:21',
      ]),
    },
  },
  // 48
  {
    id: 'flux-2-klein-9b',
    providerAliases: ["flux-2-klein-9b"],
    name: 'Flux 2 Klein 9B',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '3:4', '4:3', '21:9', '9:21',
      ]),
    },
  },
  // 49
  {
    id: 'z-image-base',
    providerAliases: ["z-image-base"],
    name: 'Z Image Base',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '3:4', '4:3', '21:9', '9:21',
      ]),
      image_url: {
        type: 'string',
        description: 'Reference image URL',
      },
      strength: {
        type: 'number',
        minValue: 0,
        maxValue: 1,
        step: 0.01,
        default: 0.6,
        description: 'Denoising strength (0 = keep original, 1 = full generation)',
      },
    },
  },
];

// ---------------------------------------------------------------------------
// §4  T2V (Text-to-Video) Models — 40 total
// ---------------------------------------------------------------------------

export const T2V_MODELS: T2VModel[] = [
  // 1
  {
    id: 'seedance-lite-t2v',
    providerAliases: ["seedance-lite-t2v","doubao-seedance-lite","doubao-seedance-1-0-lite-t2v-250428","doubao-seedance-1-0-lite-i2v-250428"],
    name: 'Seedance Lite T2V',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21',
      ]),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p', '1080p'], '480p'),
    },
  },
  // 2
  {
    id: 'seedance-pro-t2v',
    providerAliases: ["seedance-pro-t2v","doubao-seedance-1-5-pro","doubao-seedance-1-0-pro-250528"],
    name: 'Seedance Pro T2V',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21',
      ]),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p', '1080p'], '480p'),
    },
  },
  // 3
  {
    id: 'seedance-pro-t2v-fast',
    providerAliases: ["seedance-pro-t2v-fast","doubao-seedance-pro-fast","doubao-seedance-1-0-pro-fast-251015"],
    name: 'Seedance Pro T2V Fast',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4', '21:9',
      ]),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p', '1080p'], '480p'),
    },
  },
  // 4
  {
    id: 'seedance-v1.5-pro-t2v',
    providerAliases: ["seedance-v1.5-pro-t2v","doubao-seedance-1-5-pro-250428","doubao-seedance-1-5-pro-251215"],
    name: 'Seedance V1.5 Pro T2V',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '3:4', '4:3', '21:9',
      ]),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p', '1080p'], '720p'),
    },
  },
  // 5
  {
    id: 'seedance-v1.5-pro-t2v-fast',
    providerAliases: ["seedance-v1.5-pro-t2v-fast","doubao-seedance-1-5-pro-fast"],
    name: 'Seedance V1.5 Pro T2V Fast',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '3:4', '4:3', '21:9',
      ]),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['720p', '1080p'], '720p'),
    },
  },
  // 6
  {
    id: 'kling-v2.1-master-t2v',
    providerAliases: ["kling-v2.1-master-t2v","kling-v2-1-master"],
    name: 'Kling V2.1 Master T2V',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
      duration: durationInput({ default: 5 }),
    },
  },
  // 7
  {
    id: 'kling-v2.5-turbo-pro-t2v',
    providerAliases: ["kling-v2.5-turbo-pro-t2v","kling-v2-5-turbo-pro"],
    name: 'Kling V2.5 Turbo Pro T2V',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1'], '9:16'),
      duration: durationInput({ default: 5 }),
    },
  },
  // 8
  {
    id: 'kling-v2.6-pro-t2v',
    providerAliases: ["kling-v2.6-pro-t2v","kling-v2-6-pro","kling-video","kling-video-extend","kling-motion-control","kling-multi-elements","kling-avatar-image2video","kling-advanced-lip-sync","kling-effects","kling-v1","kling-v1-5","kling-v1-6","kling-v2-master","kling-v2-1","kling-v2-5-turbo","kling-v2-6"],
    name: 'Kling V2.6 Pro T2V',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
      duration: durationInput({ enum: [5, 10] }),
    },
  },
  // 9
  {
    id: 'kling-o1-text-to-video',
    providerAliases: ["kling-o1-text-to-video","kling-o1-video","kling-omni-video"],
    name: 'Kling O1 Text to Video',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
      duration: durationInput({ enum: [5, 10] }),
    },
  },
  // 10
  {
    id: 'kling-v3.0-pro-text-to-video',
    providerAliases: ["kling-v3.0-pro-text-to-video","kling-v3-0-pro"],
    name: 'Kling V3.0 Pro Text to Video',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
      duration: durationInput({ default: 5 }),
    },
  },
  // 11
  {
    id: 'kling-v3.0-standard-text-to-video',
    providerAliases: ["kling-v3.0-standard-text-to-video","kling-v3-0-standard"],
    name: 'Kling V3.0 Standard Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
      duration: durationInput({ default: 5 }),
    },
  },
  // 12
  {
    id: 'veo3-text-to-video',
    providerAliases: ["veo3-text-to-video","veo3","veo3-pro","veo3-frames","veo3-fast-frames","veo3-pro-frames"],
    name: 'Veo 3 Text to Video',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
    },
  },
  // 13
  {
    id: 'veo3-fast-text-to-video',
    providerAliases: ["veo3-fast-text-to-video","veo3-fast"],
    name: 'Veo 3 Fast Text to Video',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
    },
  },
  // 14
  {
    id: 'veo3.1-text-to-video',
    providerAliases: ["veo3.1-text-to-video","veo3.1","veo3.1-pro","veo3.1-4k","veo3.1-pro-4k","veo_3_1","veo_3_1-4K","veo3.1-components","veo3.1-fast-components","veo3.1-components-4k","veo_3_1-components","veo_3_1-components-4K","veo_3_1-fast-components-4K"],
    name: 'Veo 3.1 Text to Video',
    category: 'latest',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ enum: [8] }),
      resolution: resolutionInput(['1080p']),
    },
  },
  // 15
  {
    id: 'veo3.1-fast-text-to-video',
    providerAliases: ["veo3.1-fast-text-to-video","veo3.1-fast","veo_3_1-fast","veo_3_1-fast-4K"],
    name: 'Veo 3.1 Fast Text to Video',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ enum: [8] }),
      resolution: resolutionInput(['1080p']),
    },
  },
  // 15.5 (Veo 2)
  {
    id: 'veo2-text-to-video',
    providerAliases: ["veo2-text-to-video","veo2","veo2-fast","veo2-fast-frames","veo2-fast-components","veo2-pro","veo2-pro-components"],
    name: 'Veo 2 Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
    },
  },
  // 16
  {
    id: 'runway-text-to-video',
    providerAliases: ["runway-text-to-video","runway-gen3","runway-gen-3","runwayml-gen3a_turbo-10","runwayml-gen3a_turbo-5","runwayml-gen4_turbo-10","runwayml-gen4_turbo-5"],
    name: 'Runway Text to Video',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4',
      ]),
      duration: durationInput({ enum: [5, 8] }),
      resolution: resolutionInput(['720p', '1080p']),
    },
  },
  // 17
  {
    id: 'wan2.1-text-to-video',
    providerAliases: ["wan2.1-text-to-video","wan2.1-t2v"],
    name: 'Wan 2.1 Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p']),
      quality: {
        type: 'string',
        enum: ['medium', 'high'],
        description: 'Video quality level',
      },
    },
  },
  // 18
  {
    id: 'wan2.2-text-to-video',
    providerAliases: ["wan2.2-text-to-video","wan2.2-t2v"],
    name: 'Wan 2.2 Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p']),
      quality: {
        type: 'string',
        enum: ['medium', 'high'],
        description: 'Video quality level',
      },
    },
  },
  // 19
  {
    id: 'wan2.2-5b-fast-t2v',
    providerAliases: ["wan2.2-5b-fast-t2v"],
    name: 'Wan 2.2 5B Fast T2V',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
      resolution: resolutionInput(['480p', '580p', '720p']),
    },
  },
  // 20
  {
    id: 'wan2.5-text-to-video',
    providerAliases: ["wan2.5-text-to-video","wan2.5-t2v","wan2.5-i2v-preview"],
    name: 'Wan 2.5 Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p', '1080p']),
    },
  },
  // 21
  {
    id: 'wan2.5-text-to-video-fast',
    providerAliases: ["wan2.5-text-to-video-fast"],
    name: 'Wan 2.5 Text to Video Fast',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['720p', '1080p']),
    },
  },
  // 22
  {
    id: 'wan2.6-text-to-video',
    providerAliases: ["wan2.6-text-to-video","wan2.6-t2v","wan2.6-i2v","wan2.6-i2v-flash"],
    name: 'Wan 2.6 Text to Video',
    category: 'latest',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ enum: [5, 10, 15] }),
      resolution: resolutionInput(['720p', '1080p']),
    },
  },
  // 23
  {
    id: 'hunyuan-text-to-video',
    providerAliases: ["hunyuan-text-to-video","hunyuan-video"],
    name: 'Hunyuan Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
    },
  },
  // 24
  {
    id: 'hunyuan-fast-text-to-video',
    providerAliases: ["hunyuan-fast-text-to-video","hunyuan-video-fast"],
    name: 'Hunyuan Fast Text to Video',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
    },
  },
  // 25
  {
    id: 'pixverse-v4.5-t2v',
    providerAliases: ["pixverse-v4.5-t2v","pixverse-v4-5"],
    name: 'PixVerse V4.5 T2V',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4',
      ]),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['360p', '540p', '720p', '1080p']),
    },
  },
  // 26
  {
    id: 'pixverse-v5-t2v',
    providerAliases: ["pixverse-v5-t2v","pixverse-v5"],
    name: 'PixVerse V5 T2V',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4',
      ]),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['360p', '540p', '720p', '1080p']),
    },
  },
  // 27
  {
    id: 'pixverse-v5.5-t2v',
    providerAliases: ["pixverse-v5.5-t2v","pixverse-v5-5"],
    name: 'PixVerse V5.5 T2V',
    category: 'latest',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '16:9', '9:16', '1:1', '4:3', '3:4',
      ]),
      duration: durationInput({ enum: [5, 8, 10] }),
      resolution: resolutionInput(['360p', '540p', '720p', '1080p']),
    },
  },
  // 28
  {
    id: 'minimax-hailuo-02-standard-t2v',
    providerAliases: ["minimax-hailuo-02-standard-t2v","hailuo-02-standard","MiniMax-Hailuo-02","aigc-video-hailuo"],
    name: 'MiniMax Hailuo 02 Standard T2V',
    inputs: {
      prompt: promptInput(),
      duration: durationInput({ enum: [6, 10] }),
      resolution: resolutionInput(['768P']),
    },
  },
  // 29
  {
    id: 'minimax-hailuo-02-pro-t2v',
    providerAliases: ["minimax-hailuo-02-pro-t2v","hailuo-02-pro"],
    name: 'MiniMax Hailuo 02 Pro T2V',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      duration: durationInput({ enum: [6] }),
      resolution: resolutionInput(['1080P']),
    },
  },
  // 30
  {
    id: 'minimax-hailuo-2.3-pro-t2v',
    providerAliases: ["minimax-hailuo-2.3-pro-t2v","hailuo-2-3-pro"],
    name: 'MiniMax Hailuo 2.3 Pro T2V',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      resolution: resolutionInput(['1080p']),
    },
  },
  // 31
  {
    id: 'minimax-hailuo-2.3-standard-t2v',
    providerAliases: ["minimax-hailuo-2.3-standard-t2v","hailuo-2-3-standard","MiniMax-Hailuo-2.3","MiniMax-Hailuo-2.3-Fast"],
    name: 'MiniMax Hailuo 2.3 Standard T2V',
    inputs: {
      prompt: promptInput(),
      duration: durationInput({ enum: [6, 10] }),
    },
  },
  // 32
  {
    id: 'openai-sora',
    providerAliases: ["openai-sora","sora","sora_image"],
    name: 'OpenAI Sora',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
      resolution: resolutionInput(['480p', '720p', '1080p']),
    },
  },
  // 33
  {
    id: 'openai-sora-2-text-to-video',
    providerAliases: ["openai-sora-2-text-to-video","sora-2-all","sora-2","sora-2-vip-all"],
    name: 'OpenAI Sora 2 Text to Video',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ enum: [10, 15] }),
    },
  },
  // 34
  {
    id: 'openai-sora-2-pro-text-to-video',
    providerAliases: ["openai-sora-2-pro-text-to-video","sora-2-pro","sora-2-pro-all"],
    name: 'OpenAI Sora 2 Pro Text to Video',
    category: 'premium',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ enum: [10, 15, 25] }),
      resolution: resolutionInput(['720p', '1080p']),
    },
  },
  // 35
  {
    id: 'vidu-v2.0-t2v',
    providerAliases: ["vidu-v2.0-t2v","vidu-v2-0","vidu2.0","viduq1","viduq1-classic","aigc-video-vidu"],
    name: 'Vidu V2.0 T2V',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['9:16']),
      duration: durationInput({ enum: [4] }),
      resolution: resolutionInput(['1080p']),
    },
  },
  // 36
  {
    id: 'ovi-text-to-video',
    providerAliases: ["ovi-text-to-video","ovi-video"],
    name: 'Ovi Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
    },
  },
  // 37
  {
    id: 'grok-imagine-text-to-video',
    providerAliases: ["grok-imagine-text-to-video","grok-video-3","grok-video-3-10s","grok-video-3-15s"],
    name: 'Grok Imagine Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput([
        '9:16', '16:9', '2:3', '3:2', '1:1',
      ]),
      duration: durationInput({ enum: [6, 10, 15] }),
    },
  },
  // 38
  {
    id: 'ltx-2-pro-text-to-video',
    providerAliases: ["ltx-2-pro-text-to-video","ltx-video-pro"],
    name: 'LTX 2 Pro Text to Video',
    inputs: {
      prompt: promptInput(),
      duration: durationInput({ enum: [6, 8, 10] }),
    },
  },
  // 39
  {
    id: 'ltx-2-fast-text-to-video',
    providerAliases: ["ltx-2-fast-text-to-video","ltx-video-fast"],
    name: 'LTX 2 Fast Text to Video',
    category: 'fast',
    inputs: {
      prompt: promptInput(),
      duration: durationInput({ enum: [6, 8, 10, 12, 14, 16, 18, 20] }),
    },
  },
  // 40
  {
    id: 'ltx-2-19b-text-to-video',
    providerAliases: ["ltx-2-19b-text-to-video","ltx-video-19b"],
    name: 'LTX 2 19B Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16']),
      duration: durationInput({ default: 5 }),
      resolution: resolutionInput(['480p', '720p', '1080p']),
    },
  },
  // 41
  {
    id: 'luma-text-to-video',
    providerAliases: ["luma-text-to-video","luma_video_api","luma_video_extend_api","luma-video","luma-video-ray2","luma-video-ray2-flash"],
    name: 'Luma Text to Video',
    inputs: {
      prompt: promptInput(),
      aspect_ratio: aspectRatioInput(['16:9', '9:16', '1:1']),
    },
  },
  // 42
  {
    id: 'minimax-video-01',
    providerAliases: ["minimax-video-01","minimax/video-01","minimax/video-01-live"],
    name: 'MiniMax Video-01',
    inputs: {
      prompt: promptInput(),
      duration: durationInput({ enum: [6, 10] }),
      resolution: resolutionInput(['768P']),
    },
  },
];

// ---------------------------------------------------------------------------
// §5  Lookup indices (built once at module load for O(1) access)
// ---------------------------------------------------------------------------

const t2iIndex = new Map<string, T2IModel>(
  T2I_MODELS.map((m) => [m.id, m]),
);

const t2vIndex = new Map<string, T2VModel>(
  T2V_MODELS.map((m) => [m.id, m]),
);

// ---------------------------------------------------------------------------
// §6  Helper / Query Functions
// ---------------------------------------------------------------------------

/** Retrieve a T2I model by its unique id. */
export function getT2IModelById(id: string): T2IModel | undefined {
  return t2iIndex.get(id) ?? t2iAliasIndex.get(id);
}

/** Retrieve a T2V model by its unique id. */
export function getT2VModelById(id: string): T2VModel | undefined {
  return t2vIndex.get(id) ?? t2vAliasIndex.get(id);
}

/** Return the supported aspect-ratio strings for a T2I model, or [] if none. */
export function getAspectRatiosForT2IModel(modelId: string): string[] {
  const model = t2iIndex.get(modelId) ?? t2iAliasIndex.get(modelId);
  if (!model) return [];
  const ar = model.inputs['aspect_ratio'];
  return (ar?.enum as string[] | undefined) ?? [];
}

/** Return the supported aspect-ratio strings for a T2V model, or [] if none. */
export function getAspectRatiosForT2VModel(modelId: string): string[] {
  const model = t2vIndex.get(modelId) ?? t2vAliasIndex.get(modelId);
  if (!model) return [];
  const ar = model.inputs['aspect_ratio'];
  return (ar?.enum as string[] | undefined) ?? [];
}

/** Return the supported duration values (in seconds) for a T2V model. */
export function getDurationsForModel(modelId: string): number[] {
  const model = t2vIndex.get(modelId) ?? t2vAliasIndex.get(modelId);
  if (!model) return [];
  const dur = model.inputs['duration'];
  if (!dur) return [];
  if (dur.enum) return dur.enum as number[];
  if (dur.default !== undefined) return [dur.default as number];
  return [];
}

/** Return the supported resolution strings for a T2V model. */
export function getResolutionsForModel(modelId: string): string[] {
  // Check T2V first, then T2I (some T2I models also have resolution)
  const model = t2vIndex.get(modelId) ?? t2vAliasIndex.get(modelId) ?? t2iIndex.get(modelId) ?? t2iAliasIndex.get(modelId);
  if (!model) return [];
  const res = model.inputs['resolution'];
  return (res?.enum as string[] | undefined) ?? [];
}

/** Return all registered T2I models. */
export function getAllT2IModels(): T2IModel[] {
  return T2I_MODELS;
}

/** Return all registered T2V models. */
export function getAllT2VModels(): T2VModel[] {
  return T2V_MODELS;
}

// ---------------------------------------------------------------------------
// §7  Provider Alias Resolution (bridge registry ↔ provider model IDs)
// ---------------------------------------------------------------------------

/** Build a reverse index: registryId/alias → registry model (O(1) lookup) */
function buildAliasIndex<T extends BaseModel>(models: T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const m of models) {
    index.set(m.id, m);
    for (const alias of m.providerAliases ?? []) {
      index.set(alias, m);
    }
  }
  return index;
}

const t2iAliasIndex = buildAliasIndex(T2I_MODELS);
const t2vAliasIndex = buildAliasIndex(T2V_MODELS);

/** Resolve a provider model ID to its registry T2I model definition. */
export function resolveT2IModel(providerModelId: string): T2IModel | undefined {
  return t2iAliasIndex.get(providerModelId);
}

/** Resolve a provider model ID to its registry T2V model definition. */
export function resolveT2VModel(providerModelId: string): T2VModel | undefined {
  return t2vAliasIndex.get(providerModelId);
}

/** Get the preferred provider model ID for API calls (first alias, or id as fallback). */
export function getProviderModelId(model: BaseModel): string {
  return model.providerAliases?.[0] ?? model.id;
}
