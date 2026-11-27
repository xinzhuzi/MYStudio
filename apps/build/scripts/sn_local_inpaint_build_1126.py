# -*- coding: utf-8 -*-
"""1126 sn-局部重绘 构建器(SenseNova-U1.6 局部重绘·自由模式·画布件+API 直投件)。

调研定谳(research/websearch-sensenova-inpaint.md):
  SenseNovaConditioning task 枚举={image, image thinking, interleave, self-correction}
  ——无原生 mask/inpaint 任务(引擎 /object_info 2026-11-26 实取);社区对无原生
  掩膜的编辑模型正路=掩膜限噪采样+像素级回贴(ComfyUI 官方 inpaint 范式)。
故本件=官方编辑链(task=image)+ 掩膜支路:
  LoadImage.MASK → GrowMaskWithBlur(expand12/blur8) → SetLatentNoiseMask;
  解码后 ImageCompositeMasked 掩膜外逐位回贴(comfy composite() bilinear 对齐)。
指令=唯一手写位(自由模式,零风格锁定;无 PE);双臂/参考图链逐字照官方
(经 sensenova_daojie_build_1126 的 _skel 纪律现读现校)。

产物:2_图生图/sn-局部重绘.json(画布件)+ sn-局部重绘-api.json(直投件)。
用法:python3 sn_local_inpaint_build_1126.py [--dry-run]
"""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE_GEN = REPO / "apps/build/scripts/sensenova_daojie_build_1126.py"
OUT_DIR = REPO / "apps/backend/comfyui/workflows/1_图片/SenseNova/2_图生图"

DEFAULT_INSTRUCTION = (
    "只重绘遮罩区域：<写明遮罩里要出现什么>；遮罩外的一切保持原样，"
    "光线、色调与画法与原图完全一致；保持原图的取景、构图与人物姿态完全不变。"
)

NOTE = """## SenseNova 局部重绘(自由模式 × 官方编辑链 × 掩膜限噪,1126 役)

- **掩膜**:[17] LoadImage 右键 → Open in MaskEditor 涂抹重绘区;[54] expand12/blur8
  软缝;掩膜外像素经 [56] 逐位回贴(掩膜不涂=全零=零重绘,不会误全图)
- **调研结论**:SenseNovaConditioning task={image/image thinking/interleave/
  self-correction},无原生 mask/inpaint(引擎 object_info 2026-11-26);本件=
  社区正路:条件侧全图(task=image,参考图链照官方)× 掩膜限噪(SetLatentNoiseMask,
  采样器对噪声掩膜 bilinear 对齐)× 像素回贴(ImageCompositeMasked)
- **自由模式**:指令唯一手写位,无装配/无风格底座;双臂照官方(Turbo 8 步默认)
- **画幅**:随参考图(GetImageSize→32 对齐),输出尺寸=输入尺寸
- 提速同源:官方链直采;VAE=ckpt 自带(GPU)
"""


