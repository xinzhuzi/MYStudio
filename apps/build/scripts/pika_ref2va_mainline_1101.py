#!/usr/bin/env python3
"""Pika ref2va 主线产线工作流生成器(1101 用户裁定「ref2va 更适合分镜产线」,
角色卡+场景卡+分镜帧锁身份;repo 工作流作者,幂等)。

母体 = 官方 PikaFlex-REF2VA 参考图模板(顶层平铺 22 节点,1030 役入库、1101 恢复)。
契约换装(全部参数逐字取自母体,2026-11-01 实读):
- 节点型 = MiniMaxH3ReferenceToVideo(≠ fl2va 线 ImageToVideo!它不走 first_frame 口,
  参考图走 ref_images.ref_image_N autogrow 五槽,引擎实锚见 comfy_extras/nodes_minimax_h3.py)
- UNET=minimax_h3_ref2va_pruned_int8_convrot(官方 Pika 契约底模)
- LoRA=pika_h3_flex_ref2va_comfy_bf16@1.0(Pika-Labs 适配器,官方仓收录)
- 采样=KSamplerSelect lcm + ManualSigmas "1.0,0.972973,0.923077,0.8,0.571429,0.333333,0.0"(6-NFE,同 fl2va)
- TE=qwen3vl_32b_minimax_h3_nvfp4_awq(CLIPLoader type=minimax);VAE=int8_convrot(视频)+fp32(音频)
- ref_image_size="match"(母体逐字;自研 ref2va 线用 max——Pika 官方契约优先)
- 增量(同 fl2va):ModelAttentionBackend=comfy kitchen attention(B 臂白拿 -9.2%,音频同簇)
- seed:RandomNoise 出厂 fixed 42(横评 D 臂口径;官方 randomize 不可复现)
- 分辨率:16 号宽高 widget 直填 608x352 出厂 + 22 ResolutionSelector(0.2MP 16:9=608x352)档位覆写
  (grill#3 教训:官方原生 1344x768 直出慢,禁 GetImageSize 原生分辨率链)
- 产线锚点同构(对齐 r2v 族先例 h3-shot-template-ref2va/fasth3-ref 线):
  gen 节点母体 136 重编号 16(r2v 族锚=16.width/16.height,组装器 getNode(16, MiniMaxH3ReferenceToVideo));
  14.value 提示词锚 / 20.value 秒锚 / 9.image=ref_images.ref_image_0(Picture 1=分镜帧,出厂旁路)/
  110-113.image=ref_images.ref_image_1..4(Picture 2-5=角色/场景卡,出厂旁路,组装器按 refs 激活)/
  4.filename_prefix 五段前缀(ref-* 策略段)/ 100 MyShot 回写

产出(幂等,重跑字节等价;引擎前端格式,画布直开):
  1. apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/pika-单镜视频-ref2v.json
  2. apps/frontend/lib/assist/image-studio/pika-ref-shot-template.json(同字节)

不产出 API 件:pika-ref-shot-template.api.json 为手工 API 化(20 节点执行链),
MyShot/占位节点不进 API 图(1101 直投禁令:直投无 extraPngInfo;参考槽由组装器
按 refs 实数动态注入)。

不做实弹:纯静态产出;热跑首发+引擎层验收属第二波(候 Win 四件模型下载毕)。
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MOTHER = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/4_官方本地模板/官方本地-PikaFlex-REF2VA参考图.json"
LIB_DIR = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频"
OUT = LIB_DIR / "pika-单镜视频-ref2v.json"
FRONTEND_UI_OUT = REPO / "apps/frontend/lib/assist/image-studio/pika-ref-shot-template.json"

# ── 官方契约逐字(母体实读)────────────────────────────────────────────
UNET = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
LORA = "pika_h3_flex_ref2va_comfy_bf16.safetensors"
MANUAL_SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"
SAMPLER = "lcm"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
ATTENTION = "comfy kitchen attention"
REF_IMAGE_SIZE = "match"  # 母体逐字(≠自研 ref2va 线的 max)
CREATE_VIDEO_WIDGETS = [24, 8, "sRGB", "none"]  # 母体逐字(fps/bit_depth/color_space/codec)
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ref-ambient"
FIRST_FRAME_PLACEHOLDER = "manying-shot-h3-placeholder.jpg"
REF_PLACEHOLDER = "manying-shot-h3-ref-placeholder.jpg"
SEED = 42

NOTE_MAIN = """## 漫影 Pika ref2va 主力线(1101 用户裁定「ref2va 更适合分镜产线」)

