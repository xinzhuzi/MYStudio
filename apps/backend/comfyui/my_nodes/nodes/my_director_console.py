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

阶段1 范围冻结→阶段3 落位(1114):execute=真执行链入口
(director_executor.DirectorExecutor:计划→逐镜三采→finalize);
空台本仍返 1×1 占位帧组(契约不变);显存清理=三采前统一卸载
(批量役 POST /free 同义;model_prefetch 队列清坑随首批实弹验证)。

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
    「JSON.parse+全字段默认值兜底」思路;阶段3 起全字段归一(与面板
    serial.js normalizeState 同构:common_params/advanced/color_fix/
    segments[].frames 贴 17k+5 网格),程序化直投(API/批量)与面板
    序列化同口径。
    """
    payload = {"version": TIMELINE_VERSION, "stages": dict(DEFAULT_STAGES),
               "segments": [], "chapter": "chapter-b001",
               "color_fix": "none", "common_images": [],
               "common_params": {"enabled": True, "seconds": 5, "seed": 42,
                                 "match": "match"},
               "advanced": {"first_steps": DIRECTOR_RECIPE["first_pass_steps"],
                            "second_steps": DIRECTOR_RECIPE["second_pass_steps"],
                            "sampler": DIRECTOR_RECIPE["sampler_first_pass"],
                            "scheduler": "simple", "cfg": 1.0}}
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
        payload["segments"] = [_normalize_segment(s, i)
                               for i, s in enumerate(segments)]
    chapter = data.get("chapter")
    if isinstance(chapter, str) and chapter:
        payload["chapter"] = chapter
    if isinstance(data.get("version"), int):
        payload["version"] = data["version"]
    if data.get("color_fix") in ("none", "adain", "wavelet"):
        payload["color_fix"] = data["color_fix"]
    if isinstance(data.get("common_images"), list):
        payload["common_images"] = [str(x) for x in data["common_images"]
                                    if isinstance(x, str) and x.strip()]
    cp = data.get("common_params")
    if isinstance(cp, dict):
        if isinstance(cp.get("seed"), int):
            payload["common_params"]["seed"] = cp["seed"]
    adv = data.get("advanced")
    if isinstance(adv, dict):
        for key in ("first_steps", "second_steps"):
            if isinstance(adv.get(key), int) and adv[key] > 0:
                payload["advanced"][key] = adv[key]
    return payload


def _frames_from_seconds(seconds):
    """秒 → 17k+5 帧网格(面板 serial.secondsToFrames 同式)。"""
    k, bias, fps = 17, 5, 25
    if not isinstance(seconds, (int, float)) or seconds <= 0:
        return bias
    n = max(1, round((seconds * fps - bias) / k))
    return n * k + bias


def _normalize_segment(seg, idx):
    """单镜兜底(与面板 normalizeSegment 同构;frames=seconds 贴网格派生)。"""
    seg = seg if isinstance(seg, dict) else {}
    seconds = seg.get("seconds")
    if not isinstance(seconds, (int, float)) or seconds <= 0:
        seconds = 5
    prompt = seg.get("prompt") if isinstance(seg.get("prompt"), dict) else {}
    return {
        "id": str(seg.get("id") or f"镜头{idx + 1}"),
        "mode": seg.get("mode") if seg.get("mode") in
        ("t2v", "i2v", "fl2v", "r2v") else "r2v",
        "seconds": seconds,
        "frames": int(seg["frames"]) if isinstance(seg.get("frames"), int)
        and seg["frames"] > 0 else _frames_from_seconds(seconds),
        "seed": seg.get("seed") if isinstance(seg.get("seed"), int) else None,
        "rerun": seg.get("rerun") is True,
        "prompt": {k: str(prompt.get(k) or "") for k in
                   ("summary", "retention", "description", "soundscape")},
        "images": [str(x) for x in (seg.get("images") or [])
                   if isinstance(x, str) and x.strip()],
    }


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
        """阶段3 执行链:解析 timeline_data → DirectorExecutor 逐镜三采。

        空台本(零镜)=空转占位帧(契约不变);计划级错误(缺上游/零勾选)
        =DirectorError 逐镜点名抛出=引擎执行错误面板可见;三采前 /free
        卸载在 executor 首镜进三采时统一做(母本/批量役 stage3 同工艺)。
        返回恒为占位帧(真产物=SaveVideo 落盘链,新形态件画布 CreateVideo
        出口=兜底占位,PRD R1.3 产物走 p1/p2/p3 检查点目录)。
        """
        plan = parse_timeline(timeline_data)
        if not plan["segments"]:
            return (self._placeholder_frame(),)
        from .director_executor import (DirectorError, DirectorExecutor,
                                        bind_engine_hooks)
        try:
            classes, hooks = bind_engine_hooks()
        except DirectorError as err:
            raise RuntimeError(f"导演台执行链装配失败:{err}") from err
        result = DirectorExecutor(classes, hooks).run(
            model, video_vae, audio_vae, clip, plan, unique_id=unique_id)
        _ = result  # 产物经事件(daoyan_artifacts/daoyan_progress)回面板
        return (self._placeholder_frame(),)