def _load_base_module():
    spec = importlib.util.spec_from_file_location("sn_daojie_gen", BASE_GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    g = _load_base_module()
    facts = g.official_facts()

    layout = {
        2: ([40, 120], [440, 330]), 28: ([40, 500], [440, 620]),
        5: ([540, 120], [460, 230]), 6: ([540, 390], [460, 220]),
        17: ([1060, 120], [380, 500]), 54: ([1060, 660], [380, 140]),
        18: ([1500, 120], [340, 170]), 19: ([1500, 330], [340, 170]),
        20: ([1500, 540], [340, 110]), 21: ([1500, 690], [340, 160]),
        54 + 1: ([1500, 890], [340, 120]),
        22: ([1900, 120], [320, 150]), 23: ([1900, 310], [320, 170]),
        24: ([1900, 520], [340, 110]),
        25: ([1900, 670], [340, 330]),
        26: ([2310, 670], [260, 100]),
        54 + 2: ([2310, 810], [340, 220]),
        27: ([2640, 670], [380, 500]),
    }
    layout.update(g._arm_layout(g._ARMS_I2I))
    groups = [
        g._group(1, "① 指令·编码(自由模式)", [0, 0, 1020, 640], "#3f789e"),
        g._group(2, "② 参考图·掩膜·画幅", [1040, 0, 820, 1080], "#88A"),
        g._group(3, f"③ 模型·双臂(Turbo {facts['turbo_steps']} 步 | 原生 {facts['native_steps']} 步)",
                 [1680, 0, 1160, 1160], "#a33"),
        g._group(4, "④ 采样·回贴·输出", [2280, 0, 1760, 1120], "#4a7"),
    ]

    graph = g._Graph(layout)
    graph.add(g._skel("multiline", 2, "重绘指令", value=DEFAULT_INSTRUCTION))
    graph.add(g._skel("note", 28, text=NOTE))
    graph.add(g._skel("encode_pos", 5, "CLIP Text Encode (正向)", text=""))
    graph.add(g._skel("encode_neg", 6, "CLIP Text Encode (负向)", text=""))
    g._add_dual_arm(graph, g._ARMS_I2I)
    for key, nid in (("load_image", 17), ("resize_mp", 18), ("resize_mult", 19),
                     ("image_size", 20), ("latent", 21), ("ref_images", 22), ("cond", 23),
                     ("seed", 24), ("sampler", 25), ("decode", 26)):
        graph.add(g._skel(key, nid, **({"value": g.DEFAULT_SEED} if key == "seed" else {})))
    graph.add(g._skel("save", 27, filename_prefix="sensenova_inpaint/"))
    # 掩膜三件(形态照换脸先例/引擎源码)
    graph.add(g._node(54, "GrowMaskWithBlur",
                      [12, 0.0, True, False, 8.0, 1.0, 1.0, False],
                      {"expand": 12, "incremental_expandrate": 0.0, "tapered_corners": True,
                       "flip_input": False, "blur_radius": 8.0, "lerp_alpha": 1.0,
                       "decay_factor": 1.0, "fill_holes": False},
                      [g._in("mask", "MASK")],
                      [g._out("mask", "MASK")]))
    graph.add(g._node(55, "SetLatentNoiseMask", [], {},
                      [g._in("samples", "LATENT"), g._in("mask", "MASK")],
                      [g._out("LATENT", "LATENT")]))
    graph.add(g._node(56, "ImageCompositeMasked", [0, 0, False],
                      {"x": 0, "y": 0, "resize_source": False},
                      [g._in("destination", "IMAGE"), g._in("source", "IMAGE"),
                       g._in("x", "INT", widget=True), g._in("y", "INT", widget=True),
                       g._in("resize_source", "BOOLEAN", widget=True),
                       g._in("mask", "MASK", optional=True)],
                      [g._out("IMAGE", "IMAGE")]))

    load_image = graph.by_id[17]
    _require_mask_slot(graph, 17)
    graph.wire(2, 0, 5, "text", "STRING")
    graph.wire(7, 1, 5, "clip", "CLIP")
    # 负向:官方默认空文本(widget 值已随 _skel 继承),仅接 clip
    graph.wire(7, 1, 6, "clip", "CLIP")
    # 参考图链照官方 i2i
    graph.wire(17, 0, 18, "input", "IMAGE")
    graph.wire(18, 0, 19, "input", "IMAGE")
    graph.wire(19, 0, 20, "image", "IMAGE")
    graph.wire(19, 0, 22, "images.image_1", "IMAGE")
    graph.wire(20, 0, 21, "width", "INT")
    graph.wire(20, 1, 21, "height", "INT")
    graph.wire(5, 0, 22, "positive", "CONDITIONING")
    graph.wire(6, 0, 22, "negative", "CONDITIONING")
    graph.wire(22, 0, 23, "conditioning", "CONDITIONING")
    graph.wire(7, 1, 23, "clip", "CLIP")
    graph.wire(22, 1, 23, "negative", "CONDITIONING")
    # 掩膜支路:LoadImage.MASK→[54]→[55](潜限噪)→采样;[54]→[56].mask 回贴
    graph.wire(17, 1, 54, "mask", "MASK")
    graph.wire(54, 0, 55, "mask", "MASK")
    graph.wire(21, 0, 55, "samples", "LATENT")
    graph.wire(14, 0, 25, "model", "MODEL")
    graph.wire(23, 0, 25, "positive", "CONDITIONING")
    graph.wire(23, 2, 25, "negative", "CONDITIONING")
    graph.wire(55, 0, 25, "latent_image", "LATENT")
    graph.wire(24, 0, 25, "seed", "INT")
    graph.wire(15, 0, 25, "steps", "INT")
    graph.wire(16, 0, 25, "cfg", "FLOAT")
    graph.wire(25, 0, 26, "samples", "LATENT")
    graph.wire(7, 2, 26, "vae", "VAE")
    graph.wire(19, 0, 56, "destination", "IMAGE")
    graph.wire(26, 0, 56, "source", "IMAGE")
    graph.wire(54, 0, 56, "mask", "MASK")
    graph.wire(56, 0, 27, "images", "IMAGE")

    canvas = graph.finish(groups)
    api_doc = (
        f"SenseNova 局部重绘 直投模板(=画布件 sn-局部重绘.json 的平铺,自由模式,默认臂=Turbo "
        f"{facts['turbo_steps']} 步)。注入锚:指令→2.value / 参考图名→17.image / seed→24.value / "
        f"Turbo→9.value(true=LoRA+{facts['turbo_steps']} 步+cfg{facts['turbo_cfg']},false="
        f"{facts['native_steps']} 步+cfg{facts['native_cfg']})。掩膜=LoadImage 含 alpha 的输入件 "
        "(MaskEditor 保存件),无 alpha=全零掩膜=零重绘。直投前须剥除本 _doc 键。")
    api = g._flatten(canvas, api_doc)

    def render(obj):
        # 11-26 布局整治 P1:落盘统一走底座生成器的 render(画布件先过整理器,
        # API 件原样),保证 sn-局部重绘 与批处理整治结果同字节。
        return g.render(obj)

    if not args.dry_run:
        (OUT_DIR / "sn-局部重绘.json").write_bytes(render(canvas))
        (OUT_DIR / "sn-局部重绘-api.json").write_bytes(render(api))
        print(f"OK 已写 {OUT_DIR}/sn-局部重绘.json + -api.json")
    print(f"OK sn-局部重绘 构建完成:画布 {len(canvas['nodes'])} 件,线 {len(canvas['links'])} 条")
    return 0


def _require_mask_slot(graph, nid):
    """LoadImage[17] 须有 MASK 出槽(官方模板自带;缺=模板改版拒生成)。"""
    outs = graph.by_id[nid]["outputs"]
    if not any(o["type"] == "MASK" for o in outs):
        raise SystemExit(f"[sn_local_inpaint_build_1126] LoadImage[{nid}] 无 MASK 出槽(官方模板改版)")


if __name__ == "__main__":
    raise SystemExit(main())
