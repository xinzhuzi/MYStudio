import type { T2VModel } from "./model-registry-types";
import { promptInput, aspectRatioInput, durationInput, resolutionInput } from "./model-registry-inputs";

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
