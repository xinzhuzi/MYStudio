// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 模型库域分类法(09-10 用户裁定:模型页按图片/视频/声音分域,
 * 多重分类分组——一件模型可同时属多个域;规则贴着 41.8G 统一家的真实
 * 库存设计)。纯函数零 React,数据形状=引擎契约 ComfyModelsReply。
 */

import type { ComfyModelsEntry, ComfyModelsReply } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

export type ComfyModelDomain = "image" | "video" | "audio" | "other";

/** 域展示顺序=用户列举顺序(图片/视频/声音),兜底「其他」殿后 */
export const DOMAIN_ORDER: readonly ComfyModelDomain[] = ["image", "video", "audio", "other"] as const;

export const DOMAIN_LABELS: Record<ComfyModelDomain, string> = {
  image: "图片",
  video: "视频",
  audio: "声音",
  other: "其他",
};

/** 域一句话注释(域组头展示,单行截断铁律) */
export const DOMAIN_INFO: Record<ComfyModelDomain, string> = {
  image: "生图画布相关——K2 产线主模型/LoRA/超分/分割/视觉理解",
  video: "H3 视频产线全家——主模型/编码器/VAE/补帧/超分/质检",
  audio: "配音与作曲——TTS 引擎家与音乐生成权重(Music3 已隔离退役)",
  other: "未命中分类规则的模型——建议补 comfy-models-taxonomy 规则",
};

/**
 * 域归属规则:对「类别/类别内相对路径」全串小写匹配,命中即并入该规则的
 * 域集合;多规则可叠加(SEEDVR2=图片+视频双栖)。零命中→other。
 * 顺序无关(累积式),新增模型家族往表里加一行即可。
 */
