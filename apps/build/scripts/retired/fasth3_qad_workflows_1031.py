#!/usr/bin/env python3
"""Windows FastH3 QAD R2V 参考线工作流生成器(10-31 rtx-pro-4000 换卡役,repo 工作流作者)。

母体 = apps/frontend/lib/assist/image-studio/h3-shot-template-ref2va.json(34 节点 Mac R2V
骨架;锚点契约 14.value/20.value/9.image/4.filename_prefix/100 MyShot/16.width+height 直填
+110-113 四参考图槽 原样保留)。
换芯依据 = FastVideo/FastH3-Omni-NVFP4-QAD-Comfy 官方 README+VALIDATION(魔搭镜像实拉,
2026-10-31):8 步 / Euler / simple / guidance 1.0 / video shift 12.0 / audio shift 3.0 /
MiniMaxH3ReferenceToVideo 节点 / NVFP4 需 Blackwell(RTX Pro 4000 ✓)。母体的 8 步 simple/
euler/pytorch attention/SigmaShift[12,3] 与官方口径已全对齐,唯一改动=模型件三换+四删+链重排。

三对齐表(10-31 增补,引擎侧落位=E:/IP/漫影工作室/comfyui/models/):
  Q1 DiT   fasth3_omniref_qad_nvfp4_comfy.safetensors(13,773,998,700B,
           sha256 bf25ee58df65b4df… 已于 1030 役落 Windows,三方对账毕)→ diffusion_models/
  Q2 TE    qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors(15,687,142,551B,1027 役 R4 已在位)
           → text_encoders/  ⚠️ OmniRef 线官方要求 TE 带 reference-vision 支持,fl2va 仓
           nvfp4_awq 件与 Comfy-Org 同名件是否同源待 Win 实弹裁决(QAD README 配套仓
           FastH3-OmniRef-Comfy 魔搭无镜像);败则从 OmniRef-Comfy 仓补 TE(HF 通路)。
  Q3 VAEv  minimax_h3_video_vae_int8_convrot.safetensors(在位)→ vae/
  Q4 VAEa  minimax_h3_audio_vae_fp32.safetensors(在位)→ vae/  ⚠️ 音频 VAE 官方明示必装。

相对母体的换芯清单(官方验证环境=ComfyUI b1a247c9+comfy-kitchen 0.2.39+PyTorch 2.9 nv25.09
+CUDA 13+GB200;Win 引擎 0.42.0+kitchen 0.2.40,节点面 0.36+ 即有,实弹验收属下一阶段):
- DiT:minimax_h3_ref2va_pruned_bf16(Mac 档,1004 已删缺件)→ fasth3_omniref_qad_nvfp4_comfy
- TE:CLIPLoaderGGUF(heretic GGUF,Win 无 GGUF 扩展)→ CLIPLoader(type=minimax,nvfp4_awq)
- 视频 VAE:fp16 → int8_convrot(Win 在位件;音频 VAE fp32 不变)
- 删 4 节点(与 1027 fasth3 换芯四删同构):3 SplitSigmas(turbo 残构,QAD 禁蒸馏配线)/
  17 ModelPreviewOverrideKJ(Win 引擎不在册)/43 SolAttnPatch(Mac MPS 扩展)/
  48 MiniMaxH3BlockCacheT8(块缓存,QAD 保守零加速件)
- 注意力:pytorch attention 保留(QAD 官方验证未挂任何注意力加速;NVFP4 硬件加速在权重
  内核层,非 backend 选项);VSA/BlockSparseAttention 不挂——VSA 是 fl2va 8step-v2 专用
  训练口径,QAD omniref 官方未提及,不猜
- 模型链官方同构重排:34 UNET → 42 SigmaShift[12,3] → 40 AttentionBackend →
  (8 Scheduler.model + 33 Guider.model 双喂);SIGMAS 8 → 26 直连(SplitSigmas 摘除)
- 出厂档=480p(16 号 608x352/22 号 0.2MP,对齐 fasth3-单镜视频-i2v 出厂口径;
  9/110-113 出厂旁路防占位污染收件箱,组装器注入图名时激活)

产出(幂等,重跑字节等价;引擎前端格式,画布直开):
  1. apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-r2v.json
     ——repo 库 UI 真源(R2V 参考图主形态:9.image→16.ref_images.ref_image_0=分镜帧,
     110-113=角色卡/场景卡槽)
  2. apps/frontend/lib/assist/image-studio/fasth3-ref-shot-template.json
     ——前端 bundle UI 件(与 repo 库件同字节,fasth3-shot-template.json 先例)

API 件另由既有转换脚本产出(勿在本脚本重造):
  uv run python build/scripts/h3_template_to_api_1027.py \
    --src backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-r2v.json \
    --dst frontend/lib/assist/image-studio/fasth3-ref-shot-template.api.json \
    --ui-count 30 --api-count 26 \
    --object-info-file backend/comfyui/tests/fixtures/fasth3_qad_object_info_snapshot.json

不做实弹:本生成器纯静态产出;Win 侧核账(NVFP4 kernel 加载/TE reference-vision)与实弹
A/B(音频复验清单②)属下一阶段。
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MOTHER = REPO / "apps/frontend/lib/assist/image-studio/h3-shot-template-ref2va.json"
LIB_DIR = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频"
R2V_OUT = LIB_DIR / "fasth3-单镜视频-r2v.json"
FRONTEND_UI_OUT = REPO / "apps/frontend/lib/assist/image-studio/fasth3-ref-shot-template.json"

# ── 三对齐表 Q1-Q4(唯一契约:文件名逐字符对齐,引擎侧并行核账同名件)──────────────────
Q1_DIT = "fasth3_omniref_qad_nvfp4_comfy.safetensors"                          # UNETLoader.unet_name
Q2_TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"                          # CLIPLoader.clip_name
Q3_VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"                  # VAELoader(视频)
Q4_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"                          # VAELoader(音频,不动)
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ambient"        # 4.filename_prefix 出厂值(回收链五段前缀)

# 官方 QAD 口径(FastH3-Omni-NVFP4-QAD-Comfy README+VALIDATION,2026-10-31 魔搭实拉)
QAD_STEPS = 8            # BasicScheduler.steps(母体已 8,断言防漂)
QAD_SAMPLER = "euler"    # KSamplerSelect(母体已 euler,断言防漂)
QAD_SHIFT = (12, 3)      # MiniMaxH3SigmaShift(母体已 [12,3],断言防漂)
QAD_ATTENTION = "pytorch attention"  # ModelAttentionBackend(保守零加速件)

DELETED_NODES = (3, 17, 43, 48)  # SplitSigmas/ModelPreviewOverrideKJ/SolAttnPatch/T8块缓存

NOTE_31 = """Guide: FastH3 OmniRef QAD NVFP4 (Windows RTX Pro 4000 Blackwell line)

