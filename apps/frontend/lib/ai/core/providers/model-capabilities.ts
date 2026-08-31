// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { ModelCapability } from "./types";

/** Infer model capabilities from the provider model identifier. */

export function classifyModelByName(modelName: string): ModelCapability[] {
  const name = modelName.toLowerCase();

  const videoPatterns = [
    "veo", "sora", "wan", "kling", "runway", "luma", "seedance",
    "cogvideo", "hunyuan-video", "minimax-video", "hailuo", "pika",
    "gen-3", "gen3", "mochi", "ltx",
  ];
  if (/grok[- ]?video/.test(name)) return ["video_generation"];
  if (videoPatterns.some((pattern) => name.includes(pattern))) return ["video_generation"];

  const imageGenPatterns = [
    "dall-e", "dalle", "flux", "midjourney", "niji", "imagen", "cogview",
    "gpt-image", "ideogram", "sd3", "stable-diffusion", "sdxl",
    "playground", "recraft", "kolors", "seedream", "agnes-image", "grok-imagine-image",
    "krea2", "comfyui-bridge", "z-image", "qwen-image", "glm-image",
  ];
  if (imageGenPatterns.some((pattern) => name.includes(pattern))) return ["image_generation"];
  if (/image[- ]?preview/.test(name)) return ["image_generation"];

  if (/vision|qwen.*vl|glm.*v|doubao.*vision/.test(name)) return ["text", "vision"];
  if (/^gpt-4o/.test(name) || /^gpt-4\.1/.test(name) || /^gpt-5/.test(name)) return ["text", "vision"];
  if (/claude|gemini/.test(name) && !/imagen|image[-_ ]?preview/.test(name)) return ["text", "vision"];

  if (/tts|voice|speech|kokoro|chatterbox|luxtts|tada/.test(name)) return ["tts"];
  if (/whisper|audio/.test(name)) return ["text"];
  if (/embed/.test(name)) return ["embedding"];
  if (/[- ](r1|thinking|reasoner|reason)/.test(name) || /^o[1-9]/.test(name)) return ["text", "reasoning"];

  return ["text"];
}
