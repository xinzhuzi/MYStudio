"""Pika ref2va 主力产线契约测试(1101 用户裁定「ref2va 更适合分镜产线」,
角色卡+场景卡+分镜帧锁身份)。

被测对象 = 仓库真源 `2_视频/H3视频/8_吸收归档/pika-单镜视频-ref2v.json`
(28 节点引擎前端格式画布直开)+ 前端 bundle 模板对
`pika-ref-shot-template.json`(同字节)/`pika-ref-shot-template.api.json`(20 节点)。

契约真源 = PikaFlex-REF2VA 官方模板(顶层平铺,逐字参数)+ fl2va 线同款增量:
- 官方契约:节点型=MiniMaxH3ReferenceToVideo(≠fl2va 线 ImageToVideo,无 first_frame 口;
  输入键=ref_images.ref_image_0..4)+UNET=ref2va_pruned_int8_convrot+LoRA pika@1.0
  +lcm+6-NFE ManualSigmas+ref_image_size=match(母体逐字)
- fl2va 同款增量:ModelAttentionBackend=comfy kitchen attention;seed fixed 42;
  608x352 直填(禁官方原生 1344x768 直出)
- 产线锚点:14.value/20.value/9.image(=ref_image_0=Picture 1 分镜帧)/
  110-113.image(=ref_image_1..4=Picture 2-5 角色/场景卡,出厂旁路)/
  4.filename_prefix 五段(ref-* 策略段)/100 MyShot/16.width+height 直填(gen 重编号
  母体 136→16,对齐 r2v 族锚点契约)
- 1101 直投禁令:API 图不含 MyShot/占位节点(直投无 extraPngInfo)——
  无 "100"/"110".."113" 节点,gen 出厂只挂 ref_image_0;参考槽由组装器按 refs 实数动态注入

零引擎依赖纯静态;实弹验收属第二波(候 Win 四件模型下载毕)。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LIB = ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/8_吸收归档"
UI = LIB / "pika-单镜视频-ref2v.json"
FRONTEND_UI = ROOT / "apps/frontend/lib/assist/image-studio/pika-ref-shot-template.json"
FRONTEND_API = ROOT / "apps/frontend/lib/assist/image-studio/pika-ref-shot-template.api.json"

# ── 官方契约(逐字取自 PikaFlex-REF2VA 母体)────────────────────────────
UNET = "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"
LORA = "pika_h3_flex_ref2va_comfy_bf16.safetensors"
SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"
SAMPLER = "lcm"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
ATTENTION = "comfy kitchen attention"
REF_IMAGE_SIZE = "match"
CREATE_VIDEO_WIDGETS = [24, 8, "sRGB", "none"]
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ref-ambient"
FIRST_FRAME_PLACEHOLDER = "manying-shot-h3-placeholder.jpg"
REF_PLACEHOLDER = "manying-shot-h3-ref-placeholder.jpg"

EXPECTED_NODE_IDS = {4, 9, 14, 16, 20, 22, 100, 101, 102, 110, 111, 112, 113, 119, 120,
                     121, 122, 123, 125, 126, 127, 128, 129, 130, 131, 140, 145, 147}
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
    assert len(wf["links"]) == 30, f"链数 {len(wf['links'])} != 30"
    notes = {n["id"] for n in wf["nodes"] if n["type"] == "MarkdownNote"}
    assert notes == NOTE_IDS


def test_ui_official_contract():
    """Pika ref2va 官方契约+fl2va 线同款增量。"""
    wf = load(UI)
    assert node(wf, 127)["type"] == "UNETLoader"
    assert node(wf, 127)["widgets_values"][:2] == [UNET, "default"]
    assert node(wf, 145)["type"] == "LoraLoaderModelOnly"
    assert node(wf, 145)["widgets_values"] == [LORA, 1]
    assert node(wf, 123)["widgets_values"] == [SAMPLER]
    assert node(wf, 147)["type"] == "ManualSigmas"
    assert node(wf, 147)["widgets_values"] == [SIGMAS]
    assert node(wf, 129)["widgets_values"] == [42, "fixed"]  # seed42 可复现
    assert node(wf, 140)["widgets_values"] == [ATTENTION]  # B 臂白拿(同 fl2va)
    vaes = {n["id"]: n["widgets_values"][0] for n in wf["nodes"] if n["type"] == "VAELoader"}
    assert vaes == {119: VIDEO_VAE, 120: AUDIO_VAE}
    assert node(wf, 128)["widgets_values"] == [TE, "minimax", "default"]
    assert node(wf, 130)["widgets_values"] == CREATE_VIDEO_WIDGETS  # 母体逐字
    assert node(wf, 131)["type"] == "ComfyMathExpression"  # 秒→帧 17k+5 网格换算(母体逐字)


def test_ui_anchor_contract():
    """产线锚点契约(与 r2v 族骨架同构;gen=16 号)。"""
    wf = load(UI)
    assert node(wf, 14)["type"] == "PrimitiveStringMultiline"
    assert node(wf, 20)["type"] == "PrimitiveFloat"
    first = node(wf, 9)
    assert first["type"] == "LoadImage"
    assert first.get("mode") == 4  # Picture 1 分镜帧出厂旁路(组装器激活)
    for nid in (110, 111, 112, 113):  # Picture 2-5 角色/场景卡出厂旁路
        ref = node(wf, nid)
        assert ref["type"] == "LoadImage"
        assert ref.get("mode") == 4
        assert ref["widgets_values"][0] == REF_PLACEHOLDER
    assert node(wf, 4)["type"] == "SaveVideo"
    assert node(wf, 4)["widgets_values"][0] == FIVE_SEGMENT_PREFIX
    gen = node(wf, 16)
    assert gen["type"] == "MiniMaxH3ReferenceToVideo"  # ≠fl2va 线 ImageToVideo
    assert gen["widgets_values"] == ["", 608, 352, 124, REF_IMAGE_SIZE]  # 直填 480p 出厂+match 逐字
    myshot = node(wf, 100)
    assert myshot["type"] == "MyShot"
    assert myshot["widgets_values"][:4] == ["S00", "", "", "待生成"]


def test_ui_ref_slot_wiring():
    """参考图五槽按名落位:9→ref_image_0(分镜帧),110-113→ref_image_1..4(按序)。"""
    wf = load(UI)
    gen = node(wf, 16)
    by_name = {inp["name"]: inp for inp in gen["inputs"]}
    links_by_id = {l[0]: l for l in wf["links"]}
    for source_id, slot in ((9, 0), (110, 1), (111, 2), (112, 3), (113, 4)):
        key = f"ref_images.ref_image_{slot}"
        assert key in by_name, f"16 号缺参考槽 {key}"
        link_id = by_name[key].get("link")
        assert link_id is not None, f"16.{key} 未连线"
        link = links_by_id[link_id]
        assert link[1] == source_id and link[2] == 0, f"{key} 应接 {source_id} 号 IMAGE 输出,实接 {link[1]}"
        assert link[3] == 16, f"{key} 目标非 16 号"
    # 分镜帧/参考卡出厂旁路:槽在、线在,节点 mode=4 使引擎画布队列按旁路解析


def test_ui_connectivity():
    """关键路径连通(模型链+生成链+回收链)。"""
    wf = load(UI)
    edges = {(l[1], l[3]) for l in wf["links"]}
    for pair in [(127, 145), (145, 140), (140, 126), (16, 126),
                 (14, 16), (9, 16), (22, 16), (131, 16), (130, 4), (4, 100)]:
        assert pair in edges, f"边 {pair} 缺——关键路径断链"


def test_frontend_bundle_sync():
    """前端 bundle 同字节+API 件全锚+直投禁令(无 MyShot/占位节点)。"""
    assert hashlib.md5(UI.read_bytes()).hexdigest() == hashlib.md5(FRONTEND_UI.read_bytes()).hexdigest(), \
        "前端 pika-ref-shot-template.json 与 repo 真源不同字节(重跑生成器同步)"
    api = load(FRONTEND_API)
    assert len(api) == 20, f"API 节点数 {len(api)} != 20"
    gen = api["16"]
    assert gen["class_type"] == "MiniMaxH3ReferenceToVideo"
    # 输入键=ref_images.ref_image_N(≠ first_frame);出厂只挂第一槽=分镜帧
    assert gen["inputs"].get("ref_images.ref_image_0") == ["9", 0]
    for slot in (1, 2, 3, 4):
        assert f"ref_images.ref_image_{slot}" not in gen["inputs"], \
            f"占位参考槽 ref_image_{slot} 禁进 API 图(直投无 extraPngInfo;由组装器按 refs 实数注入)"
    assert "first_frame" not in gen["inputs"]
    assert gen["inputs"].get("width") == 608 and gen["inputs"].get("height") == 352  # 档位直填出厂
    assert gen["inputs"].get("ref_image_size") == REF_IMAGE_SIZE
    assert gen["inputs"].get("prompt") == ["14", 0]
    assert gen["inputs"].get("length") == ["131", 1]
    # 直投禁令:MyShot/占位参考卡节点不得进 API 图
    for banned in ("100", "110", "111", "112", "113"):
        assert banned not in api, f"节点 {banned} 禁进 API 图(直投无 extraPngInfo)"
    assert api["127"]["inputs"]["unet_name"] == UNET
    assert api["145"]["inputs"] == {"lora_name": LORA, "strength_model": 1, "model": ["127", 0]}
    assert api["123"]["inputs"]["sampler_name"] == SAMPLER
    assert api["147"]["inputs"]["sigmas"] == SIGMAS
    assert api["140"]["inputs"]["attention"] == ATTENTION
    assert api["129"]["inputs"].get("noise_seed") == 42
    assert api["129"]["inputs"].get("control_after_generate") == "fixed"
    assert api["130"]["inputs"]["fps"] == 24 and api["130"]["inputs"]["bit_depth"] == 8
    assert api["4"]["inputs"]["filename_prefix"] == FIVE_SEGMENT_PREFIX
    assert api["9"]["inputs"]["image"] == FIRST_FRAME_PLACEHOLDER
