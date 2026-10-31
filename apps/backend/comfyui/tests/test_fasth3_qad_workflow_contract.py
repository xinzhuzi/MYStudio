"""Windows FastH3 QAD R2V 参考线契约测试(10-31 rtx-pro-4000 换卡役)。

被测对象 = 仓库真源件 `2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-r2v.json`
(30 节点,引擎前端格式画布直开)+ 前端 bundle 模板对
`fasth3-ref-shot-template.json`(与 repo 件同字节)/`fasth3-ref-shot-template.api.json`(26 节点)。

契约真源 = FastVideo/FastH3-Omni-NVFP4-QAD-Comfy 官方 README+VALIDATION(魔搭镜像实拉
2026-10-31:8 步/Euler/simple/guidance 1.0/shift[12,3]/MiniMaxH3ReferenceToVideo/NVFP4 需
Blackwell)+ 三对齐表 Q1-Q4(生成器 apps/build/scripts/fasth3_qad_workflows_1031.py 头注)。
母体 = apps/frontend/lib/assist/image-studio/h3-shot-template-ref2va.json(34 节点 Mac R2V
骨架)四删(3 SplitSigmas/17 ModelPreviewOverrideKJ/43 SolAttnPatch/48 T8块缓存)换芯。

节点账:母体 34 − 4 删 = 30 节点/30 链;API 件 = 30 − 4 MarkdownNote = 26 节点。

夹具 fixtures/fasth3_qad_object_info_snapshot.json = Win 夹具(10-27 快照 22 类)+
Mac 引擎(17001)MiniMaxH3ReferenceToVideo(原生节点 0.36+,键序稳定)合并;QAD 件 Win 引擎
实弹验收(三层硬门+NVFP4 内核+TE reference-vision)属下一阶段,本测试零引擎依赖纯静态。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LIB = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频"
R2V = LIB / "fasth3-单镜视频-r2v.json"
FRONTEND_UI = ROOT / "apps/frontend/lib/assist/image-studio/fasth3-ref-shot-template.json"
FRONTEND_API = ROOT / "apps/frontend/lib/assist/image-studio/fasth3-ref-shot-template.api.json"

# ── 三对齐表 Q1-Q4(文件名逐字符契约;引擎侧并行核账同名件,错一格接不上)─────────────
Q1_DIT = "fasth3_omniref_qad_nvfp4_comfy.safetensors"           # 13,773,998,700B 已落 Win(1030 役)
Q2_TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"           # 1027 役 R4 已在位
Q3_VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
Q4_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ambient"

EXPECTED_NODE_IDS = {2, 4, 6, 7, 8, 9, 13, 14, 16, 20, 21, 22, 23, 26, 29, 31, 32, 33, 34,
                     36, 37, 40, 42, 47, 100, 101, 110, 111, 112, 113}
NOTE_IDS = {31, 32, 47, 101}
DELETED_NODE_IDS = {3, 17, 43, 48}  # SplitSigmas/ModelPreviewOverrideKJ/SolAttnPatch/T8

# 有向边 (origin_id, target_id, type);同对多边用多重集合语义(22→16 INT×2)
EXPECTED_EDGES = {
    ("34", "42", "MODEL"), ("42", "40", "MODEL"), ("40", "8", "MODEL"), ("40", "33", "MODEL"),
    ("8", "26", "SIGMAS"), ("37", "26", "NOISE"), ("33", "26", "GUIDER"), ("29", "26", "SAMPLER"),
    ("16", "26", "LATENT"), ("16", "33", "CONDITIONING"),
    ("21", "16", "CLIP"), ("7", "16", "VAE"), ("13", "16", "VAE"), ("14", "16", "STRING"),
    ("23", "16", "INT"), ("20", "23", "FLOAT"),
    ("9", "16", "IMAGE"), ("110", "16", "IMAGE"), ("111", "16", "IMAGE"),
    ("112", "16", "IMAGE"), ("113", "16", "IMAGE"),
    ("26", "6", "LATENT"), ("7", "6", "VAE"), ("26", "2", "LATENT"), ("13", "2", "VAE"),
    ("6", "36", "IMAGE"), ("2", "36", "AUDIO"), ("36", "4", "VIDEO"),
}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def node(wf: dict, nid: int) -> dict:
    got = [n for n in wf["nodes"] if n["id"] == nid]
    assert len(got) == 1, f"node {nid} not unique"
    return got[0]


def edge_multiset(wf: dict) -> list[tuple[str, str, str]]:
    return [(str(l[1]), str(l[3]), l[5]) for l in wf["links"]]


def test_r2v_node_face():
    wf = load(R2V)
    ids = {n["id"] for n in wf["nodes"]}
    assert ids == EXPECTED_NODE_IDS, f"节点面漂移:{sorted(ids ^ EXPECTED_NODE_IDS)}"
    assert not (ids & DELETED_NODE_IDS), "四删节点复活"
    assert len(wf["links"]) == 30, f"链数 {len(wf['links'])} != 30"
    notes = {n["id"] for n in wf["nodes"] if n["type"] == "MarkdownNote"}
    assert notes == NOTE_IDS


def test_r2v_model_contract():
    """三对齐表 Q1-Q4:模型件名逐字符 + 官方口径参数(8步/euler/simple/[12,3]/pytorch)。"""
    wf = load(R2V)
    assert node(wf, 34)["type"] == "UNETLoader"
    assert node(wf, 34)["widgets_values"][:2] == [Q1_DIT, "default"]
    assert node(wf, 21)["type"] == "CLIPLoader"  # 换型自 CLIPLoaderGGUF(Win 无 GGUF 扩展)
    assert node(wf, 21)["widgets_values"] == [Q2_TE, "minimax", "default"]
    vaes = {n["id"]: n["widgets_values"][0] for n in wf["nodes"] if n["type"] == "VAELoader"}
    assert vaes == {7: Q3_VIDEO_VAE, 13: Q4_AUDIO_VAE}
    assert node(wf, 8)["widgets_values"] == ["simple", 8, 1]       # 官方:8 步 simple
    assert node(wf, 29)["widgets_values"] == ["euler"]             # 官方:Euler
    assert node(wf, 42)["widgets_values"] == [12, 3]               # 官方:shift video 12 / audio 3
    assert node(wf, 40)["widgets_values"] == ["pytorch attention"]  # 保守零加速件(NVFP4 内核层加速)
    for dead in ("SolAttnPatch", "MiniMaxH3BlockCacheT8", "LoraLoaderModelOnly",
                 "BlockSparseAttention", "SplitSigmas", "ModelPreviewOverrideKJ"):
        assert not [n for n in wf["nodes"] if n["type"] == dead], f"禁挂件 {dead} 在场(QAD 纯净线)"


def test_r2v_reference_wiring():
    """R2V 参考语义:16 号 ReferenceToVideo 五参考图槽(9=分镜帧+110-113 卡槽)+ max 身份档。"""
    wf = load(R2V)
    gen = node(wf, 16)
    assert gen["type"] == "MiniMaxH3ReferenceToVideo"
    assert gen["widgets_values"] == ["", 608, 352, 124, "max"]  # 出厂 480p + identity=max
    inputs = {i["name"]: i.get("link") for i in gen["inputs"]}
    for slot in ("clip", "vae", "audio_vae", "ref_images.ref_image_0", "ref_images.ref_image_1",
                 "ref_images.ref_image_2", "ref_images.ref_image_3", "ref_images.ref_image_4",
                 "prompt", "width", "height", "length"):
        assert inputs.get(slot) is not None, f"16.{slot} 未连线"
    link_origin = {l[0]: l[1] for l in wf["links"]}
    assert link_origin[inputs["ref_images.ref_image_0"]] == 9      # 分镜帧恒占 Picture 1
    assert link_origin[inputs["ref_images.ref_image_1"]] == 110    # 角色/场景卡槽
    assert link_origin[inputs["prompt"]] == 14                     # 提示词锚
    for ref_slot, ref_node in (("ref_images.ref_image_2", 111), ("ref_images.ref_image_3", 112), ("ref_images.ref_image_4", 113)):
        assert link_origin[inputs[ref_slot]] == ref_node
    # 出厂旁路:9/110-113 占位不污染收件箱(组装器注入图名时激活)
    for nid in (9, 110, 111, 112, 113):
        assert node(wf, nid).get("mode") == 4, f"节点 {nid} 出厂应旁路"


def test_r2v_edge_contract():
    from collections import Counter
    wf = load(R2V)
    got = Counter(edge_multiset(wf))
    expect = Counter(EXPECTED_EDGES) + Counter({("22", "16", "INT"): 2})  # 22→16 宽高 INT 双边
    assert got == expect, f"边集漂移:{got - expect}(多) / {expect - got}(少)"
    # 模型链官方同构:34→42→40→(8+33 双喂);SIGMAS 8→26 直连(SplitSigmas 摘除)
    assert got[("34", "42", "MODEL")] == 1 and got[("42", "40", "MODEL")] == 1
    assert got[("40", "8", "MODEL")] == 1 and got[("40", "33", "MODEL")] == 1
    assert got[("8", "26", "SIGMAS")] == 1


def test_r2v_anchor_contract():
    """产线锚点契约(与 i2v 族同构;批量回收依赖)。"""
    wf = load(R2V)
    assert node(wf, 14)["type"] == "PrimitiveStringMultiline"
    assert node(wf, 20)["type"] == "PrimitiveFloat"
    assert node(wf, 9)["type"] == "LoadImage"
    assert node(wf, 4)["type"] == "SaveVideo"
    assert node(wf, 4)["widgets_values"][0] == FIVE_SEGMENT_PREFIX  # 五段前缀出厂值
    assert node(wf, 22)["widgets_values"][1] == 0.2                 # 出厂 480p 档
    myshot = node(wf, 100)
    assert myshot["type"] == "MyShot"
    assert myshot["widgets_values"][:4] == ["S00", "", "", "待生成"]  # 母体出厂占位(i2v 件同款)


def test_frontend_bundle_pair_sync():
    """前端 bundle 模板对同步:UI 件与 repo 真源同字节;API 件 26 节点+r2v 锚。"""
    repo_bytes = R2V.read_bytes()
    assert hashlib.md5(repo_bytes).hexdigest() == hashlib.md5(FRONTEND_UI.read_bytes()).hexdigest(), \
        "前端 fasth3-ref-shot-template.json 与 repo 真源不同字节(重跑生成器同步)"
    api = load(FRONTEND_API)
    assert len(api) == 26, f"API 节点数 {len(api)} != 26"
    n16 = api["16"]
    assert n16["class_type"] == "MiniMaxH3ReferenceToVideo"
    assert n16["inputs"].get("ref_images.ref_image_0") == ["9", 0]
    assert n16["inputs"].get("ref_images.ref_image_1") == ["110", 0]
    assert n16["inputs"].get("prompt") == ["14", 0]
    assert n16["inputs"].get("length") == ["23", 1]
    assert n16["inputs"].get("ref_image_size") == "max"
    assert "width" in n16["inputs"] and "height" in n16["inputs"]
    assert api["34"]["inputs"]["unet_name"] == Q1_DIT
    assert api["21"]["inputs"] == {"clip_name": Q2_TE, "type": "minimax", "device": "default"}
    assert api["7"]["inputs"]["vae_name"] == Q3_VIDEO_VAE
    assert api["13"]["inputs"]["vae_name"] == Q4_AUDIO_VAE
    assert api["8"]["inputs"] == {"model": ["40", 0], "scheduler": "simple", "steps": 8, "denoise": 1}
    assert api["42"]["inputs"] == {"model": ["34", 0], "shift_video": 12, "shift_audio": 3}
    myshot = api["100"]
    assert myshot["class_type"] == "MyShot" and myshot["inputs"].get("video") == ["4", 0]
    for key in ("shot_id", "label", "description", "media_status"):
        assert key in myshot["inputs"], f"100.{key} 缺"


def test_fixture_has_reference_node():
    """QAD 夹具含 MiniMaxH3ReferenceToVideo(API 化键序源;Mac 引擎 17001 补录)。"""
    snapshot = json.loads((Path(__file__).resolve().parent / "fixtures/fasth3_qad_object_info_snapshot.json").read_text(encoding="utf-8"))
    node = snapshot.get("MiniMaxH3ReferenceToVideo")
    assert node, "夹具缺 MiniMaxH3ReferenceToVideo"
    assert list(node["input"]["required"].keys())[:6] == ["clip", "prompt", "width", "height", "length", "ref_image_size"]
