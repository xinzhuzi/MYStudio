"""FastH3 二采超分(横评质量王 W6)契约测试(10-28 fasth3-upscale-shootout 用户终审转正)。

被测对象 = 仓库真源 `2_视频/H3视频/3_超分后处理/fasth3-二采超分-2x.json`
(API 直发格式,LoadVideo 吃现成视频文件=任意 FastH3 480p 产物)。

出身 = 10-28 超分全方案横评 W6 胜者件逐字节入库(实跑原文,引擎 execution
82e1f43d 一次过,1499.4s/1216×704/RTX 4060Ti 8G 实弹);用户终审「Fasth3 二采 W6 最好」。
技术档案:横评产物集 apps/output/fasth3-upscale-shootout-1028/fasth3-ercai/
(对拍图 compare/);全档 .trellis/tasks/10-28-fasth3-upscale/。

链路契约:LoadVideo → VAEEncode(FastH3 int8 VAE) → MinimaxH3LatentUpscaler3D
(LBH 3D latent 上采样 target 1216×704) → 零值音轨包裹三节点
(20 EmptyMiniMaxH3LatentAV / 21 LTXVSeparateAVLatent / 22 LTXVConcatAVLatent,
W6 R1 实弹病根修复:MiniMaxH3 采样器 audio_src IndexError 无音轨必炸) →
SamplerCustomAdvanced(FastH3 8步 res_multistep 浅 sigma denoise 0.45 二采) →
VAEDecode → CreateVideo → SaveVideo。

三对齐(引擎侧 W6 测手已装并验证注册,Windows 引擎 17000):
    R1 DiT=fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors
    TE=qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
    视频 VAE=minimax_h3_video_vae_int8_convrot.safetensors
    LBH 上采样器=minimax_h3_latent_upscaler_3d_bf16.safetensors(659M,
    ComfyUI/models/latent_upscale_models/ ——顶层 models/ 对引擎不可见,
    必须在 ComfyUI 子目录,横评 W6/W7 同坑实证)

零引擎依赖纯静态;快照 fixtures/fasth3_object_info_snapshot.json 复用主线役
(22 类 Windows 引擎实况)。LBH 类不在快照内属预期(快照裁剪时 LBH 未装),
其注册证据=横评 W6 装件档 /object_info/MinimaxH3LatentUpscaler3D 200。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LIB = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/3_超分后处理"
WF = LIB / "fasth3-二采超分-2x.json"
SNAPSHOT = Path(__file__).resolve().parent / "fixtures/fasth3_object_info_snapshot.json"

R1_DIT = "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"
R4_TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
R2_VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
R5_LBH = "minimax_h3_latent_upscaler_3d_bf16.safetensors"

TARGET_W, TARGET_H = 1216, 704
DENOISE = 0.45

EXPECTED_NODES = {
    "1": "LoadVideo",
    "2": "GetVideoComponents",
    "3": "UNETLoader",
    "4": "CLIPLoader",
    "5": "VAELoader",
    "6": "MiniMaxH3SigmaShift",
    "7": "ModelAttentionBackend",
    "8": "BlockSparseAttention",
    "9": "VAEEncode",
    "10": "MinimaxH3LatentUpscaler3D",
    "11": "BasicScheduler",
    "12": "BasicGuider",
    "13": "MiniMaxH3ImageToVideo",
    "14": "RandomNoise",
    "15": "KSamplerSelect",
    "16": "SamplerCustomAdvanced",
    "17": "VAEDecode",
    "18": "CreateVideo",
    "19": "SaveVideo",
    "20": "EmptyMiniMaxH3LatentAV",
    "21": "LTXVSeparateAVLatent",
    "22": "LTXVConcatAVLatent",
}

EXPECTED_EDGES = {
    ("1", "2"),  # LoadVideo→GetVideoComponents
    ("2", "9"),  # pixels→VAEEncode
    ("2", "18"),  # fps→CreateVideo(源帧率直通)
    ("9", "10"),  # 编码 latent→LBH 3D 上采样
    ("10", "22"),  # 上采样 video latent→Concat(音轨包裹)
    ("20", "21"),  # 零值 AV→Separate(取零值 audio)
    ("21", "22"),  # 零值 audio→Concat(包裹成 AV 双流)
    ("22", "16"),  # 包裹后 AV latent→采样器(W6 R1 病根修复链)
    ("16", "17"),  # 采样→解码
    ("17", "18"),  # 解码→CreateVideo
    ("18", "19"),  # →SaveVideo
    ("3", "6"),  # DiT→SigmaShift→注意力链(6→7→8→11/12)
    ("13", "12"),  # 条件→Guider(TE/VAE 喂 13)
}


def load():
    return json.loads(WF.read_text(encoding="utf-8"))


def nodes_by_type(doc: dict) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for nid, spec in doc.items():
        out.setdefault(spec["class_type"], []).append(nid)
    return out


def test_library_file_exists_with_expected_shape():
    assert WF.exists(), f"缺库件:{WF}"
    doc = load()
    assert len(doc) == 22, f"节点数漂移:{len(doc)}(契约=22)"
    for nid, ct in EXPECTED_NODES.items():
        assert doc[nid]["class_type"] == ct, f"节点 {nid} 类型漂移:{doc[nid]['class_type']}≠{ct}"


def test_model_references_match_alignment_table():
    doc = load()
    assert doc["3"]["inputs"]["unet_name"] == R1_DIT
    assert doc["4"]["inputs"]["clip_name"] == R4_TE
    assert doc["5"]["inputs"]["vae_name"] == R2_VIDEO_VAE
    assert doc["10"]["inputs"]["model_name"] == R5_LBH


def test_upscale_sampling_contract_is_pinned():
    doc = load()
    lbh = doc["10"]["inputs"]
    assert lbh["mode"] == "target dimensions"
    assert lbh["mode.width"] == TARGET_W and lbh["mode.height"] == TARGET_H
    assert lbh["align"] == 32 and lbh["enable_temporal_chunking"] is True
    assert doc["11"]["inputs"]["denoise"] == DENOISE, "浅 sigma 二采档漂移(契约=0.45)"
    # 零值音轨包裹三节点规格与上采样目标同构
    empty = doc["20"]["inputs"]
    assert (empty["width"], empty["height"], empty["length"]) == (TARGET_W, TARGET_H, 124)


def test_audio_wrap_trio_present_and_wired():
    """W6 R1 实弹病根修复契约:无音轨包裹,MiniMaxH3 采样器 audio_src 必炸。"""
    doc = load()
    for nid, ct in (("20", "EmptyMiniMaxH3LatentAV"), ("21", "LTXVSeparateAVLatent"), ("22", "LTXVConcatAVLatent")):
        assert doc[nid]["class_type"] == ct, f"音轨包裹件 {nid} 缺失/漂移"


def test_edge_skeleton():
    doc = load()
    edges = set()
    for nid, spec in doc.items():
        for v in spec.get("inputs", {}).values():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                edges.add((v[0], nid))
    missing = EXPECTED_EDGES - edges
    assert not missing, f"骨架连线缺失:{sorted(missing)}"


def test_all_node_classes_registered_on_windows_engine():
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    known = set(snap)
    # 快照(主线役裁剪 22 类)之后,横评役装件并验证注册的类(证据=各测手 /object_info 档):
    #   VHS 两件=W2 装件档;LBH 三件(含 EmptyAV)=W6 装件档 /object_info/MinimaxH3LatentUpscaler3D 200;
    #   LTXV Separate/Concat=ComfyUI 原生 core;GetVideoComponents/VAEEncode=core(快照未收录非未注册)。
    installed_later = {
        "LoadVideo", "GetVideoComponents", "VAEEncode",
        "MinimaxH3LatentUpscaler3D", "EmptyMiniMaxH3LatentAV",
        "LTXVSeparateAVLatent", "LTXVConcatAVLatent",
    }
    doc = load()
    unregistered = {spec["class_type"] for spec in doc.values()} - known - installed_later
    assert not unregistered, f"Windows 引擎未注册类:{sorted(unregistered)}"
