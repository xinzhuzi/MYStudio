"""SeedVR2 4x 超分(横评 4x 档质量王 W1)契约测试(10-28 fasth3-upscale-shootout 用户终审转正)。

被测对象 = 仓库真源 `2_视频/H3视频/3_超分后处理/seedvr2-超分-4x.json`(API 直发格式)。

出身 = 10-28 超分全方案横评 W1 4x 附档胜者件逐字节入库(实跑原文,引擎 execution
12bf7bb6,engine 12779.7s/墙钟 12780.58s → 2432×1408,RTX 4060Ti 8G 实弹显存峰
7884MiB=卡容 96.4% 零 OOM);用户终审「4x 总览与 4x 中心细节 SeedVR2 最好」。
与 2x 档质量王 fasth3-二采超分-2x.json(test_fasth3_upscale_contract.py)构成
双档双王:2x=1216×704 走 FastH3 二采,4x=2432×1408 走 SeedVR2。

链路契约(7 节点极简链):LoadVideo → GetVideoComponents → SeedVR2LoadDiTModel
(7B sharp fp8 + blocks_to_swap 36 + offload cpu=W1 R2 实弹修复:BlockSwap 开而
offload none 必炸 ValueError) → SeedVR2LoadVAEModel(ema fp16) →
SeedVR2VideoUpscaler(resolution=1408 短边口径→2432×1408,batch 5/temporal_overlap 3,
lab 色彩校正,seed 42) → CreateVideo → SaveVideo。

三对齐(引擎侧 W1 测手横评期已装 seedvr2_videoupscaler 节点包并验证 9 节点注册,
权重双档在盘):DiT=seedvr2_7b_sharp_fp8_e4m3fn.safetensors(7.68G)/
VAE=ema_vae_fp16.safetensors。

零引擎依赖纯静态;SeedVR2* 类不在 fasth3 快照(22 类)内属预期——注册证据=
W1 装件档 /object_info 九节点(隧道 17005 实跑)。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LIB = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/3_超分后处理"
WF = LIB / "seedvr2-超分-4x.json"

SEEDVR2_DIT = "seedvr2_7b_sharp_fp8_e4m3fn.safetensors"
SEEDVR2_VAE = "ema_vae_fp16.safetensors"
RESOLUTION_SHORT_EDGE = 1408  # 短边口径:608×352 源 → 2432×1408

EXPECTED_NODES = {
    "1": "LoadVideo",
    "2": "GetVideoComponents",
    "3": "SeedVR2LoadDiTModel",
    "4": "SeedVR2LoadVAEModel",
    "5": "SeedVR2VideoUpscaler",
    "6": "CreateVideo",
    "7": "SaveVideo",
}

EXPECTED_EDGES = {
    ("1", "2"),
    ("2", "5"),  # pixels→Upscaler
    ("2", "6"),  # fps→CreateVideo(源帧率直通)
    ("3", "5"),
    ("4", "5"),
    ("5", "6"),
    ("6", "7"),
}


def load():
    return json.loads(WF.read_text(encoding="utf-8"))


def test_library_file_exists_with_expected_shape():
    assert WF.exists(), f"缺库件:{WF}"
    doc = load()
    assert len(doc) == 7, f"节点数漂移:{len(doc)}(契约=7)"
    for nid, ct in EXPECTED_NODES.items():
        assert doc[nid]["class_type"] == ct, f"节点 {nid} 类型漂移:{doc[nid]['class_type']}≠{ct}"


def test_model_references_match_alignment_table():
    doc = load()
    assert doc["3"]["inputs"]["model"] == SEEDVR2_DIT
    assert doc["4"]["inputs"]["model"] == SEEDVR2_VAE


def test_4x_sampling_and_offload_contract_is_pinned():
    doc = load()
    dit = doc["3"]["inputs"]
    # W1 R2 实弹修复契约:BlockSwap 开(blocks_to_swap=36)而 offload none 必炸
    assert dit["blocks_to_swap"] == 36, "块交换档漂移(契约=36,8G 卡显存账)"
    assert dit["offload_device"] == "cpu", "DiT offload 漂移(契约=cpu,W1 R2 修复)"
    up = doc["5"]["inputs"]
    assert up["resolution"] == RESOLUTION_SHORT_EDGE, "目标分辨率漂移(契约=1408 短边)"
    assert up["batch_size"] == 5 and up["temporal_overlap"] == 3
    assert up["color_correction"] == "lab"
    assert up["seed"] == 42


def test_edge_skeleton():
    doc = load()
    edges = set()
    for nid, spec in doc.items():
        for v in spec.get("inputs", {}).values():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                edges.add((v[0], nid))
    missing = EXPECTED_EDGES - edges
    assert not missing, f"骨架连线缺失:{sorted(missing)}"
