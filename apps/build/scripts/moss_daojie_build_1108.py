# -*- coding: utf-8 -*-
"""1108 MOSS 道劫产线·幂等生成器(道劫范式 × MOSS-Image)。

产物(确定性字节,重跑恒同):
  1. apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/moss_bases.json
     —— 由 qi21_bases.json 派生:6 透明型+白底句 / 人物海报+挂载服从句 /
        steps_hint→DMD8·原生50 / lora_recipe 清空(Q2.1 配方不迁移)
  2. apps/backend/comfyui/workflows/1_图片/MOSS图像/moss-道劫-t2i.json
     —— 画布件:选型→三层装配(复用 MyQi21PromptAssembly)→双臂采样
        (原生50 观澜+SLG | DMD8)→透明白底抠图腿→SeedVR2 2K 尾档(默认旁路)
  3. 同目录 moss-道劫-t2i-api.json —— 默认臂(原生50)直投模板,注入锚:
     正向→[5].text / 负面→[6].text / seed→[8].seed / 画幅→[7].width/height

用法: python3 moss_daojie_build_1108.py [--dry-run]
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DATA_DIR = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json"
WF_DIR = REPO / "apps/backend/comfyui/workflows/1_图片/MOSS图像"
QI21_BASES = DATA_DIR / "qi21_bases.json"
MOSS_BASES = DATA_DIR / "moss_bases.json"
CANVAS = WF_DIR / "moss-道劫-t2i.json"
API = WF_DIR / "moss-道劫-t2i-api.json"

WHITE_BG_SENTENCE = "\n背景为均匀纯白底色，画面干净空旷，仅主体入画，主体边缘清晰完整，底色平涂无渐变。"  # 1108 透明腿:白底渲染质量已证;alpha 缺陷由 fill_holes+收边软边链治
MOUNT_SENTENCE = ("\n武器挂载规则：主体句写明挂载（腰间或背负）的武器，始终由挂具承担重量、"
                  "保持挂定原位；双手动作完全服从主体句——主体句写持握则持握，写垂落则垂落。")


# ── 产物 1:moss_bases.json ─────────────────────────────────────────
def build_moss_bases() -> dict:
    src = json.loads(QI21_BASES.read_text(encoding="utf-8"))
    out = json.loads(json.dumps(src, ensure_ascii=False))  # 深拷贝
    transparent, touched_white, touched_mount = [], [], []
    for t in out["types"]:
        t["steps_hint"] = {"fast": 8, "quality": 50}   # DMD8 / 原生50 双臂语义
        t["lora_recipe"] = []                          # Q2.1 按型配方不迁移,观澜全局挂
        if t.get("rgba_default"):
            t["positive_text"] = (t.get("positive_text") or "") + WHITE_BG_SENTENCE
            touched_white.append(t["zh"])
        if t["zh"] == "人物海报":
            t["positive_text"] = (t.get("positive_text") or "") + MOUNT_SENTENCE
            touched_mount.append(t["zh"])
    out["rgba"]["_doc"] = ("MOSS 版口径(1108):MOSS-Image=flux2-vae 纯 RGB 输出,英文 RGBA "
                           "头尾包裹退役(p2 实弹=白底伪透明);透明承载=型文白底句+"
                           "「白底转透明」后链(ColorToMask thr32→闭运算 GrowMask3/-5→高斯软边→"
                           "JoinImageWithAlpha);head/tail 仅留档零消费。")
    src_sha = hashlib.sha256(QI21_BASES.read_bytes()).hexdigest()[:16]
    out["moss_variant"] = {
        "engine": "moss_image_sft_bf16", "derived_from": "qi21_bases.json",
        "source_sha256_16": src_sha, "created": "2026-11-08",
        "edits": ["6 透明型+白底句(" + "、".join(touched_white) + ")",
                  "人物海报+挂载服从句(p1 实弹持握弱定向补强)",
                  "steps_hint→{fast:8(DMD),quality:50(原生)}", "lora_recipe 清空"],
    }
    assert len(touched_white) == 6, f"透明型应 6 实 {len(touched_white)}"
    assert touched_mount == ["人物海报"]
    return out


# ── 画布构造小件 ────────────────────────────────────────────────────
def _node(nid, ntype, pos, size, widgets=None, named=None, inputs=None, outputs=None,
          order=0, wv_linkslots=()):
    n = {"id": nid, "type": ntype, "pos": pos, "size": size, "flags": {},
         "order": order, "mode": 0,
         "inputs": inputs or [], "outputs": outputs or [],
         "properties": {"Node name for S&R": ntype}}
    if widgets is not None:
        n["widgets_values"] = widgets
        if named:
            n["widgets_values_named"] = named
    return n


def _in(name, ntype, link):
    return {"name": name, "type": ntype, "link": link}


def _out(name, ntype, links, slot=0):
    return {"name": ntype if False else name, "type": ntype, "links": links, "slot_index": slot}


# ── 产物 2:画布件 ──────────────────────────────────────────────────
def build_canvas(subject_example: str, style_base: str) -> dict:
    L = []  # [id, from, fromslot, to, toslot, type]

    def link(f, fs, t, ts, ty):
        L.append([len(L) + 1, f, fs, t, ts, ty])
        return len(L)

    nodes = []
    # — 提示词装配组 —
    nodes.append(_node(1, "MyMossDaojieBase", [0, 0], [340, 200], widgets=["人物海报"],
                       named={"base": "人物海报"},
                       outputs=[_out("BASE", "STRING", []), _out("WIDTH", "INT", [], 1),
                                _out("HEIGHT", "INT", [], 2), _out("负面词", "STRING", [], 3),
                                _out("透明值", "BOOLEAN", [], 4), _out("型名", "STRING", [], 5)]))
    nodes.append(_node(2, "PrimitiveStringMultiline", [0, 260], [420, 220],
                       widgets=[subject_example], named={"value": subject_example},
                       outputs=[_out("STRING", "STRING", [])]))
    nodes.append(_node(3, "PrimitiveStringMultiline", [0, 520], [420, 200],
                       widgets=[style_base], named={"value": style_base},
                       outputs=[_out("STRING", "STRING", [])]))
    nodes.append(_node(4, "MyQi21PromptAssembly", [480, 0], [420, 260],
                       widgets=["道劫美术类型"], named={"组装用途": "道劫美术类型"},
                       inputs=[], outputs=[_out("装配全文", "STRING", []),
                                           _out("负面词", "STRING", [], 1)]))
    nodes.append(_node(5, "MyQi21PromptPreview", [480, 300], [420, 160],
                       inputs=[], outputs=[]))
    nodes.append(_node(6, "CLIPLoader", [480, 520], [340, 100],
                       widgets=["qwen3.5_9b_bf16.safetensors", "moss_image", "default"],
                       named={"clip_name": "qwen3.5_9b_bf16.safetensors",
                              "type": "moss_image", "device": "default"},
                       outputs=[_out("CLIP", "CLIP", [])]))
    nodes.append(_node(7, "CLIPTextEncode", [960, 520], [400, 200], widgets=[""],
                       inputs=[], outputs=[_out("CONDITIONING", "CONDITIONING", [])]))
    nodes.append(_node(8, "CLIPTextEncode", [960, 760], [400, 140], widgets=[""],
                       inputs=[], outputs=[_out("CONDITIONING", "CONDITIONING", [], 1)]))
    # — 模型·双臂组 —
    nodes.append(_node(9, "EmptyFlux2LatentImage", [1440, 760], [300, 120],
                       widgets=[1, 1, 1], named={"width": 1, "height": 1, "batch_size": 1},
                       inputs=[], outputs=[_out("LATENT", "LATENT", [])]))
    nodes.append(_node(10, "UNETLoader", [1440, 0], [340, 100],
                       widgets=["moss_image_sft_bf16.safetensors", "default"],
                       named={"unet_name": "moss_image_sft_bf16.safetensors", "weight_dtype": "default"},
                       outputs=[_out("MODEL", "MODEL", [])]))
    nodes.append(_node(11, "LoraLoaderModelOnly", [1830, 0], [380, 110],
                       widgets=["KOOK-MOSS-SFT-观澜.safetensors", 1.0],
                       named={"lora_name": "KOOK-MOSS-SFT-观澜.safetensors", "strength_model": 1.0},
                       inputs=[_in("model", "MODEL", None)],
                       outputs=[_out("MODEL", "MODEL", [])]))
    nodes.append(_node(12, "SkipLayerGuidanceDiTSimple", [1830, 150], [380, 140],
                       widgets=["", "22", 0.0, 0.5],
                       named={"double_layers": "", "single_layers": "22",
                              "start_percent": 0.0, "end_percent": 0.5},
                       inputs=[_in("model", "MODEL", None)],
                       outputs=[_out("MODEL", "MODEL", [])]))
    nodes.append(_node(13, "KSampler", [2220, 0], [340, 280],
                       widgets=[1108, "fixed", 50, 3.5, "er_sde", "simple", 1.0],
                       named={"seed": 1108, "control_after_generate": "fixed", "steps": 50,
                              "cfg": 3.5, "sampler_name": "er_sde", "scheduler": "simple",
                              "denoise": 1.0},
                       inputs=[], outputs=[_out("LATENT", "LATENT", [])]))
    nodes.append(_node(14, "LoraLoaderModelOnly", [1830, 340], [380, 110],
                       widgets=["MOSS-SFT-DMD-8step-lodestones.safetensors", 1.0],
                       named={"lora_name": "MOSS-SFT-DMD-8step-lodestones.safetensors",
                              "strength_model": 1.0},
                       inputs=[_in("model", "MODEL", None)],
                       outputs=[_out("MODEL", "MODEL", [], 1)]))
    nodes.append(_node(15, "SkipLayerGuidanceDiTSimple", [1830, 490], [380, 140],
                       widgets=["", "22", 0.0, 0.0],
                       named={"double_layers": "", "single_layers": "22",
                              "start_percent": 0.0, "end_percent": 0.0},
                       inputs=[_in("model", "MODEL", None)],
                       outputs=[_out("MODEL", "MODEL", [])]))
    nodes.append(_node(16, "KSampler", [2220, 340], [340, 280],
                       widgets=[1108, "fixed", 8, 1.0, "euler", "simple", 1.0],
                       named={"seed": 1108, "control_after_generate": "fixed", "steps": 8,
                              "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
                              "denoise": 1.0},
                       inputs=[], outputs=[_out("LATENT", "LATENT", [], 1)]))
    nodes.append(_node(17, "PrimitiveBoolean", [1440, 920], [260, 80],
                       widgets=[False], named={"value": False},
                       outputs=[_out("BOOLEAN", "BOOLEAN", [])]))
    nodes.append(_node(18, "ComfySwitchNode", [2620, 160], [260, 140],
                       inputs=[_in("switch", "BOOLEAN", None), _in("on_false", "*", None),
                               _in("on_true", "*", None)],
                       outputs=[_out("*", "*", [])]))
    # — 解码·透明组 —
    nodes.append(_node(20, "VAELoader", [2620, 520], [300, 80],
                       widgets=["flux2-vae.safetensors"], named={"vae_name": "flux2-vae.safetensors"},
                       outputs=[_out("VAE", "VAE", [])]))
    nodes.append(_node(21, "VAEDecode", [2980, 160], [300, 110],
                       inputs=[_in("samples", "LATENT", None), _in("vae", "VAE", None)],
                       outputs=[_out("IMAGE", "IMAGE", [])]))
    nodes.append(_node(22, "ColorToMask", [2980, 320], [340, 170],
                       widgets=[False, 255, 255, 255, 32, 1],
                       named={"invert": False, "red": 255, "green": 255, "blue": 255,
                              "threshold": 32, "per_batch": 1},
                       inputs=[_in("images", "IMAGE", None)],
                       outputs=[_out("MASK", "MASK", [])]))
    nodes.append(_node(23, "GrowMask", [2980, 530], [240, 110],
                       widgets=[3, True], named={"expand": 3, "tapered_corners": True},
                       inputs=[_in("mask", "MASK", None)],
                       outputs=[_out("MASK", "MASK", [], 1)]))  # 闭运算 1/2 膨胀(与 24 合成闭运算,填主体小洞)
    nodes.append(_node(24, "GrowMask", [2980, 670], [240, 110],
                       widgets=[-5, True], named={"expand": -5, "tapered_corners": True},
                       inputs=[_in("mask", "MASK", None)],
                       outputs=[_out("MASK", "MASK", [])]))  # 闭运算 2/2 腐蚀收边(治白晕,净收 2px)
    nodes.append(_node(27, "ImpactGaussianBlurMask", [2980, 810], [280, 110],
                       widgets=[3, 1.0], named={"kernel_size": 3, "sigma": 1.0},
                       inputs=[_in("mask", "MASK", None)],
                       outputs=[_out("MASK", "MASK", [], 1)]))  # 高斯软边(抗锯齿;1108 AB/C 三链同图实验胜出版)
    nodes.append(_node(25, "JoinImageWithAlpha", [2980, 960], [300, 100],
                       inputs=[_in("image", "IMAGE", None), _in("alpha", "MASK", None)],
                       outputs=[_out("IMAGE", "IMAGE", [])]))
    nodes.append(_node(26, "ComfySwitchNode", [3340, 480], [260, 140],
                       inputs=[_in("switch", "BOOLEAN", None), _in("on_false", "*", None),
                               _in("on_true", "*", None)],
                       outputs=[_out("*", "*", [], 1)]))
    # — 超分·SeedVR2 2K 尾档组(默认旁路) —
    nodes.append(_node(30, "SeedVR2LoadDiTModel", [3700, 0], [400, 190],
                       widgets=["seedvr2_7b_sharp_fp8_e4m3fn.safetensors", "cuda:0", 36, False,
                                "cpu", False, "sdpa"],
                       named={"model": "seedvr2_7b_sharp_fp8_e4m3fn.safetensors", "device": "cuda:0",
                              "blocks_to_swap": 36, "swap_io_components": False,
                              "offload_device": "cpu", "cache_model": False,
                              "attention_mode": "sdpa"},
                       outputs=[_out("SEEDVR2_DIT", "SEEDVR2_DIT", [])]))
    nodes.append(_node(31, "SeedVR2LoadVAEModel", [3700, 230], [400, 250],
                       widgets=["ema_vae_fp16.safetensors", "cuda:0", True, 512, 160, True, 512,
                                160, "false", "none", False],
                       named={"model": "ema_vae_fp16.safetensors", "device": "cuda:0",
                              "encode_tiled": True, "encode_tile_size": 512,
                              "encode_tile_overlap": 160, "decode_tiled": True,
                              "decode_tile_size": 512, "decode_tile_overlap": 160,
                              "tile_debug": "false", "offload_device": "none",
                              "cache_model": False},
                       outputs=[_out("SEEDVR2_VAE", "SEEDVR2_VAE", [])]))
    nodes.append(_node(32, "SeedVR2VideoUpscaler", [4140, 0], [360, 300],
                       widgets=[0, "fixed", 2048, 0, 1, False, "lab", 0, 0, 0.0, 0.0, "none", False],
                       named={"seed": 0, "control_after_generate": "fixed", "resolution": 2048,
                              "max_resolution": 0, "batch_size": 1,
                              "uniform_batch_size": False, "color_correction": "lab",
                              "temporal_overlap": 0, "prepend_frames": 0,
                              "input_noise_scale": 0.0, "latent_noise_scale": 0.0,
                              "offload_device": "none", "enable_debug": False},
                       inputs=[_in("image", "IMAGE", None), _in("dit", "SEEDVR2_DIT", None),
                               _in("vae", "SEEDVR2_VAE", None)],
                       outputs=[_out("IMAGE", "IMAGE", [], 2)]))
    nodes.append(_node(33, "PrimitiveBoolean", [3700, 520], [260, 80],
                       widgets=[False], named={"value": False},
                       outputs=[_out("BOOLEAN", "BOOLEAN", [], 1)]))
    nodes.append(_node(34, "ComfySwitchNode", [4560, 120], [260, 140],
                       inputs=[_in("switch", "BOOLEAN", None), _in("on_false", "*", None),
                               _in("on_true", "*", None)],
                       outputs=[_out("*", "*", [], 2)]))
    nodes.append(_node(35, "SaveImage", [4880, 120], [340, 110],
                       widgets=["moss_daojie/"], named={"filename_prefix": "moss_daojie/"},
                       inputs=[_in("images", "IMAGE", None)], outputs=[]))
    note = _node(36, "MarkdownNote", [0, 780], [460, 420], widgets=[NOTE_TEXT])
    nodes.append(note)

    by_id = {n["id"]: n for n in nodes}

    def wire(f, fs, t, ts, ty, iname):
        lid = link(f, fs, t, ts, ty)
        by_id[t]["inputs"] = [x for x in by_id[t]["inputs"] if x["name"] != iname]
        by_id[t]["inputs"].append(_in(iname, ty, lid))
        by_id[f]["outputs"][fs]["links"] = (by_id[f]["outputs"][fs].get("links") or []) + [lid]

    # 装配:1→4, 2→4, 3→4, 4→5/7/8, 6→7/8
    wire(1, 0, 4, 0, "STRING", "BASE")
    wire(1, 3, 4, 0, "STRING", "BASE负面")
    wire(2, 0, 4, 0, "STRING", "主体句")
    wire(3, 0, 4, 0, "STRING", "锁层A全文")
    wire(4, 0, 5, 0, "STRING", "正向提示词")
    wire(4, 1, 5, 0, "STRING", "负向提示词")
    wire(4, 0, 7, 0, "STRING", "text")
    wire(6, 0, 7, 0, "CLIP", "clip")
    wire(4, 1, 8, 0, "STRING", "text")
    wire(6, 0, 8, 0, "CLIP", "clip")
    # 画幅/双臂
    wire(1, 1, 9, 0, "INT", "width")
    wire(1, 2, 9, 0, "INT", "height")
    wire(10, 0, 11, 0, "MODEL", "model")
    wire(11, 0, 12, 0, "MODEL", "model")
    wire(10, 0, 14, 0, "MODEL", "model")
    wire(14, 0, 15, 0, "MODEL", "model")
    wire(12, 0, 13, 0, "MODEL", "model")
    wire(7, 0, 13, 0, "CONDITIONING", "positive")
    wire(8, 0, 13, 0, "CONDITIONING", "negative")
    wire(9, 0, 13, 0, "LATENT", "latent_image")
    wire(15, 0, 16, 0, "MODEL", "model")
    wire(7, 0, 16, 0, "CONDITIONING", "positive")
    wire(8, 0, 16, 0, "CONDITIONING", "negative")
    wire(9, 0, 16, 0, "LATENT", "latent_image")
    wire(17, 0, 18, 0, "BOOLEAN", "switch")
    wire(13, 0, 18, 0, "LATENT", "on_false")
    wire(16, 0, 18, 0, "LATENT", "on_true")
    # 解码/透明腿
    wire(18, 0, 21, 0, "LATENT", "samples")
    wire(20, 0, 21, 0, "VAE", "vae")
    wire(21, 0, 22, 0, "IMAGE", "images")
    wire(22, 0, 23, 0, "MASK", "mask")
    wire(23, 0, 24, 0, "MASK", "mask")
    wire(24, 0, 27, 0, "MASK", "mask")
    wire(21, 0, 25, 0, "IMAGE", "image")
    wire(27, 0, 25, 0, "MASK", "alpha")
    wire(1, 4, 26, 0, "BOOLEAN", "switch")
    wire(21, 0, 26, 0, "IMAGE", "on_false")
    wire(25, 0, 26, 0, "IMAGE", "on_true")
    # 超分尾档
    wire(26, 0, 32, 0, "IMAGE", "image")
    wire(30, 0, 32, 0, "SEEDVR2_DIT", "dit")
    wire(31, 0, 32, 0, "SEEDVR2_VAE", "vae")
    wire(33, 0, 34, 0, "BOOLEAN", "switch")
    wire(26, 0, 34, 0, "IMAGE", "on_false")
    wire(32, 0, 34, 0, "IMAGE", "on_true")
    wire(34, 0, 35, 0, "IMAGE", "images")

    groups = [
        {"id": 1, "title": "① 型库·三层装配(MOSS 版 moss_bases.json)", "bounding": [-20, -60, 920, 800], "color": "#3f789e", "flags": {}},
        {"id": 2, "title": "② 模型·双臂(原生50·观澜+SLG | DMD8步)", "bounding": [1410, -60, 1180, 1120], "color": "#88A", "flags": {}},
        {"id": 3, "title": "③ 解码·白底转透明腿(MOSS 无 alpha,抠图造)", "bounding": [2590, -60, 780, 1060], "color": "#a33", "flags": {}},
        {"id": 4, "title": "④ SeedVR2 2K 尾档(默认旁路)", "bounding": [3670, -60, 1290, 660], "color": "#4a7", "flags": {}},
    ]
    nodes.sort(key=lambda n: n["order"])
    return {"last_node_id": 37, "last_link_id": len(L), "nodes": nodes, "links": L,
            "groups": groups, "config": {}, "extra": {}, "version": 0.4, "revision": 0}


NOTE_TEXT = """## MOSS 道劫 t2i(道劫范式 × MOSS-Image,1108 役)