const DOMAIN_RULES: ReadonlyArray<{ match: RegExp; domains: readonly ComfyModelDomain[] }> = [
  // 视频线:H3 全家(主模型/TE/mmproj/VAE/潜放/预览VAE)+ 补帧 + 质检
  { match: /minimax_h3|heretic-h3|taeh3|latent_upscaler|^videoqc\/|^frame_interpolation\/|rife_|dover_mobile/i, domains: ["video"] },
  // 声音线:TTS 家(Qwen3-TTS/SenseVoice/whisper/musicgen/嵌入与分词);Music3 已隔离退役(09-20 出规则)
  { match: /musicgen|qwen3-tts|sensevoice|whisper|snac_|gte-multilingual|^tts\//i, domains: ["audio"] },
  // 图片线:K2 产线(krea2/Krea 2)+ Qwen 图像 + 图像超分 + 服装分割 + 视觉理解
  { match: /krea\s*2|qwen_image|realesrgan|^segformer|^vlm\/|qwen3-vl-4b/i, domains: ["image"] },
  // 双栖:SEEDVR2 图像修复超分 + H3 视频超分(2K 链)——多重分类的活例
  { match: /seedvr2/i, domains: ["image", "video"] },
];

export function classifyModelDomains(category: string, name: string): ComfyModelDomain[] {
  const path = `${category}/${name}`.toLowerCase();
  const hits = new Set<ComfyModelDomain>();
  for (const rule of DOMAIN_RULES) {
    if (rule.match.test(path)) rule.domains.forEach((domain) => hits.add(domain));
  }
  if (hits.size === 0) return ["other"];
  return DOMAIN_ORDER.filter((domain) => hits.has(domain));
}

// ── 注释体系(自 ComfyEngineSettingsSection 迁入,单源) ────────────────

/** 模型类别一句话注释:干什么用、属于哪条工作流(09-10 用户裁定:简明概要)。 */
export const COMFY_MODEL_CATEGORY_INFO: Record<string, string> = {
  diffusion_models: "生图/作曲/视频的主模型(去噪网络)——画布各类生成流的核心",
  text_encoders: "提示词理解(文本编码器)——生成流的输入侧",
  vae: "潜空间↔成品解码器(图像像素/音频波形)",
  loras: "主模型的能力补丁(风格/破限/编辑)——生图画布按流挂载",
  TTS: "旁白配音引擎(声线权重+音色库)——配音室/分镜配音",
  vlm: "视觉审核模型——分镜图与资产参考一致性检查",
  upscale_models: "ComfyUI 超分模型目录——画布超分节点用",
  videoqc: "DOVER 视频评分——出片自评与基线告警",
  SEEDVR2: "图像修复+超分(强档)——生图修复链与视频 2K 超分(跨图片/视频两域)",
  segformer_b3_clothes: "服装/人体分割——ComfyUI 图层类节点",
  frame_interpolation: "补帧(RIFE)——视频流畅度",
  latent_upscale_models: "潜空间放大——H3 视频链",
  clip: "图文对齐编码——参考图/构图控制类节点",
  clip_vision: "视觉编码——图像参考类节点",
  controlnet: "构图/姿态控制——画布控制类节点",
  audio_encoders: "音频编码——视频配音轨",
  embeddings: "文本风格嵌入——提示词增强",
  vae_approx: "潜空间快速预览解码——画布出图预览",
  checkpoints: "ComfyUI 整包模型(单文件全合一)",
  diffusers: "diffusers 布局模型目录",
  configs: "模型配套配置文件",
};

/** 关键模型件级注释(子串匹配相对路径,先中先用;未命中走类别注释)。 */
export const COMFY_MODEL_FILE_NOTES: ReadonlyArray<readonly [string, string]> = [
  ["krea2_turbo_bf16", "Krea2 生图主力——文生图/图生图/无衣物/NSFW 专业流"],
  ["qwen3-vl-4b-heretic", "生图提示词编码(破限版)——Krea2 流"],
  ["qwen_image_vae", "生图解码器——Krea2/Qwen 系"],
  ["minimax_h3_fl2va", "H3 视频生成主模型"],
  ["minimax_h3_video_vae", "H3 视频解码"],
  ["minimax_h3_audio_vae", "H3 配音轨编码"],
  ["minimax_h3_latent_upscaler", "H3 视频潜空间放大"],
  ["seedvr2_7b_sharp", "图像修复超分(强档);视频 2K 超分同引擎"],
  ["ema_vae_fp16", "SEEDVR2 配套 VAE"],
  ["KREA 2 Mystic XXX v3", "NSFW 专业流破限补丁(主力)"],
  ["Krea 2 pussy", "NSFW 专业流补丁"],
  ["Krea 2 NSFW V4", "NSFW 备选补丁(默认关)"],
  ["identity_edit", "无衣物·指令编辑主件"],
  ["Krea2-Turbo-4步蒸馏", "漫影生图加速档(8→4 步)——本地模型模块「加速」用"],
  ["rife_v4.26", "视频补帧"],
];

export function modelFileNote(relPath: string): string | null {
  for (const [needle, note] of COMFY_MODEL_FILE_NOTES) {
    if (relPath.includes(needle)) return note;
  }
  return null;
}

export function modelCategoryInfo(category: string): string {
  return COMFY_MODEL_CATEGORY_INFO[category] ?? "ComfyUI 生态模型——经画布节点使用";
}

/** 模型文件大小展示:≥1GB 用 GB 一位小数,否则 MB。 */
export function formatModelSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 ** 3) return `${(sizeBytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024 ** 2))} MB`;
}

// ── 分域分组 ──────────────────────────────────────────────────────────

export interface ComfyModelDomainGroup {
  domain: ComfyModelDomain;
  label: string;
  info: string;
  /** 域内按类别分桶(多重归属件在每个命中域各出现一次) */
  categories: Array<{ category: string; files: ComfyModelsEntry[]; bytes: number }>;
  fileCount: number;
  bytes: number;
}

/** 清单 → 域分组树(域 → 类别 → 文件);空域不出现,顺序=DOMAIN_ORDER。 */
export function groupModelsByDomain(reply: ComfyModelsReply): ComfyModelDomainGroup[] {
  const buckets = new Map<ComfyModelDomain, Map<string, ComfyModelsEntry[]>>();
  for (const group of reply.groups) {
    for (const file of group.files) {
      for (const domain of classifyModelDomains(group.category, file.name)) {
        const byCategory = buckets.get(domain) ?? new Map<string, ComfyModelsEntry[]>();
        buckets.set(domain, byCategory);
        const files = byCategory.get(group.category) ?? [];
        byCategory.set(group.category, files);
        files.push(file);
      }
    }
  }
  return DOMAIN_ORDER.flatMap((domain) => {
    const byCategory = buckets.get(domain);
    if (!byCategory) return [];
    const categories = [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, files]) => ({
        category,
        files,
        bytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      }));
    return [{
      domain,
      label: DOMAIN_LABELS[domain],
      info: DOMAIN_INFO[domain],
      categories,
      fileCount: categories.reduce((sum, item) => sum + item.files.length, 0),
      bytes: categories.reduce((sum, item) => sum + item.bytes, 0),
    }];
  });
}
