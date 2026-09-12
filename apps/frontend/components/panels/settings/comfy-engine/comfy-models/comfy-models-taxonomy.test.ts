// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import {
  classifyModelDomains,
  groupModelsByDomain,
} from "@/components/panels/settings/comfy-engine/comfy-models/comfy-models-taxonomy";
import type { ComfyModelsReply } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

describe("comfy-models 域分类法(09-10 分域裁定)", () => {
  it("真实库存全件归属:各产线家族各归其域", () => {
    expect(classifyModelDomains("diffusion_models", "krea2_turbo_bf16.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("diffusion_models", "minimax_h3_fl2va_pruned_bf16.safetensors")).toEqual(["video"]);
    expect(classifyModelDomains("diffusion_models", "minimax_music3_dit_fp16.safetensors")).toEqual(["audio"]);
    // 文件名带空格的 Krea 2 LoRA(子目录形态)
    expect(classifyModelDomains("loras", "Krea2-NSFW/Krea 2 pussy.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("loras", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors")).toEqual(["video"]);
    // 文本编码器分家:4B 破限归 K2(图片),32B Heretic-H3 归 H3(视频),Music3 归声音
    expect(classifyModelDomains("text_encoders", "qwen3-vl-4b-heretic.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("text_encoders", "Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M.gguf")).toEqual(["video"]);
    expect(classifyModelDomains("text_encoders", "minimax_music3_text_encoder_pruned_bf16.safetensors")).toEqual(["audio"]);
    // VAE 分家:qwen_image 归图片;H3 视频/音频 VAE 归视频;Music3 dav 归声音
    expect(classifyModelDomains("vae", "qwen_image_vae.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("vae", "minimax_h3_video_vae_fp16.safetensors")).toEqual(["video"]);
    expect(classifyModelDomains("vae", "minimax_h3_audio_vae_fp32.safetensors")).toEqual(["video"]);
    expect(classifyModelDomains("vae", "minimax_music3_dav.safetensors")).toEqual(["audio"]);
    // 类别整域归属:TTS 家→声音;vlm→图片;videoqc/补帧→视频
    expect(classifyModelDomains("TTS", "models--Qwen--Qwen3-TTS-12Hz-1.7B-CustomVoice/refs/main")).toEqual(["audio"]);
    expect(classifyModelDomains("TTS", "models--mlx-community--whisper-large-v3-turbo/refs/main")).toEqual(["audio"]);
    expect(classifyModelDomains("vlm", "qwen3-vl-8b-instruct-mlx-8bit/model.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("videoqc", "baselines.json")).toEqual(["video"]);
    expect(classifyModelDomains("frame_interpolation", "rife_v4.26.safetensors")).toEqual(["video"]);
    expect(classifyModelDomains("upscale_models", "RealESRGAN_x4plus_anime_6B.pth")).toEqual(["image"]);
    expect(classifyModelDomains("vae_approx", "taeh3.safetensors")).toEqual(["video"]);
  });

  it("多重分类:SEEDVR2 同时归图片与视频(图像修复超分+H3 2K 视频超分)", () => {
    expect(classifyModelDomains("SEEDVR2", "seedvr2_7b_sharp_fp8_e4m3fn.safetensors")).toEqual(["image", "video"]);
    expect(classifyModelDomains("SEEDVR2", "ema_vae_fp16.safetensors")).toEqual(["image", "video"]);
  });

  it("零命中兜底:未归类→other(规则漏配的可见信号)", () => {
    expect(classifyModelDomains("checkpoints", "some_random_model.safetensors")).toEqual(["other"]);
  });

  it("分域分组:域序稳定/空域不出现/双栖件在两域各计一件/统计聚合正确", () => {
    const reply: ComfyModelsReply = {
      modelsDir: "/tmp/models",
      totalBytes: 300,
      groups: [
        {
          category: "SEEDVR2",
          files: [
            { name: "seedvr2_7b_sharp_fp8_e4m3fn.safetensors", sizeBytes: 100 },
            { name: "ema_vae_fp16.safetensors", sizeBytes: 50 },
          ],
        },
        { category: "diffusion_models", files: [{ name: "krea2_turbo_bf16.safetensors", sizeBytes: 150 }] },
      ],
    };
    const domains = groupModelsByDomain(reply);
    expect(domains.map((group) => group.domain)).toEqual(["image", "video"]);
    const image = domains[0];
    expect(image.label).toBe("图片");
    expect(image.fileCount).toBe(3); // krea2 + SEEDVR2×2(双栖重复计入)
    expect(image.bytes).toBe(300);
    expect(image.categories.map((item) => item.category).sort()).toEqual(["SEEDVR2", "diffusion_models"]);
    const video = domains[1];
    expect(video.fileCount).toBe(2);
    expect(video.bytes).toBe(150);
  });

  it("空清单:零域组不炸", () => {
    expect(groupModelsByDomain({ modelsDir: "/tmp", groups: [], totalBytes: 0 })).toEqual([]);
  });
});
