import type { T2IModel } from "./model-registry-types";
import { promptInput, widthHeightInputs, aspectRatioInput, numImagesInput, resolutionInput } from "./model-registry-inputs";

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