- **型库=moss_bases.json**(由 qi21_bases.json 派生:6 透明型已带白底句;人物海报带挂载服从句;装配节点 MyQi21PromptAssembly 直复用)
- **双臂**:左 False=原生臂 50步/CFG3.5/er_sde+观澜@1.0+SLG22(0-0.5);True=DMD 臂 8步/CFG1.0/euler+DMD LoRA@1.0+SLG end0(勿混:DMD 禁高 CFG)
- **透明型**(道具/多视图/高清人脸/表情差分/人脸基准/无衣物定妆):MOSS=flux2-vae 纯 RGB,型文白底句+「白底转透明」腿(ColorToMask thr32→GrowMask+3/-5 闭运算→ImpactGaussianBlurMask 软边→JoinImageWithAlpha)按型自动启停;GrowMaskWithBlur 接口坑避雷
- **SeedVR2 2K 尾档**默认旁路;Win 参数(seedvr2_7b_sharp_fp8/swap36/cuda)
- 模型:moss_image_sft_bf16 + qwen3.5_9b_bf16(moss_image) + flux2-vae(Windows 引擎在位)
- 例句=道劫 05 库例一(女修·剑在鞘·手部三锁段);门禁与色词纪律同 qi21 线(docs/prompts/道劫_类型主体句示例.md)
- 已知特性(1108 p1 实弹):MOSS 对持械挂载动词服从弱于 Q2.1——人物持械海报仍建议走 Q2.1 线,本线主打文字/道具/场景/透明资产"""


# ── 产物 3:API 直投模板(默认臂) ────────────────────────────────────
def build_api() -> dict:
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "moss_image_sft_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": "KOOK-MOSS-SFT-观澜.safetensors", "strength_model": 1.0}},
        "3": {"class_type": "SkipLayerGuidanceDiTSimple", "inputs": {"model": ["2", 0], "double_layers": "", "single_layers": "22", "start_percent": 0.0, "end_percent": 0.5}},
        "4": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3.5_9b_bf16.safetensors", "type": "moss_image", "device": "default"}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 0]}},
        "7": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": 1088, "height": 1456, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {"model": ["3", 0], "seed": 1108, "steps": 50, "cfg": 3.5, "sampler_name": "er_sde", "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0], "denoise": 1.0}},
        "9": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["9", 0]}},
        "11": {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": "moss_daojie/"}},
        "_doc": "MOSS 道劫直投模板(原生臂)。注入锚:正向→5.text / 负面→6.text / seed→8.seed / 画幅→7.width+7.height。DMD 臂与透明腿直投请走发车器。",
    }


def main() -> int:
    dry = "--dry-run" in sys.argv
    bases = build_moss_bases()
    style_base = bases["art_style_base"]["positive_text"]
    subject = ("一位筑基后期的年轻女修，青玉色道袍束月白腰带，足蹬青布道履，乌黑长发半束只簪一支素银簪，"
               "眉目沉静中带一点锋芒；她立于山门赭石石阶最上一级，身体正面朝向观者、微向左转约四分之一侧，"
               "重心落于右腿，左脚虚点下一级石阶，左臂自然垂落、左手五指放松；长剑以石青剑绦系于画面左侧腰间，"
               "剑鞘斜垂、与地面约呈四十五度，鞘尾朝画面左下方、剑柄朝画面右上方，乌木剑鞘、白玉剑格、剑柄缠灰银丝、"
               "鞘口垂暗红剑穗，剑身完整收在鞘中，全身仅此一柄长剑、始终挂定腰间；右臂自然垂落、右肘微屈，"
               "右手虚握挂定的剑鞘上端三分之一处、五指环拢鞘身，剑身重量仍由腰间剑绦承担；"
               "视线越过阶下青灰云海望向远处青绿群山，旧金色晨光自左侧斜照，衣袂被山风微微掀起。")
    canvas = build_canvas(subject, style_base)
    api = build_api()
    if dry:
        print("[DRY] 将写:")
        for p, obj in [(MOSS_BASES, bases), (CANVAS, canvas), (API, api)]:
            n = (len(obj["types"]), "types") if "types" in obj else (
                (len(obj["nodes"]), "nodes") if "nodes" in obj else (len(obj), "键"))
            print(f"  {p.relative_to(REPO)}  ({n[0]} {n[1]})")
        return 0
    MOSS_BASES.write_text(json.dumps(bases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    CANVAS.write_text(json.dumps(canvas, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    API.write_text(json.dumps(api, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK moss_bases.json types={len(bases['types'])}")
    print(f"OK moss-道劫-t2i.json nodes={len(canvas['nodes'])} links={len(canvas['links'])}")
    print(f"OK moss-道劫-t2i-api.json nodes={len(api)-1}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
