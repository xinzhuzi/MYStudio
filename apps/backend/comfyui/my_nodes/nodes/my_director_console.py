# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台节点壳(11-13 director-console-remake 阶段1)。

结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director(Apache-2.0):
nodes/director.py:50-196 四入参全外置(model/video_vae/audio_vae/clip,
零模型硬绑,画布一条链四 loader 直喂)+ director_common.py:73 隐藏 STRING
widget ``timeline_data`` 作面板↔节点唯一序列化通道(禁自造第二 widget
通道)。阶段勾选=timeline_data 顶层 ``stages`` 三布尔(yicai/ercai/sancai,
PRD R1.5 勾啥跑啥)。

阶段1 范围冻结(design.md §1/§2):execute=骨架空转,返回 1×1 占位帧组;
采样执行链/显存清理四点位/model_prefetch 队列清坑排阶段3。

配方常量焊死表 DIRECTOR_RECIPE(PRD R1.7 锁死档):抽自纯净化母本
59 节点(三采-单镜.json),与 test_director_console_contract.py
§5-5/§5-7 钉值同源;LoRA/底模/TE/VAE 不上面板——乱调即踩乱码红线
(Euler→片尾乱码)与画质悬崖。
"""
from __future__ import annotations

import json

__all__ = ["MyDirectorConsole", "DIRECTOR_RECIPE", "TIMELINE_VERSION",
           "DEFAULT_STAGES", "parse_timeline"]

# ── 配方常量焊死表(PRD R1.7;改一行=偏离产线验证档,须用户令)──────
DIRECTOR_RECIPE = {
    # 底模/TE/VAE 四件套(母本 [127]/[128]/[119]/[120])
    "unet": "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors",
    "clip": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "video_vae": "minimax_h3_video_vae_int8_convrot.safetensors",
    "audio_vae": "minimax_h3_audio_vae_fp32.safetensors",
    # 三采超分 transformer(母本 [338] ReCaVSRLoader)
    "recavsr_transformer": "transformer_int8_convrot.safetensors",
    # LoRA 挂载(母本 [216]/[145]/[202];i2v 含 fl2v 吸收臂)
    "lora_i2v": ("pika_turbo_8step_fl2va.safetensors", 1.0),
    "lora_r2v": ("pika_h3_flex_ref2va_comfy_bf16.safetensors", 1.0),
    "lora_second_pass": ("taomate_h3_3step.safetensors", 0.7),
    # 注意力后端(母本 [217]/[140]/[215] ModelAttentionBackend)
    "attention_backend": "comfy kitchen attention",
    # 稀疏注意力(母本 [260]/[262]/[267] BlockSparseAttention τ1.3)
    "sol_attn": {"backend": "sol-attn", "tau": 1.3},
    # σ 档(母本 [251] 一采 / [203] 二采 MiniMaxH3SigmaShift)
    "sigma_shift_first_pass": (6, 3),
    "sigma_shift_second_pass": (12, 3),
    # 一采采样档(母本 [123] KSamplerSelect lcm,Euler→片尾乱码红线)
    "sampler_first_pass": "lcm",
    "first_pass_steps": 8,
    # 二采调度档(母本 [209] BasicScheduler simple/3步/dn0.2)
    "second_pass_scheduler": "simple",
    "second_pass_steps": 3,
    "second_pass_denoise": 0.2,
    # 分辨率阶梯(一采 960×544×124f / 二采潜放大 1440×832,母本 [16]/[206])
    "first_pass_resolution": (960, 544),
    "second_pass_resolution": (1440, 832),
}

# timeline_data payload 版本(AIMixer buildTimelinePayload version:5 同构语义,
# 我方自 v1 起)
TIMELINE_VERSION = 1

# 阶段勾选默认(空 timeline_data 兜底):三不勾=不跑,勾啥跑啥(PRD R1.5)
DEFAULT_STAGES = {"yicai": False, "ercai": False, "sancai": False}


def parse_timeline(timeline_data):
    """timeline_data JSON → dict(空/坏值兜底默认,snake→顶层 stages 归一)。

    结构借鉴 AIMixer parseTimeline(minimax_timeline.js:1994-2199)的
    「JSON.parse+全字段默认值兜底」思路;阶段1 只认 stages/segments 骨架。
    """
    payload = {"version": TIMELINE_VERSION, "stages": dict(DEFAULT_STAGES),
               "segments": [], "chapter": "chapter-b001"}
    if not timeline_data:
        return payload
    try:
        data = json.loads(timeline_data)
    except (TypeError, ValueError):
        return payload
    if not isinstance(data, dict):
        return payload
    stages = data.get("stages")
    if isinstance(stages, dict):
        for key in DEFAULT_STAGES:
            value = stages.get(key)
            payload["stages"][key] = value if isinstance(value, bool) \
                else DEFAULT_STAGES[key]
    segments = data.get("segments")
    if isinstance(segments, list):
        payload["segments"] = segments
    chapter = data.get("chapter")
    if isinstance(chapter, str) and chapter:
        payload["chapter"] = chapter
    if isinstance(data.get("version"), int):
        payload["version"] = data["version"]
    return payload


class MyDirectorConsole:
    """导演台:单节点内嵌时间线面板,一条链四 loader 直喂,分段逐镜调度。

    阶段1=节点壳:面板(web/daoyan/,addDOMWidget 挂载)经隐藏 STRING
    widget timeline_data 序列化读写;execute 空转返回 1×1 占位帧组,
    执行链(一采草片→审核→二采→/free 卸 H3→三采可选)排阶段3。
    """

    CATEGORY = "漫影"
    FUNCTION = "execute"
    RETURN_TYPES = ("IMAGE",)
    OUTPUT_TOOLTIPS = ("阶段1 骨架空转占位帧(1×1);执行链排阶段3",)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 四输入口全外置(AIMixer nodes/director.py:51-70 同构:
                # 零模型硬绑,画布一条链四 loader 直喂)
                "model": ("MODEL",),
                "video_vae": ("VAE",),
                "audio_vae": ("VAE",),
                "clip": ("CLIP",),
                # 面板↔节点唯一序列化通道(AIMixer director_common.py:73
                # 同构):面板 commit 500ms 去抖写回,入队前强 flush;
                # 前端 index.js 把 widget 隐藏、面板接管交互
                "timeline_data": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "内部通道:面板时间线/素材组/阶段勾选 JSON"
                               "(由面板写入,勿手改)",
                }),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    @staticmethod
    def _placeholder_frame():
        """1×1×3 零占位帧(引擎库懒加载:torch 函数内 import,源码位可测)。"""
        import torch
        return torch.zeros((1, 1, 3))

    def execute(self, model, video_vae, audio_vae, clip, timeline_data="",
                unique_id=None):
        """阶段1 骨架空转:解析 timeline_data(阶段勾选)后直返占位帧。

        阶段3 落位(AIMixer nodes/director.py:281 四段同构):
        prepare_director_plan → 逐段循环(_run_one_segment)→ finalize
        (草片/终片 ffmpeg 外拼);显存清理四点位+model_prefetch 队列清坑
        届时必带(design.md §1)。
        """
        plan = parse_timeline(timeline_data)
        # 空转留痕:勾选与镜数进不了图,阶段3 在此接执行链
        _ = (model, video_vae, audio_vae, clip, plan, unique_id)
        return (self._placeholder_frame(),)
