// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/** Supported image/video endpoint formats exposed by provider metadata. */

// ==================== Endpoint Routing ====================

/**
 * 模型 API 调用格式
 * 基于 MemeFast 等平台 /v1/models 返回的 supported_endpoint_types 字段
 */
export type ModelApiFormat =
  | 'openai_chat'        // /v1/chat/completions （文本/对话，也用于 Gemini 图片生成）
  | 'openai_images'      // /v1/images/generations （标准图片生成）
  | 'openai_video'       // /v1/videos/generations （标准视频生成）
  | 'kling_image'        // /kling/v1/images/generations 或 /kling/v1/images/omni-image
  | 'unsupported';       // 不支持的端点格式

// MemeFast supported_endpoint_types 值 → 我们的图片 API 格式
const IMAGE_ENDPOINT_MAP: Record<string, ModelApiFormat> = {
  'image-generation': 'openai_images',
  'dall-e-3': 'openai_images',  // z-image-turbo, qwen-image-max 等走 /v1/images/generations
  'aigc-image': 'openai_images', // aigc-image-gem, aigc-image-qwen
  'gpt-image-2': 'openai_images', // gpt-image-2 走 /v1/images/generations
  'openai': 'openai_chat',  // 如 gpt-image-1-all 通过 chat completions 生图
};

// MemeFast supported_endpoint_types 值 → 我们的视频 API 格式能力分类
// 注意：这里统一映射为 'openai_video' 仅表示「视频生成能力」，实际 API 路由由 video-generator.ts 中的 VIDEO_FORMAT_MAP 决定
const VIDEO_ENDPOINT_MAP: Record<string, ModelApiFormat> = {
  '视频统一格式': 'openai_video',
  'openAI视频格式': 'openai_video',
  'openAI官方视频格式': 'openai_video',
  '异步': 'openai_video',            // wan 系列
  '豆包视频异步': 'openai_video',    // doubao-seedance 系列
  'grok视频': 'openai_video',          // grok-video
  '文生视频': 'openai_video',          // kling 文生视频
  '图生视频': 'openai_video',          // kling 图生视频
  '视频延长': 'openai_video',          // kling 视频延长
  '海螺视频生成': 'openai_video',    // MiniMax-Hailuo
  'luma视频生成': 'openai_video',     // luma_video_api
  'luma视频扩展': 'openai_video',     // luma_video_extend
  'runway图生视频': 'openai_video',   // runwayml
  'aigc-video': 'openai_video',       // aigc-video-hailuo/kling/vidu
  'minimax/video-01异步': 'openai_video', // minimax/video-01
  'openai-response': 'openai_video',  // veo3-pro 等
};

/**
 * 根据模型的 supported_endpoint_types 确定图片生成应用的 API 格式
 * 当端点元数据不可用时，根据模型名称推断
 */
export function resolveImageApiFormat(endpointTypes: string[] | undefined, modelName?: string): ModelApiFormat {
  // 1. 使用 API 返回的端点元数据
  if (endpointTypes && endpointTypes.length > 0) {
    // gpt-image 系列强制走 images/generations（即使 endpointTypes 标记为 openai）
    if (modelName && /gpt-image/i.test(modelName)) return 'openai_images';
    // 优先使用 image-generation 端点
    for (const t of endpointTypes) {
      if (IMAGE_ENDPOINT_MAP[t] === 'openai_images') return 'openai_images';
    }
    // 其次尝试 chat completions （Gemini 多模态图片）
    for (const t of endpointTypes) {
      if (IMAGE_ENDPOINT_MAP[t] === 'openai_chat') return 'openai_chat';
    }
    return 'unsupported';
  }

  // 2. Fallback: 根据模型名称推断 API 格式
  if (modelName) {
    const name = modelName.toLowerCase();
    // Kling image models → native /kling/v1/images/* endpoint
    if (/^kling-(image|omni-image)$/i.test(name)) {
      return 'kling_image';
    }
    // Gemini image models → chat completions 多模态
    if (name.includes('gemini') && (name.includes('image') || name.includes('imagen'))) {
      return 'openai_chat';
    }
    // GPT image, flux, dall-e, ideogram, sd, recraft → standard images API
    if (/gpt-image|flux|dall-e|dalle|ideogram|stable-diffusion|sdxl|sd3|recraft|kolors|cogview/.test(name)) {
      return 'openai_images';
    }
    // sora_image → openai chat
    if (name.includes('sora') && name.includes('image')) {
      return 'openai_chat';
    }
  }

  return 'openai_images'; // ultimate fallback
}

/**
 * 根据模型的 supported_endpoint_types 确定视频生成应用的 API 格式
 */
export function resolveVideoApiFormat(endpointTypes: string[] | undefined): ModelApiFormat {
  if (!endpointTypes || endpointTypes.length === 0) return 'openai_video'; // fallback
  for (const t of endpointTypes) {
    const mapped = VIDEO_ENDPOINT_MAP[t];
    if (mapped) return mapped;
  }
  // 如果有 openai 类型，也试用视频端点
  if (endpointTypes.includes('openai')) return 'openai_video';
  return 'unsupported';
}

