#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
upscale_shootout_workflows_1028.py — 10-28 FastH3 480p 超分横评 · 工作流生成器(Mac=控制面)

产出 12 件 API 格式工作流 JSON → apps/output/fasth3-upscale-shootout-1028/<run>/workflow-api-<tier>.json
红线(计划 §八):横评工作流 API 件一律住战役目录,不入 repo 工作流库;本脚本本身不入库(G5 显式排除)。

节点/模型对齐证据(2026-10-28 本役实查):
  - Windows 引擎 17000 实时 /object_info(1059 类,ComfyUI 0.42.0):core 视频四件+LTXV 2.5 全家+
    kitchen MiniMaxH3 系+UpscaleModelLoader(combo 实列 4x-UltraSharp.pth)+LatentUpscaleModelLoader
  - Windows models 实列(ssh glob):SEEDVR2 双档/FlashVSR-v1.1 四件/ltx-2.5 全家/latent_upscale_models 两件
  - M1 在档 API 件(seedvr2-mac/workflow-api.json,实跑 PASS);numz master pyproject==2.5.24 与 Mac 同版零漂移
  - Mac 在位包源码实读:LBH MinimaxH3LatentUpscaler3D / VHS LoadVideoUpload+VideoCombine
  - GitHub master 源码实读:lihaoyun6 FlashVSR 三节点 / ylchen333 VOSR2 两节点 / Comfy-Org RTXVideoSuperResolution
