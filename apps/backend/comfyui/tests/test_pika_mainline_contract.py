"""Pika fl2va 主力产线契约测试(1101 用户裁定「主力用 Pika」第一波)。

被测对象 = 仓库真源 `2_视频/H3视频/1_漫影自研/0_单镜视频/pika-单镜视频-fl2v.json`
(1112 吸收归档撤域重组:自 8_吸收归档/ 按类型归位 0_单镜视频,零改名零内容改动)
(26 节点引擎前端格式画布直开)+ 前端 bundle 模板对
`pika-shot-template.json`(同字节)/`pika-shot-template.api.json`(24 节点)。

契约真源 = PikaFlex-FL2VA 官方模板子图(逐字参数)+ 横评 B/D 臂增量:
- 官方契约:UNET=fl2va_pruned_int8_convrot+LoRA pika@1.0+lcm+6-NFE ManualSigmas
- B 臂增量:ModelAttentionBackend=comfy kitchen attention(-9.2%,音频同簇)
- 产线锚点:14.value/20.value/9.image/4.filename_prefix 五段/100 MyShot/16.width+height 直填
- 修正:seed fixed 42(横评口径;官方 randomize 不可复现——grill#8)
- 修正:分辨率 608x352 直填(禁官方 GetImageSize——3668x2048 35倍像素灾难,grill#3)

零引擎依赖纯静态;实弹验收属第二波(候四件模型下载毕)。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LIB = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频"
UI = LIB / "pika-单镜视频-fl2v.json"
FRONTEND_UI = ROOT / "apps/frontend/lib/assist/image-studio/pika-shot-template.json"
FRONTEND_API = ROOT / "apps/frontend/lib/assist/image-studio/pika-shot-template.api.json"

# ── 官方契约(逐字取自 PikaFlex 模板子图)────────────────────────────────
UNET = "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
LORA = "pika_h3_flex_fl2va_comfy_bf16.safetensors"
SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"
SAMPLER = "lcm"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
ATTENTION = "comfy kitchen attention"
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ambient"

EXPECTED_NODE_IDS = {4, 9, 10, 14, 20, 22, 100, 101, 102, 119, 120, 121, 122, 123, 125,
                     126, 127, 128, 129, 130, 131, 132, 133, 134, 140, 143}
NOTE_IDS = {101, 102}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def node(wf: dict, nid: int) -> dict:
    got = [n for n in wf["nodes"] if n["id"] == nid]
    assert len(got) == 1, f"node {nid} not unique"
    return got[0]


def test_ui_node_face():
    wf = load(UI)
    ids = {n["id"] for n in wf["nodes"]}
    assert ids == EXPECTED_NODE_IDS, f"节点面漂移:{sorted(ids ^ EXPECTED_NODE_IDS)}"
    assert len(wf["links"]) == 26, f"链数 {len(wf['links'])} != 26"
    notes = {n["id"] for n in wf["nodes"] if n["type"] == "MarkdownNote"}
    assert notes == NOTE_IDS


def test_ui_official_contract():
    """Pika 官方契约+横评增量。"""
    wf = load(UI)
    assert node(wf, 127)["type"] == "UNETLoader"
    assert node(wf, 127)["widgets_values"][:2] == [UNET, "default"]
    assert node(wf, 134)["type"] == "LoraLoaderModelOnly"
    assert node(wf, 134)["widgets_values"] == [LORA, 1]
    assert node(wf, 123)["widgets_values"] == [SAMPLER]
    assert node(wf, 143)["type"] == "ManualSigmas"
    assert node(wf, 143)["widgets_values"] == [SIGMAS]
    assert node(wf, 129)["widgets_values"] == [42, "fixed"]  # seed42 可复现
    assert node(wf, 140)["widgets_values"] == [ATTENTION]  # B 臂白拿
    vaes = {n["id"]: n["widgets_values"][0] for n in wf["nodes"] if n["type"] == "VAELoader"}
    assert vaes == {119: VIDEO_VAE, 120: AUDIO_VAE}
    assert node(wf, 128)["widgets_values"] == [TE, "minimax", "default"]


def test_ui_anchor_contract():
    """产线锚点契约(与 i2v 族同构)。"""
    wf = load(UI)
    assert node(wf, 14)["type"] == "PrimitiveStringMultiline"
    assert node(wf, 20)["type"] == "PrimitiveFloat"
    assert node(wf, 9)["type"] == "LoadImage"
    assert node(wf, 9).get("mode") == 4  # 首帧出厂旁路
    assert node(wf, 10).get("mode") == 4  # 尾帧出厂旁路
    assert node(wf, 4)["type"] == "SaveVideo"
    assert node(wf, 4)["widgets_values"][0] == FIVE_SEGMENT_PREFIX
    gen = node(wf, 131)
    assert gen["type"] == "MiniMaxH3ImageToVideo"
    assert gen["widgets_values"] == ["", 608, 352, 124]  # 直填 480p 出厂
    myshot = node(wf, 100)
    assert myshot["type"] == "MyShot"
    assert myshot["widgets_values"][:4] == ["S00", "", "", "待生成"]


def test_ui_connectivity():
    """关键路径连通(模型链+生成链+回收链)。"""
    wf = load(UI)
    edges = {(l[1], l[3]) for l in wf["links"]}
    for pair in [(127, 134), (134, 140), (140, 126), (131, 126),
                 (14, 131), (9, 131), (22, 131), (130, 4), (4, 100)]:
        assert pair in edges, f"边 {pair} 缺——关键路径断链"


def test_frontend_bundle_sync():
    """前端 bundle 同字节+API 件全锚。"""
    assert hashlib.md5(UI.read_bytes()).hexdigest() == hashlib.md5(FRONTEND_UI.read_bytes()).hexdigest(), \
        "前端 pika-shot-template.json 与 repo 真源不同字节(重跑生成器同步)"
    api = load(FRONTEND_API)
    assert len(api) == 24, f"API 节点数 {len(api)} != 24"
    n16 = api["131"]
    assert n16["class_type"] == "MiniMaxH3ImageToVideo"
    assert n16["inputs"].get("width") == ["22", 0] and n16["inputs"].get("height") == ["22", 1]  # 组装器档位直填时覆写(N11 同款)
    assert n16["inputs"].get("prompt") == ["14", 0]
    assert n16["inputs"].get("first_frame") == ["9", 0]
    assert "22" in api, "22 ResolutionSelector 应在 API 图"
    assert n16["inputs"].get("length") == ["132", 1]
    assert api["127"]["inputs"]["unet_name"] == UNET
    assert api["134"]["inputs"] == {"lora_name": LORA, "strength_model": 1, "model": ["127", 0]}
    assert api["123"]["inputs"]["sampler_name"] == SAMPLER
    assert api["143"]["inputs"]["sigmas"] == SIGMAS
    assert api["140"]["inputs"]["attention"] == ATTENTION
    assert api["129"]["inputs"].get("noise_seed") == 42
    assert api["129"]["inputs"].get("control_after_generate") == "fixed"
    myshot = api["100"]
    assert myshot["class_type"] == "MyShot"
    for key in ("shot_id", "label", "description", "media_status"):
        assert key in myshot["inputs"], f"100.{key} 缺"