## Model Links

**diffusion_models**

- fasth3_omniref_qad_nvfp4_comfy.safetensors — FastVideo/FastH3-Omni-NVFP4-QAD-Comfy (13.77 GB, sha256 bf25ee58…, 1030 役已落位)

**text_encoders**

- qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors — 1027 役 R4 已在位(OmniRef reference-vision 兼容性待实弹裁决)

**vae**

- minimax_h3_video_vae_int8_convrot.safetensors
- minimax_h3_audio_vae_fp32.safetensors(音频 VAE 官方明示必装)

## Official recipe (README + VALIDATION)

- 8 steps / Euler / simple schedule / guidance 1.0
- video shift 12.0 / audio shift 3.0
- NVFP4 加速需 NVIDIA Blackwell;其它架构用 BF16/FP8 件
- 参考输入用 <Picture N> / <Video N> / <Audio N> 标签"""

NOTE_47 = """## 模板说明(10-31 QAD 换芯;母体=34 节点 Mac R2V 骨架,锚点契约不动)

**Windows FastH3 QAD R2V 参考线**(RTX Pro 4000 Blackwell / NVFP4 专用):
- DiT = fasth3_omniref_qad_nvfp4_comfy(QAD=量化感知蒸馏,8 步自带,LoRA/块缓存/稀疏注意力全禁挂)
- TE = CLIPLoader(minimax 型,nvfp4_awq)
- 视频 VAE = int8_convrot;音频 VAE = fp32(带音频出片必装)
- 采样 = simple/8 步/euler/guidance 1.0;SigmaShift [12,3](官方口径)
- 注意力 = pytorch attention(NVFP4 硬件加速在权重内核层;kitchen/VSA 不挂——QAD 非 VSA 训练)
- 已删:SplitSigmas(turbo 残构)/ModelPreviewOverrideKJ(Win 不在册)/SolAttnPatch(MPS 件)/T8 块缓存