**定位**:角色卡+场景卡+分镜帧锁身份——分镜帧恒占 Picture 1(ref_image_0),
角色/场景卡占 Picture 2-5(110-113,出厂旁路,组装器按 refs 激活)。
**契约**(逐字取自 PikaFlex-REF2VA 官方模板):MiniMaxH3ReferenceToVideo
(≠ fl2va 线 ImageToVideo,无 first_frame 口)+ ref2va int8 pruned 底模
+ Pika LoRA@1.0 + lcm + 6-NFE ManualSigmas + ref_image_size=match。
**同 fl2va 增量**:kitchen attention(B 臂白拿 -9.2%,音频同簇);seed fixed 42。
**分辨率**:608x352 出厂直填(0.2MP 16:9 档,禁官方原生 1344x768 直出)。
**API 直投禁令**:API 图(pika-ref-shot-template.api.json,20 节点)不含
MyShot/占位节点——直投无 extraPngInfo;回收走五段前缀+execute result 回流,
画布档保留 100 MyShot 写回。**未实弹**:候 Win 四件模型下载毕后热跑首发。"""

NOTE_ANCHORS = """## 产线锚点契约(与 r2v 族骨架同构)

- 14.value:提示词(六段式 buildShotH3RefPrompt 整段覆写)
- 20.value:秒数(17k+5 网格吸附,131 号 ComfyMathExpression 换算帧数)
- 9.image:分镜帧(Picture 1=ref_images.ref_image_0,出厂旁路)
- 110-113.image:角色/场景卡(Picture 2-5=ref_images.ref_image_1..4,出厂旁路)
- 16.width/16.height:608x352 直填出厂(22 号 0.2MP 16:9 档覆写)
- 16 号:MiniMaxH3ReferenceToVideo(r2v 族锚,≠ i2v 族的 first_frame 口)
- 4.filename_prefix:五段前缀(ref-* 策略段,回收链)
- 100:MyShot 回写"""


def build_canvas() -> dict:
    mother = json.loads(MOTHER.read_text(encoding="utf-8"))
    mother_nodes = {n["id"]: copy.deepcopy(n) for n in mother["nodes"]}

    # ── 生成节点:母体 136 → 产线 16(r2v 族锚)+直填 608x352+补 ref_image_3/4 槽 ──
    gen = mother_nodes.pop(136)
    gen["id"] = 16
    gen["order"] = 16
    gen["widgets_values"] = ["", 608, 352, 124, REF_IMAGE_SIZE]
    if isinstance(gen.get("widgets_values_named"), dict):
        gen["widgets_values_named"].update({"width": 608, "height": 352})
    inputs = gen.get("inputs") or []
    ref2 = next(i for i, inp in enumerate(inputs) if inp.get("name") == "ref_images.ref_image_2")
    for offset, idx in enumerate((3, 4)):
        inputs.insert(ref2 + 1 + offset, {
            "label": f"ref_image_{idx}", "name": f"ref_images.ref_image_{idx}",
            "shape": 7, "type": "IMAGE", "link": None,
        })

    # ── 官方契约链节点(保留母体参数,仅改必要字段)──────────────────
    keep = {nid: mother_nodes.pop(nid) for nid in
            (119, 120, 121, 122, 123, 125, 126, 127, 128, 130, 131, 145, 147)}
    keep[129] = mother_nodes.pop(129)
    keep[129]["widgets_values"] = [SEED, "fixed"]  # seed42 可复现(母体 randomize 不可复现)
    # 母体 127/145/123/147/119/120/128 出厂即 Pika ref2va 契约逐字,零改;
    # 130 CreateVideo 母体逐字 [24, 8, "sRGB", "none"];131 秒→帧换算表达式逐字。

    # 母体退役件:92 SaveVideo(→锚 4)/115 ResolutionSelector(→锚 22)/117 官方注记
    # (→自有注记 101/102)/132 秒 PrimitiveFloat(→锚 20)/138 提示词(→锚 14)/
    # 149+150 参考图(→锚 9+110-113)
    for dead in (92, 115, 117, 132, 138, 149, 150):
        mother_nodes.pop(dead, None)
    assert not mother_nodes, f"母体节点未处置:{sorted(mother_nodes)}"

    # 增 ModelAttentionBackend(kitchen,同 fl2va B 臂白拿;母体无此件)
    keep[140] = {
        "id": 140, "type": "ModelAttentionBackend", "pos": [600, -300],
        "size": [300, 100], "flags": {}, "order": 140, "mode": 0,
        "widgets_values": [ATTENTION], "properties": {"Node name for S&R": "ModelAttentionBackend"},
        "inputs": [{"name": "model", "type": "MODEL", "link": None}],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": [], "slot_index": 0}],
    }

    # ── 产线锚点件(从 31 节点骨架借形,同 fl2va 先例)─────────────────
    anchor_mother = json.loads((REPO / "apps/frontend/lib/assist/image-studio/h3-shot-template.json").read_text(encoding="utf-8"))
    am = {n["id"]: n for n in anchor_mother["nodes"]}

    def borrow(nid: int, new_id: int, dx: int = 0) -> dict:
        n = copy.deepcopy(am[nid])
        n["id"] = new_id
        n["order"] = new_id
        if dx:
            pos = n.get("pos") or [0, 0]
            n["pos"] = [pos[0] + dx, pos[1]]
        if n.get("outputs"):
            for o in n["outputs"]:
                o["links"] = []
        if n.get("inputs"):
            for i in n["inputs"]:
                i["link"] = None
        return n

    # 14=提示词锚 / 20=秒锚 / 9=Picture 1 分镜帧 / 110-113=Picture 2-5 角色/场景卡 /
    # 22=档位选择 / 100=MyShot / 4=SaveVideo
    anchors = {}
    anchors[14] = borrow(14, 14)
    anchors[14]["widgets_values"] = [""]
    anchors[20] = borrow(20, 20)
    anchors[20]["widgets_values"] = [5]
    anchors[9] = borrow(9, 9)
    anchors[9]["widgets_values"] = [FIRST_FRAME_PLACEHOLDER, "image"]
    anchors[9]["mode"] = 4
    for slot, nid in enumerate((110, 111, 112, 113)):
        anchors[nid] = borrow(9, nid, dx=300 * (slot + 1))
        anchors[nid]["widgets_values"] = [REF_PLACEHOLDER, "image"]
        anchors[nid]["mode"] = 4
    anchors[22] = borrow(22, 22)
    anchors[22]["widgets_values"] = ["16:9 (Widescreen)", 0.2, 32]  # 0.2MP 16:9 = 608x352
    anchors[100] = borrow(100, 100)
    anchors[100]["widgets_values"] = ["S00", "", "", "待生成"]
    anchors[100]["mode"] = 0
    anchors[4] = borrow(4, 4)
    anchors[4]["widgets_values"] = [FIVE_SEGMENT_PREFIX, "auto", "auto", "auto"]

    nodes = {**{n["id"]: n for n in keep.values()}, 16: gen, **anchors}

    # ── 组装画布(顶层平铺,同 fl2va)─────────────────────────────────
    canvas = {
        "id": "pika-ref2v-mainline-1101",
        "revision": 0,
        "last_node_id": 200,
        "last_link_id": 500,
        "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
        "links": [],
        "groups": [],
        "config": {},
        "extra": {},
        "version": 0.4,
    }

    # 语义边 (origin, oslot, target, target输入名, type)——母体拓扑逐字+锚点换接+Attn 插链
    EDGES = [
        # 生成链:提示词/秒→帧/档位宽高/参考图五槽(Picture 1=分镜帧,2-5=角色/场景卡)
        (14, 0, 16, "prompt", "STRING"),
        (20, 0, 131, "values.a", "FLOAT"),
        (131, 1, 16, "length", "INT"),
        (22, 0, 16, "width", "INT"),
        (22, 1, 16, "height", "INT"),
        (9, 0, 16, "ref_images.ref_image_0", "IMAGE"),
        (110, 0, 16, "ref_images.ref_image_1", "IMAGE"),
        (111, 0, 16, "ref_images.ref_image_2", "IMAGE"),
        (112, 0, 16, "ref_images.ref_image_3", "IMAGE"),
        (113, 0, 16, "ref_images.ref_image_4", "IMAGE"),
        # 模型链:127 UNET → 145 LoRA → 140 Attn → 126 Guider(母体 127→145→126 插 Attn)
        (127, 0, 145, "model", "MODEL"),
        (145, 0, 140, "model", "MODEL"),
        (140, 0, 126, "model", "MODEL"),
        # TE/VAE
        (128, 0, 16, "clip", "CLIP"),
        (119, 0, 16, "vae", "VAE"),
        (120, 0, 16, "audio_vae", "VAE"),
        # 采样链
        (129, 0, 125, "noise", "NOISE"),
        (126, 0, 125, "guider", "GUIDER"),
        (123, 0, 125, "sampler", "SAMPLER"),
        (147, 0, 125, "sigmas", "SIGMAS"),
        (16, 0, 126, "conditioning", "CONDITIONING"),
        (16, 1, 125, "latent_image", "LATENT"),
        # 解码链(母体逐字:125 output 槽 0 双喂)
        (125, 0, 122, "samples", "LATENT"),
        (125, 0, 121, "samples", "LATENT"),
        (119, 0, 122, "vae", "VAE"),
        (120, 0, 121, "vae", "VAE"),
        (122, 0, 130, "images", "IMAGE"),
        (121, 0, 130, "audio", "AUDIO"),
        (130, 0, 4, "video", "VIDEO"),
        (4, 0, 100, "video", "VIDEO"),  # SaveVideo→MyShot 回写
    ]

    # 索引精确连边:清空所有 link 引用后按输入名定位真实槽位下标重建 links 表
    nodes_by_id = {n["id"]: n for n in canvas["nodes"]}
    for n in canvas["nodes"]:
        for i in n.get("inputs") or []:
            i["link"] = None
        for o in n.get("outputs") or []:
            o["links"] = []

    link_id = 500
    for origin, oslot, target, tname, ltype in EDGES:
        tgt, src = nodes_by_id[target], nodes_by_id[origin]
        slot = next((idx for idx, inp in enumerate(tgt.get("inputs") or []) if inp.get("name") == tname), None)
        if slot is None:
            tgt.setdefault("inputs", []).append({"name": tname, "type": ltype, "link": None})
            slot = len(tgt["inputs"]) - 1
        inp = tgt["inputs"][slot]
        if inp.get("link") is not None:
            raise SystemExit(f"槽位复冲:{target}.{tname} 已连 link {inp['link']}")
        link_id += 1
        inp["link"] = link_id
        if not src.get("outputs"):
            src["outputs"] = [{"name": ltype, "type": ltype, "links": [], "slot_index": 0}]
        while len(src["outputs"]) <= oslot:
            src["outputs"].append({"name": "OUT", "type": ltype, "links": []})
        out = src["outputs"][oslot]
        out["links"] = [*(out.get("links") or []), link_id]
        canvas["links"].append([link_id, origin, oslot, target, slot, ltype])
    canvas["last_link_id"] = link_id

    # note 节点
    canvas["nodes"].append({
        "id": 101, "type": "MarkdownNote", "pos": [-500, -600], "size": [420, 340],
        "flags": {}, "order": 101, "mode": 0, "widgets_values": ["", NOTE_MAIN],
    })
    canvas["nodes"].append({
        "id": 102, "type": "MarkdownNote", "pos": [-500, -220], "size": [420, 240],
        "flags": {}, "order": 102, "mode": 0, "widgets_values": ["", NOTE_ANCHORS],
    })

    # 结构自检
    got = {n["id"] for n in canvas["nodes"]}
    expected = {4, 9, 14, 16, 20, 22, 100, 101, 102, 110, 111, 112, 113,
                119, 120, 121, 122, 123, 125, 126, 127, 128, 129, 130, 131, 140, 145, 147}
    if got != expected:
        raise SystemExit(f"节点面漂移:{sorted(got ^ expected)}")
    if len(canvas["nodes"]) != 28:
        raise SystemExit(f"节点数 {len(canvas['nodes'])} != 28")
    if len(canvas["links"]) != 30:
        raise SystemExit(f"链数 {len(canvas['links'])} != 30")
    return canvas


def main() -> int:
    canvas = build_canvas()
    payload = json.dumps(canvas, ensure_ascii=False, indent=2) + "\n"
    OUT.write_text(payload, encoding="utf-8")
    FRONTEND_UI_OUT.write_text(payload, encoding="utf-8")
    print(f"[ok] repo 库 → {OUT.relative_to(REPO)}")
    print(f"[ok] 前端 bundle → {FRONTEND_UI_OUT.relative_to(REPO)}(同字节)")
    print(f"[ok] {len(canvas['nodes'])} 节点 / {len(canvas['links'])} 链;契约={SAMPLER}+6NFE+{LORA}+ref2va 底模")
    return 0


if __name__ == "__main__":
    sys.exit(main())