用法:python3 apps/build/scripts/upscale_shootout_workflows_1028.py
"""
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
CAMP = os.path.join(REPO, "apps", "output", "fasth3-upscale-shootout-1028")
INPUT_VIDEO = "t2v-480p_00001_.mp4"
FPS = 24.0

# ---------------------------------------------------------------- 节点注册表(校验用,含出处)
REGISTRY = {
    # — Windows 引擎 17000 实时 /object_info(2026-10-28 08:06 拉取,ComfyUI 0.42.0) —
    "LoadVideo": {"out": ["VIDEO"], "inputs": ["file"], "prov": "win-live-17000"},
    "GetVideoComponents": {"out": ["IMAGE", "AUDIO", "FLOAT", "COMBO", "COMBO"], "inputs": ["video"], "prov": "win-live-17000"},
    "CreateVideo": {"out": ["VIDEO"], "inputs": ["images", "fps"], "optional": ["audio", "bit_depth", "color_space", "codec"], "prov": "win-live-17000"},
    "SaveVideo": {"out": ["VIDEO"], "inputs": ["video", "filename_prefix", "format"],
                  "dynamic": {"format": {"auto": ["codec"], "mp4": ["codec"], "mkv": ["codec"], "webm": ["codec"]},
                              "codec": {"auto": [], "h264": ["encoding"], "av1": ["encoding"]},
                              "encoding": {"auto": [], "re-encode": ["crf"]}},
                  "prov": "win-live-17000"},
    "VAEEncode": {"out": ["LATENT"], "inputs": ["pixels", "vae"], "prov": "win-live-17000"},
    "VAEDecode": {"out": ["IMAGE"], "inputs": ["samples", "vae"], "prov": "win-live-17000"},
    "VAELoader": {"out": ["VAE"], "inputs": ["vae_name"], "prov": "win-live-17000"},
    "UNETLoader": {"out": ["MODEL"], "inputs": ["unet_name", "weight_dtype"], "prov": "win-live-17000"},
    "CLIPLoader": {"out": ["CLIP"], "inputs": ["clip_name", "type"], "optional": ["device"], "prov": "win-live-17000"},
    "CLIPTextEncode": {"out": ["CONDITIONING"], "inputs": ["text", "clip"], "prov": "win-live-17000"},
    "UpscaleModelLoader": {"out": ["UPSCALE_MODEL"], "inputs": ["model_name"], "prov": "win-live-17000"},
    "ImageUpscaleWithModel": {"out": ["IMAGE"], "inputs": ["upscale_model", "image"], "prov": "win-live-17000"},
    "LatentUpscaleModelLoader": {"out": ["LATENT_UPSCALE_MODEL"], "inputs": ["model_name"], "prov": "win-live-17000"},
    "BasicScheduler": {"out": ["SIGMAS"], "inputs": ["model", "scheduler", "steps", "denoise"], "prov": "win-live-17000"},
    "BasicGuider": {"out": ["GUIDER"], "inputs": ["model", "conditioning"], "prov": "win-live-17000"},
    "RandomNoise": {"out": ["NOISE"], "inputs": ["noise_seed"], "prov": "win-live-17000"},
    "KSamplerSelect": {"out": ["SAMPLER"], "inputs": ["sampler_name"], "prov": "win-live-17000"},
    "SamplerCustomAdvanced": {"out": ["LATENT", "LATENT"], "inputs": ["noise", "guider", "sampler", "sigmas", "latent_image"], "prov": "win-live-17000"},
    "ModelAttentionBackend": {"out": ["MODEL"], "inputs": ["model", "attention"], "prov": "win-live-17000"},
    "BlockSparseAttention": {"out": ["MODEL"], "inputs": ["model", "selection", "start_percent", "end_percent", "dense_blocks", "min_tokens", "extra_tokens", "sink_conditioning", "verbose"],
                             "dynamic": {"selection": {"sol-attn": ["tau"], "sla": ["keep_percent"], "vsa": ["keep_percent"]}},
                             "prov": "win-live-17000"},
    "MiniMaxH3SigmaShift": {"out": ["MODEL"], "inputs": ["model", "shift_video", "shift_audio"], "prov": "win-live-17000"},
    "MiniMaxH3ImageToVideo": {"out": ["CONDITIONING", "LATENT"], "inputs": ["clip", "vae", "prompt", "width", "height", "length"],
                              "optional": ["first_frame", "last_frame"], "prov": "win-live-17000"},
    "LTXVLatentUpsampler": {"out": ["LATENT"], "inputs": ["samples", "upscale_model", "vae"], "prov": "win-live-17000"},
    "LTXVScheduler": {"out": ["SIGMAS"], "inputs": ["steps", "max_shift", "base_shift", "stretch", "terminal"], "optional": ["latent"], "prov": "win-live-17000"},
    "LTXVDualCFGGuider": {"out": ["GUIDER"], "inputs": ["model", "positive", "negative", "video_cfg", "audio_cfg"], "prov": "win-live-17000"},
    "LTXVConditioning": {"out": ["CONDITIONING", "CONDITIONING"], "inputs": ["positive", "negative", "frame_rate"], "prov": "win-live-17000"},
    "LTXAVTextEncoderLoader": {"out": ["CLIP"], "inputs": ["text_encoder", "ckpt_name", "device"], "prov": "win-live-17000"},
    # — M1 实跑证 + numz master==2.5.24 零漂移(10-28 实查) —
    "SeedVR2LoadDiTModel": {"out": ["SEEDVR2_DIT"], "inputs": ["model", "device", "blocks_to_swap", "swap_io_components", "offload_device", "cache_model", "attention_mode"], "prov": "m1-proven+numz-master-2.5.24"},
    "SeedVR2LoadVAEModel": {"out": ["SEEDVR2_VAE"], "inputs": ["model", "device", "encode_tiled", "encode_tile_size", "encode_tile_overlap", "decode_tiled", "decode_tile_size", "decode_tile_overlap", "tile_debug", "offload_device", "cache_model"], "prov": "m1-proven+numz-master-2.5.24"},
    "SeedVR2VideoUpscaler": {"out": ["IMAGE"], "inputs": ["image", "dit", "vae", "seed", "resolution", "max_resolution", "batch_size", "uniform_batch_size", "color_correction", "temporal_overlap", "prepend_frames", "input_noise_scale", "latent_noise_scale", "offload_device", "enable_debug"], "prov": "m1-proven+numz-master-2.5.24"},
    # — Mac 在位包源码实读(VHS @4d907be;Windows 装 master 同构) —
    "VHS_LoadVideo": {"out": ["IMAGE", "INT", "AUDIO", "VHS_VIDEOINFO"], "inputs": ["video", "force_rate", "custom_width", "custom_height", "frame_load_cap", "skip_first_frames", "select_every_nth"],
                      "optional": ["meta_batch", "vae", "format"], "prov": "mac-pack-4d907be(load_video_nodes.py:424)"},
    "VHS_VideoCombine": {"out": ["VHS_FILENAMES"], "inputs": ["images", "frame_rate", "loop_count", "filename_prefix", "format", "pingpong", "save_output"],
                         "optional": ["audio", "meta_batch", "vae"], "extra_widgets": ["pix_fmt", "crf", "save_metadata", "trim_to_audio"],
                         "prov": "mac-pack-4d907be(nodes.py:245)+件B惯例(video/h264-mp4,crf19)"},
    # — Mac 在位 LBH 包源码实读(minimax_h3_latent_upscaler_3d.py:472 define_schema) —
    "MinimaxH3LatentUpscaler3D": {"out": ["LATENT"], "inputs": ["latent", "model_name", "mode", "align", "enable_temporal_chunking", "force_unload", "device", "precision"],
                                  "dynamic": {"mode": {"scale by multiplier": ["scale"], "target dimensions": ["width", "height"], "megapixels": ["megapixels"]}},
                                  "prov": "mac-pack-LBH(minimax_h3_latent_upscaler_3d.py:472)"},
    # — GitHub master 源码实读(10-28) —
    "FlashVSRInitPipe": {"out": ["PIPE"], "inputs": ["model", "mode", "alt_vae", "force_offload", "precision", "device", "attention_mode"], "prov": "github-lihaoyun6-master(nodes.py)"},
    "FlashVSRNodeAdv": {"out": ["IMAGE"], "inputs": ["pipe", "frames", "scale", "color_fix", "tiled_vae", "tiled_dit", "tile_size", "tile_overlap", "unload_dit", "sparse_ratio", "kv_ratio", "local_range", "seed"], "prov": "github-lihaoyun6-master(nodes.py)"},
    "VOSR2ModelLoader": {"out": ["VOSR2_MODEL"], "inputs": ["model", "dtype"], "prov": "github-ylchen333-main(nodes_vosr.py+loader.py:KNOWN_MODEL=VOSR2)"},
    "VOSR2Upscale": {"out": ["IMAGE"], "inputs": ["model", "image", "upscale", "seed", "color_alignment", "tile_size", "tile_overlap", "vae_tile_size", "vae_tile_overlap"], "prov": "github-ylchen333-main(nodes_vosr.py)"},
    "RTXVideoSuperResolution": {"out": ["IMAGE"], "inputs": ["images", "resize_type", "quality", "strength", "image_encoding"],
                                "dynamic": {"resize_type": {"scale by multiplier": ["scale"], "target dimensions": ["width", "height"]}},
                                "prov": "github-Comfy-Org-main(__init__.py)"},
}

SRC_W, SRC_H = 608, 352
W2X, H2X = 1216, 704
W4X, H4X = 2432, 1408

SPECS = []  # (run_dir, tier, filename, target_wh, note)


def wf_seedvr2(resolution, prefix):
    return {
        "1": {"class_type": "LoadVideo", "inputs": {"file": INPUT_VIDEO}},
        "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "3": {"class_type": "SeedVR2LoadDiTModel", "inputs": {
            "model": "seedvr2_7b_sharp_fp8_e4m3fn.safetensors", "device": "cuda",
            "blocks_to_swap": 36, "swap_io_components": False, "offload_device": "none",
            "cache_model": False, "attention_mode": "sdpa"}},
        "4": {"class_type": "SeedVR2LoadVAEModel", "inputs": {
            "model": "ema_vae_fp16.safetensors", "device": "cuda",
            "encode_tiled": True, "encode_tile_size": 512, "encode_tile_overlap": 160,
            "decode_tiled": True, "decode_tile_size": 512, "decode_tile_overlap": 160,
            "tile_debug": "false", "offload_device": "none", "cache_model": False}},
        "5": {"class_type": "SeedVR2VideoUpscaler", "inputs": {
            "image": ["2", 0], "dit": ["3", 0], "vae": ["4", 0],
            "seed": 42, "resolution": resolution, "max_resolution": 0,
            "batch_size": 5, "uniform_batch_size": False, "color_correction": "lab",
            "temporal_overlap": 3, "prepend_frames": 4,
            "input_noise_scale": 0.0, "latent_noise_scale": 0.0,
            "offload_device": "none", "enable_debug": False}},
        "6": {"class_type": "CreateVideo", "inputs": {
            "images": ["5", 0], "fps": ["2", 2], "audio": ["2", 1], "bit_depth": 8}},
        "7": {"class_type": "SaveVideo", "inputs": {
            "video": ["6", 0], "filename_prefix": prefix, "format": "auto"}},
    }


def wf_esrgan(prefix):
    return {
        "1": {"class_type": "VHS_LoadVideo", "inputs": {
            "video": INPUT_VIDEO, "force_rate": 0, "custom_width": 0, "custom_height": 0,
            "frame_load_cap": 0, "skip_first_frames": 0, "select_every_nth": 1}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "4x-UltraSharp.pth"}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "VHS_VideoCombine", "inputs": {
            "images": ["3", 0], "frame_rate": int(FPS), "loop_count": 0,
            "filename_prefix": prefix, "format": "video/h264-mp4", "pix_fmt": "yuv420p",
            "crf": 19, "save_metadata": True, "trim_to_audio": False,
            "pingpong": False, "save_output": True}},
    }


def wf_flashvsr(scale, prefix):
    return {
        "1": {"class_type": "VHS_LoadVideo", "inputs": {
            "video": INPUT_VIDEO, "force_rate": 0, "custom_width": 0, "custom_height": 0,
            "frame_load_cap": 0, "skip_first_frames": 0, "select_every_nth": 1}},
        "2": {"class_type": "FlashVSRInitPipe", "inputs": {
            "model": "FlashVSR-v1.1", "mode": "tiny", "alt_vae": "none",
            "force_offload": True, "precision": "bf16", "device": "auto",
            "attention_mode": "block_sparse_attention"}},
        "3": {"class_type": "FlashVSRNodeAdv", "inputs": {
            "pipe": ["2", 0], "frames": ["1", 0], "scale": scale,
            "color_fix": True, "tiled_vae": True, "tiled_dit": True,
            "tile_size": 256, "tile_overlap": 24, "unload_dit": True,
            "sparse_ratio": 2.0, "kv_ratio": 3.0, "local_range": 11, "seed": 42}},
        "4": {"class_type": "VHS_VideoCombine", "inputs": {
            "images": ["3", 0], "frame_rate": int(FPS), "loop_count": 0,
            "filename_prefix": prefix, "format": "video/h264-mp4", "pix_fmt": "yuv420p",
            "crf": 19, "save_metadata": True, "trim_to_audio": False,
            "pingpong": False, "save_output": True}},
    }


def wf_vosr2_vfx(upscale, vae_tile, prefix):
    return {
        "1": {"class_type": "VHS_LoadVideo", "inputs": {
            "video": INPUT_VIDEO, "force_rate": 0, "custom_width": 0, "custom_height": 0,
            "frame_load_cap": 0, "skip_first_frames": 0, "select_every_nth": 1}},
        "2": {"class_type": "VOSR2ModelLoader", "inputs": {"model": "VOSR2", "dtype": "fp16"}},
        "3": {"class_type": "VOSR2Upscale", "inputs": {
            "model": ["2", 0], "image": ["1", 0], "upscale": upscale, "seed": 42,
            "color_alignment": "wavelet", "tile_size": 512, "tile_overlap": 32,
            "vae_tile_size": vae_tile, "vae_tile_overlap": 32}},
        "4": {"class_type": "RTXVideoSuperResolution", "inputs": {
            "images": ["3", 0], "resize_type": "scale by multiplier", "scale": 1.0,
            "quality": "HIGH", "strength": 1.0, "image_encoding": "8-bit RGB"}},
        "5": {"class_type": "CreateVideo", "inputs": {"images": ["4", 0], "fps": FPS, "bit_depth": 8}},
        "6": {"class_type": "SaveVideo", "inputs": {
            "video": ["5", 0], "filename_prefix": prefix,
            "format": "mp4", "codec": "h264", "encoding": "re-encode", "crf": 19}},
    }


def wf_vfx(scale, prefix):
    return {
        "1": {"class_type": "LoadVideo", "inputs": {"file": INPUT_VIDEO}},
        "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "3": {"class_type": "RTXVideoSuperResolution", "inputs": {
            "images": ["2", 0], "resize_type": "scale by multiplier", "scale": scale,
            "quality": "HIGH", "strength": 1.0, "image_encoding": "8-bit RGB"}},
        "4": {"class_type": "CreateVideo", "inputs": {"images": ["3", 0], "fps": ["2", 2], "bit_depth": 8}},
        "5": {"class_type": "SaveVideo", "inputs": {
            "video": ["4", 0], "filename_prefix": prefix,
            "format": "mp4", "codec": "h264", "encoding": "re-encode", "crf": 19}},
    }


W6_PROMPT = ("水墨国风动画短片画面。保持原画面构图、人物与场景不变,提升清晰度、细节与线条锐度。"
             "overall_soundscape: ambient. non_diegetic_music: None.")


def wf_fasth3_ercai(prefix):
    return {
        "1": {"class_type": "LoadVideo", "inputs": {"file": INPUT_VIDEO}},
        "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "3": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors", "weight_dtype": "default"}},
        "4": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default"}},
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_video_vae_int8_convrot.safetensors"}},
        "6": {"class_type": "MiniMaxH3SigmaShift", "inputs": {"model": ["3", 0], "shift_video": 10.0, "shift_audio": 3.0}},
        "7": {"class_type": "ModelAttentionBackend", "inputs": {"model": ["6", 0], "attention": "comfy kitchen attention"}},
        "8": {"class_type": "BlockSparseAttention", "inputs": {
            "model": ["7", 0], "selection": "vsa", "keep_percent": 10.0,
            "start_percent": 0.2, "end_percent": 1.0, "dense_blocks": "",
            "min_tokens": 12288, "extra_tokens": 256,
            "sink_conditioning": "exact_kv_and_rows", "verbose": False}},
        "9": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["5", 0]}},
        "10": {"class_type": "MinimaxH3LatentUpscaler3D", "inputs": {
            "latent": ["9", 0], "model_name": "minimax_h3_latent_upscaler_3d_bf16.safetensors",
            "mode": "target dimensions", "width": W2X, "height": H2X, "align": 32,
            "enable_temporal_chunking": True, "force_unload": True, "device": "cuda", "precision": "fp16"}},
        "11": {"class_type": "BasicScheduler", "inputs": {
            "model": ["8", 0], "scheduler": "simple", "steps": 8, "denoise": 0.45}},
        "12": {"class_type": "BasicGuider", "inputs": {"model": ["8", 0], "conditioning": ["13", 0]}},
        "13": {"class_type": "MiniMaxH3ImageToVideo", "inputs": {
            "clip": ["4", 0], "vae": ["5", 0], "prompt": W6_PROMPT,
            "width": W2X, "height": H2X, "length": 124}},
        "14": {"class_type": "RandomNoise", "inputs": {"noise_seed": 42}},
        "15": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "16": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["14", 0], "guider": ["12", 0], "sampler": ["15", 0],
            "sigmas": ["11", 0], "latent_image": ["10", 0]}},
        "17": {"class_type": "VAEDecode", "inputs": {"samples": ["16", 0], "vae": ["5", 0]}},
        "18": {"class_type": "CreateVideo", "inputs": {"images": ["17", 0], "fps": ["2", 2], "bit_depth": 8}},
        "19": {"class_type": "SaveVideo", "inputs": {
            "video": ["18", 0], "filename_prefix": prefix,
            "format": "mp4", "codec": "h264", "encoding": "re-encode", "crf": 19}},
    }


W7_PROMPT_POS = "高清水墨动画短片画面,保持原画面构图与内容,增强细节与清晰度。"
W7_PROMPT_NEG = ""


def wf_ltx25_ercai(prefix):
    return {
        "1": {"class_type": "LoadVideo", "inputs": {"file": INPUT_VIDEO}},
        "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ltx-2.5-video-vae-conv-bf16.safetensors"}},
        "4": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors", "weight_dtype": "default"}},
        "5": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["3", 0]}},
        "6": {"class_type": "LatentUpscaleModelLoader", "inputs": {
            "model_name": "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors"}},
        "7": {"class_type": "LTXVLatentUpsampler", "inputs": {
            "samples": ["5", 0], "upscale_model": ["6", 0], "vae": ["3", 0]}},
        "8": {"class_type": "LTXAVTextEncoderLoader", "inputs": {
            "text_encoder": "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
            "ckpt_name": "sam3.1_multiplex_fp16.safetensors", "device": "default"}},
        "9": {"class_type": "CLIPTextEncode", "inputs": {"text": W7_PROMPT_POS, "clip": ["8", 0]}},
        "10": {"class_type": "CLIPTextEncode", "inputs": {"text": W7_PROMPT_NEG, "clip": ["8", 0]}},
        "11": {"class_type": "LTXVConditioning", "inputs": {
            "positive": ["9", 0], "negative": ["10", 0], "frame_rate": FPS}},
        "12": {"class_type": "LTXVDualCFGGuider", "inputs": {
            "model": ["4", 0], "positive": ["11", 0], "negative": ["11", 1],
            "video_cfg": 3.0, "audio_cfg": 7.0}},
        "13": {"class_type": "RandomNoise", "inputs": {"noise_seed": 42}},
        "14": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "15": {"class_type": "LTXVScheduler", "inputs": {
            "steps": 30, "max_shift": 2.05, "base_shift": 0.95, "stretch": True, "terminal": 0.1}},
        "16": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["13", 0], "guider": ["12", 0], "sampler": ["14", 0],
            "sigmas": ["15", 0], "latent_image": ["7", 0]}},
        "17": {"class_type": "VAEDecode", "inputs": {"samples": ["16", 0], "vae": ["3", 0]}},
        "18": {"class_type": "CreateVideo", "inputs": {"images": ["17", 0], "fps": ["2", 2], "bit_depth": 8}},
        "19": {"class_type": "SaveVideo", "inputs": {
            "video": ["18", 0], "filename_prefix": prefix,
            "format": "mp4", "codec": "h264", "encoding": "re-encode", "crf": 19}},
    }


def main():
    os.makedirs(os.path.join(CAMP, "_workflows"), exist_ok=True)
    # (run_dir, tier, target_wh, gen, note)
    jobs = [
        ("seedvr2-win", "2x", (W2X, H2X), lambda: wf_seedvr2(704, "seedvr2-win-2x"),
         "W1 主档:resolution=704(短边)→1216x704;swap36+tiling512/160+batch5+temporal_overlap3(对齐 M1 实跑值);附档 4x 另件"),
        ("seedvr2-win", "4x", (W4X, H4X), lambda: wf_seedvr2(1408, "seedvr2-win-4x"),
         "W1 附档试跑一次:resolution=1408→2432x1408(高危 issue#483/#484,OOM 即弃不进两轮预算)"),
        ("esrgan-baseline-win", "4x", (W4X, H4X), lambda: wf_esrgan("esrgan-baseline-win-4x"),
         "W2 原生 4x=2432x1408(native-4x 组);主档 2x=Mac 端 lanczos 缩制派生(derived-2x,不在本件)"),
        ("esrgan-baseline-mac", "4x", (W4X, H4X), lambda: wf_esrgan("esrgan-baseline-mac-4x"),
         "M2 可选档:Mac 侧同构链(4x-UltraSharp.pth 已在 Mac models/upscale_models,66,961,958B)"),
        ("flashvsr", "2x", (W2X, H2X), lambda: wf_flashvsr(2, "flashvsr-2x"),
         "W3 主档 scale=2(tiled_dit 画布=精确 1216x704);attention_mode=block_sparse_attention(requirements 无 sageattention 依赖)"),
        ("flashvsr", "4x", (W4X, H4X), lambda: wf_flashvsr(4, "flashvsr-4x"),
         "W3 附档 scale=4(官方强项档;2432/1408 均 128 整除,tile 覆盖完整)"),
        ("vosr2-vfx", "2x", (W2X, H2X), lambda: wf_vosr2_vfx(2, 0, "vosr2-vfx-2x"),
         "W4 主档:VOSR2 upscale=2(tile512)+RTXVSR scale=1 视频链修整;VFX 装败→去 RTX 节点直连 CreateVideo(降级档)"),
        ("vosr2-vfx", "4x", (W4X, H4X), lambda: wf_vosr2_vfx(4, 1024, "vosr2-vfx-4x"),
         "W4 附档:upscale=4+vae_tile 1024(README 4096 档建议)+RTXVSR scale=1"),
        ("nvidia-vfx", "2x", (W2X, H2X), lambda: wf_vfx(2.0, "nvidia-vfx-2x"),
         "W5 主档:scale=2(1216/704 均 8 整除,SDK 输出取整无损失);quality=HIGH(OOM 阶梯降 MEDIUM)"),
        ("nvidia-vfx", "4x", (W4X, H4X), lambda: wf_vfx(4.0, "nvidia-vfx-4x"),
         "W5 附档:scale=4(2432/1408 均 8 整除)"),
        ("fasth3-ercai", "2x", (W2X, H2X), lambda: wf_fasth3_ercai("fasth3-ercai-2x"),
         "W6:LoadVideo→VAEEncode(视频VAE,纯视频latent,无需 LBH 分离/合回)→LBH 3D target 1216x704(align32,/16 精确)→"
         "FastH3 8步浅二采(BasicScheduler denoise=0.45 取 sigma 低噪尾段;两轮内可调)→解码;模型链=repo 模板原值(VSA keep10)"),
        ("ltx25-ercai", "2x", (W2X, H2X), lambda: wf_ltx25_ercai("ltx25-ercai-2x"),
         "W7:core LTXV 2.5 零装;LTXVLatentUpsampler x2;TE=官方配对 LTXAVTextEncoderLoader(gemma4-with-proj+sam3.1 第二件,"
         "Windows checkpoints 已在位);二采强度由 steps/terminal 支配(30/0.1 起步,两轮内可调);latent 链判据②按 ±32 ADJUSTED 容差"),
    ]
    manifest = []
    for run_dir, tier, target, gen, note in jobs:
        wf = gen()
        d = os.path.join(CAMP, run_dir)
        os.makedirs(d, exist_ok=True)
        fname = f"workflow-api-{tier}.json"
        path = os.path.join(d, fname)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(wf, f, ensure_ascii=False, indent=2)
            f.write("\n")
        manifest.append({
            "run": run_dir, "tier": tier, "file": os.path.relpath(path, REPO),
            "target_wh": list(target), "nodes": len(wf), "note": note,
        })
        print(f"[gen] {os.path.relpath(path, REPO)}  nodes={len(wf)} target={target[0]}x{target[1]}")
    # 注册表落盘(供校验器与后续 Windows 段复核)
    reg_path = os.path.join(CAMP, "_workflows", "node-registry-1028.json")
    with open(reg_path, "w", encoding="utf-8") as f:
        json.dump({"_provenance": {
            "win-live-17000": "Windows 引擎 17000 实时 /object_info 子集(2026-10-28 08:06 ssh curl 拉取,ComfyUI 0.42.0)",
            "m1-proven+numz-master-2.5.24": "M1 实跑 PASS 的 API 键序 + numz GitHub master pyproject==2.5.24(与 Mac 在位同版零漂移,10-28 实查)",
            "mac-pack-4d907be(load_video_nodes.py:424)": "Mac 在位 VHS @4d907be 源码实读;Windows 装 Kosinkadink master",
            "mac-pack-LBH(minimax_h3_latent_upscaler_3d.py:472)": "Mac 在位 LBH 包源码实读(P7 装 Windows 同包)",
            "github-lihaoyun6-master(nodes.py)": "lihaoyun6/ComfyUI-FlashVSR_Ultra_Fast master nodes.py 源码实读(10-28)",
            "github-ylchen333-main(nodes_vosr.py+loader.py:KNOWN_MODEL=VOSR2)": "ylchen333/ComfyUI-VOSR2 main 源码实读(10-28)",
            "github-Comfy-Org-main(__init__.py)": "Comfy-Org/ComfyUI_Nvidia_VFX_Nodes main __init__.py 源码实读(10-28)",
        }, "registry": REGISTRY}, f, ensure_ascii=False, indent=2)
    man_path = os.path.join(CAMP, "_workflows", "workflows-manifest-1028.json")
    with open(man_path, "w", encoding="utf-8") as f:
        json.dump({"input_video": INPUT_VIDEO, "input_wh": [SRC_W, SRC_H], "fps": FPS,
                   "specs": manifest}, f, ensure_ascii=False, indent=2)
    print(f"[gen] registry+manifest -> {os.path.relpath(reg_path, REPO)} , {os.path.relpath(man_path, REPO)}")
    print(f"[gen] total files: {len(manifest)}")


if __name__ == "__main__":
    main()