**R2V 参考图语义**:9 号=分镜帧(第一参考图,Picture 1);110-113=角色卡/场景卡槽(Picture 2-5,
组装器按 refs 注入激活);六段式提示词(<Subject>/<Picture> 绑定)由组装器 buildShotH3RefPrompt 注入。
reference_sizing=max(身份保持)。

**档位**:出厂 0.2MP=608×352(快速档);0.98MP=1344×768。对照表见旁边 megapixels 表。

⚠️ QAD=蒸馏(8步)+NVFP4(量化)双加速,音频绝对质量未验(1030 定谳:步数蒸馏饿死音频头;官方
VALIDATION 仅对比 NVFP4 vs BF16 同 QAD 母版)。出产音频标准=28 步纯净 bf16 线,勿以本件出片。"""

NOTE_101 = """## 漫影自研单镜 FastH3 QAD R2V(Windows)

- 分镜帧=节点 9(第一参考图);角色卡/场景卡=节点 110-113,提示词由组装器注入(六段式)。
- ambient 默认保留环境声与画内声;full 写入中文台词;bare 仅保留最小声场。
- 点击 Queue 即可出片;视频产物位于 output/video/漫影_S{NN}。
- 仅 Windows 引擎在册(RTX Pro 4000 + NVFP4 模型件);Mac 无 QAD 件。"""


def load_mother() -> dict:
    canvas = json.loads(MOTHER.read_text(encoding="utf-8"))
    ids = {n["id"] for n in canvas["nodes"]}
    expect = {2, 3, 4, 6, 7, 8, 9, 13, 14, 16, 17, 20, 21, 22, 23, 26, 29, 31, 32, 33, 34,
              36, 37, 40, 42, 43, 47, 48, 100, 101, 110, 111, 112, 113}
    if ids != expect:
        raise SystemExit(f"ref2va 母体节点面漂移:实为 {sorted(ids)}")
    return canvas


def drop_node(canvas: dict, node_id: int) -> None:
    """删节点及其全部连线,并清两端节点 inputs/outputs 里对被删连线的引用。"""
    node = next(n for n in canvas["nodes"] if n["id"] == node_id)
    dead_links = {i.get("link") for i in node.get("inputs") or [] if i.get("link") is not None}
    out_idx = {o.get("slot_index", idx) for idx, o in enumerate(node.get("outputs") or [])}
    for link in canvas["links"]:
        if link[1] == node_id:
            dead_links.add(link[0])
    for link in canvas["links"]:
        if link[3] == node_id and link[2] in out_idx:
            dead_links.add(link[0])
    canvas["nodes"] = [n for n in canvas["nodes"] if n["id"] != node_id]
    canvas["links"] = [l for l in canvas["links"] if l[0] not in dead_links]
    for n in canvas["nodes"]:
        for inp in n.get("inputs") or []:
            if inp.get("link") in dead_links:
                inp["link"] = None
        for out in n.get("outputs") or []:
            out["links"] = [lid for lid in (out.get("links") or []) if lid not in dead_links]


def relink(canvas: dict, origin: int, origin_slot: int, target: int, target_input: str, link_type: str) -> int:
    """按目标输入名接一条新线(禁按序号硬编码);已连则先摘旧线。幂等。"""
    tgt = next(n for n in canvas["nodes"] if n["id"] == target)
    slot = next(i for i in tgt["inputs"] if i["name"] == target_input)
    if slot.get("link") is not None:
        old = slot["link"]
        canvas["links"] = [l for l in canvas["links"] if l[0] != old]
        for n in canvas["nodes"]:
            for out in n.get("outputs") or []:
                out["links"] = [lid for lid in (out.get("links") or []) if lid != old]
    links = canvas.setdefault("links", [])
    new_id = max([int(canvas.get("last_link_id") or 0)] + [int(l[0]) for l in links]) + 1
    links.append([new_id, origin, origin_slot, target, 0, link_type])
    src = next(n for n in canvas["nodes"] if n["id"] == origin)
    if not src.get("outputs"):
        raise SystemExit(f"节点 {origin} 无 outputs,无法出线")
    src["outputs"][origin_slot]["links"] = [*(src["outputs"][origin_slot].get("links") or []), new_id]
    slot["link"] = new_id
    slot["type"] = link_type
    canvas["last_link_id"] = new_id
    return new_id


def main() -> int:
    canvas = load_mother()
    nodes = {n["id"]: n for n in canvas["nodes"]}

    # 1) 母体口径断言(官方参数在母体已对齐,漂移即停,禁静默改)
    def wv(node_id: int) -> list:
        return nodes[node_id].get("widgets_values") or []
    if wv(8) != ["simple", QAD_STEPS, 1]:
        raise SystemExit(f"母体 8 号调度器漂移:{wv(8)}(官方口径 simple/{QAD_STEPS}/1)")
    if wv(29) != [QAD_SAMPLER]:
        raise SystemExit(f"母体 29 号采样器漂移:{wv(29)}(官方口径 {QAD_SAMPLER})")
    if wv(42) != list(QAD_SHIFT):
        raise SystemExit(f"母体 42 号 SigmaShift 漂移:{wv(42)}(官方口径 {list(QAD_SHIFT)})")
    if wv(40) != [QAD_ATTENTION]:
        raise SystemExit(f"母体 40 号注意力漂移:{wv(40)}")

    # 2) 四删(SplitSigmas/Preview/SolAttn/T8;链断点随删清理)
    for node_id in DELETED_NODES:
        drop_node(canvas, node_id)
    nodes = {n["id"]: n for n in canvas["nodes"]}

    # 3) 三换(DiT/TE 型+件/视频 VAE)+ 出厂档 480p
    unet = nodes[34]
    unet["widgets_values"] = [Q1_DIT, "default"]
    clip = nodes[21]
    clip["type"] = "CLIPLoader"
    clip["widgets_values"] = [Q2_TE, "minimax", "default"]
    (clip.setdefault("properties", {}))["Node name for S&R"] = "CLIPLoader"
    clip["outputs"] = clip.get("outputs") or [{"name": "CLIP", "type": "CLIP", "links": []}]
    nodes[7]["widgets_values"] = [Q3_VIDEO_VAE]
    # 4 号出厂前缀对齐五段契约(母体残留旧版 "video/漫影_S00";组装器按
    # video/漫影/<chapter>/<shot>/ref-<policy> 覆写,出厂占位须过 MyShot 五段校验)
    save = nodes[4]
    save["widgets_values"] = [FIVE_SEGMENT_PREFIX, *save["widgets_values"][1:]]
    if isinstance(save.get("widgets_values_named"), dict):
        save["widgets_values_named"]["filename_prefix"] = FIVE_SEGMENT_PREFIX
    # 16 号出厂 480p(1344x768→608x352;ref_image_size=max 保留在尾部)
    gen = nodes[16]
    gen_wv = gen["widgets_values"]
    gen["widgets_values"] = [gen_wv[0], 608, 352, gen_wv[3], gen_wv[4]]
    # 22 号出厂 0.2MP(480p 快速档,对齐 fasth3-单镜视频-i2v 口径)
    res = nodes[22]
    res["widgets_values"] = [res["widgets_values"][0], 0.2, res["widgets_values"][2]]

    # 4) 模型链官方同构重排:34→42→40→(8.model+33.model);SIGMAS 8→26 直连
    relink(canvas, 34, 0, 42, "model", "MODEL")
    relink(canvas, 42, 0, 40, "model", "MODEL")
    relink(canvas, 40, 0, 8, "model", "MODEL")
    relink(canvas, 40, 0, 33, "model", "MODEL")
    relink(canvas, 8, 0, 26, "sigmas", "SIGMAS")

    # 5) note 换芯说明(31 模型链接/47 模板说明/101 漫影说明;32 分辨率表保留)
    notes = {n["id"]: n for n in canvas["nodes"] if n["type"] == "MarkdownNote"}
    for note_id, text in ((31, NOTE_31), (47, NOTE_47), (101, NOTE_101)):
        note = notes.get(note_id)
        if not note:
            raise SystemExit(f"母体缺 note {note_id}")
        w = note["widgets_values"]
        note["widgets_values"] = [w[0], text] if isinstance(w, list) and len(w) > 1 else [text]

    # 6) 结构自检:30 节点;锚点契约在位;QAD 件名逐字符;链尾双喂
    got = {n["id"] for n in canvas["nodes"]}
    if len(got) != 30:
        raise SystemExit(f"产物节点数 {len(got)} ≠ 30")
    for node_id, ntype in ((4, "SaveVideo"), (9, "LoadImage"), (14, "PrimitiveStringMultiline"),
                           (20, "PrimitiveFloat"), (100, "MyShot"), (16, "MiniMaxH3ReferenceToVideo"),
                           (21, "CLIPLoader"), (34, "UNETLoader")):
        n = nodes.get(node_id)
        if not n or n["type"] != ntype:
            raise SystemExit(f"产物锚点漂移:{node_id} 应为 {ntype}")
    if nodes[34]["widgets_values"][0] != Q1_DIT or nodes[21]["widgets_values"][0] != Q2_TE:
        raise SystemExit("三对齐表件名未落位")
    guider = nodes[33]
    model_src = {l[1] for l in canvas["links"] if l[3] == 33 and l[5] == "MODEL"}
    if model_src != {40}:
        raise SystemExit(f"Guider.model 源应为 40(AttentionBackend),实为 {model_src}")
    sched_model = {l[1] for l in canvas["links"] if l[3] == 8 and l[5] == "MODEL"}
    if sched_model != {40}:
        raise SystemExit(f"Scheduler.model 源应为 40,实为 {sched_model}")
    sigmas_src = {l[1] for l in canvas["links"] if l[3] == 26 and l[5] == "SIGMAS"}
    if sigmas_src != {8}:
        raise SystemExit(f"Sampler.sigmas 源应为 8(直连),实为 {sigmas_src}")

    payload = json.dumps(canvas, ensure_ascii=False, indent=2) + "\n"
    R2V_OUT.write_text(payload, encoding="utf-8")
    FRONTEND_UI_OUT.write_text(payload, encoding="utf-8")
    print(f"[ok] repo 库 UI 真源 → {R2V_OUT.relative_to(REPO)}")
    print(f"[ok] 前端 bundle UI 件 → {FRONTEND_UI_OUT.relative_to(REPO)}(同字节)")
    print(f"[ok] 节点 30(删 3/17/43/48);QAD 链 34→42→40→(8+33) 双喂;SIGMAS 8→26 直连")
    return 0


if __name__ == "__main__":
    sys.exit(main())
