// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import {
  classifyModelDomains,
  displayModelCategory,
  groupModelsByDomain,
  modelFileNote,
} from "@/components/panels/settings/comfy-engine/comfy-models/comfy-models-taxonomy";
import type { ComfyModelsReply } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

describe("comfy-models 域分类法(09-10 分域裁定)", () => {
  it("真实库存全件归属:各产线家族各归其域", () => {
    expect(classifyModelDomains("diffusion_models", "krea2_turbo_bf16.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("diffusion_models", "minimax_h3_fl2va_pruned_bf16.safetensors")).toEqual(["video"]);
    // 文件名带空格的 Krea 2 LoRA(子目录形态)
    expect(classifyModelDomains("loras", "Krea2-NSFW/Krea 2 pussy.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("loras", "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors")).toEqual(["video"]);
    // 文本编码器分家:4B 破限归 K2(图片),32B Heretic-H3 归 H3(视频)(Music3 TE 已随权重隔离退役,09-20 移除断言)
    expect(classifyModelDomains("text_encoders", "qwen3-vl-4b-heretic.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("text_encoders", "Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M.gguf")).toEqual(["video"]);
    // VAE 分家:qwen_image 归图片;H3 视频/音频 VAE 归视频(Music3 dav 已随权重隔离退役,09-20 移除断言)
    expect(classifyModelDomains("vae", "qwen_image_vae.safetensors")).toEqual(["image"]);
    expect(classifyModelDomains("vae", "minimax_h3_video_vae_fp16.safetensors")).toEqual(["video"]);
    expect(classifyModelDomains("vae", "minimax_h3_audio_vae_fp32.safetensors")).toEqual(["video"]);
    // 类别整域归属:TTS 家→声音;vlm→图片;videoqc/补帧→视频
    expect(classifyModelDomains("TTS", "models--Qwen--Qwen3-TTS-12Hz-1.7B-CustomVoice/refs/main")).toEqual(["audio"]);
    expect(classifyModelDomains("TTS", "models--mlx-community--whisper-large-v3-turbo/refs/main")).toEqual(["audio"]);
    // YuE2 作曲家(09-20 接入):三件全部归 audio 域
    expect(classifyModelDomains("checkpoints", "yue2_3b_bf16.safetensors")).toEqual(["audio"]);
    expect(classifyModelDomains("audio_encoders", "sheetsage2_bf16.safetensors")).toEqual(["audio"]);
    expect(classifyModelDomains("loras", "ar_lora_inst_v3abc_comfyui.safetensors")).toEqual(["audio"]);
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

  // 09-24 用户裁定「分类是 vl 类型下的」:qwen3vl_8b 两件(官方+heretic)展示归 vlm 类别
  it("VL 改道:text_encoders 下的 qwen3vl_8b 两件展示归 vlm 类别,其余 TE 与其它类别不动", () => {
    expect(displayModelCategory("text_encoders", "qwen3vl_8b_bf16.safetensors")).toBe("vlm");
    expect(displayModelCategory("text_encoders", "qwen3vl_8b_bf16_heretic.safetensors")).toBe("vlm");
    // 同类别其它 TE 不改道(Q2-1 PE 件/32B H3 件留 text_encoders)
    expect(displayModelCategory("text_encoders", "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors")).toBe("text_encoders");
    expect(displayModelCategory("text_encoders", "Qwen3-VL-32B-Ultra-Heretic-H3-L0-49-Q4_K_M.gguf")).toBe("text_encoders");
    // 非目标类别不改道(viggle LoRA 照旧 loras)
    expect(displayModelCategory("loras", "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors")).toBe("loras");
  });

  it("VL 改道分组:两件并入图片域 vlm 类别桶与同族 mlx 件同列,域归属仍按磁盘真类别判定", () => {
    const reply: ComfyModelsReply = {
      modelsDir: "/tmp/models",
      totalBytes: 400,
      groups: [
        {
          category: "text_encoders",
          files: [
            { name: "qwen3vl_8b_bf16.safetensors", sizeBytes: 100 },
            { name: "qwen3vl_8b_bf16_heretic.safetensors", sizeBytes: 100 },
            { name: "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors", sizeBytes: 100 },
          ],
        },
        { category: "vlm", files: [{ name: "qwen3-vl-8b-instruct-mlx-8bit/model.safetensors", sizeBytes: 100 }] },
      ],
    };
    const domains = groupModelsByDomain(reply);
    expect(domains.map((group) => group.domain)).toEqual(["image"]);
    const categories = domains[0].categories.map((item) => item.category).sort();
    expect(categories).toEqual(["text_encoders", "vlm"]);
    const vlm = domains[0].categories.find((item) => item.category === "vlm");
    // 桶内为清单遍历插入序:text_encoders 组的两件先入,mlx 件随后
    expect(vlm?.files.map((file) => file.name)).toEqual([
      "qwen3vl_8b_bf16.safetensors",
      "qwen3vl_8b_bf16_heretic.safetensors",
      "qwen3-vl-8b-instruct-mlx-8bit/model.safetensors",
    ]);
    expect(vlm?.bytes).toBe(300);
    const te = domains[0].categories.find((item) => item.category === "text_encoders");
    expect(te?.files.map((file) => file.name)).toEqual(["qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"]);
  });

  it("VL 件级注释:官方/heretic 两件各命中(heretic 带破限标记,先中先用不串)", () => {
    expect(modelFileNote("qwen3vl_8b_bf16.safetensors")).toContain("Q2-1 文本编码器(视觉语言模型");
    expect(modelFileNote("qwen3vl_8b_bf16_heretic.safetensors")).toContain("破限版");
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

// 09-24 迁入:viggle 加速包件级注释(LoRA 态的唯一展示位=模型库行内注释)
it("viggle 加速包件级注释:任意 viggle-turbo 件名命中,文案交代画布用法", () => {
  const note = modelFileNote("Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors");
  expect(note).toContain("加速包");
  expect(note).toContain("LoRA 开关");
  expect(modelFileNote("Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors")).toContain("加速包");
});
