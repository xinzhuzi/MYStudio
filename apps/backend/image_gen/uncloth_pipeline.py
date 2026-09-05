# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""无衣物管线(sidecar 内路径,09-04-krea2-uncloth-node)。

脚本版(scripts/uncloth_pipeline.py)的同源实现:双分割(segformer_b3_clothes ∥
fashn-human-parser)取衣物蒙版并集 → 两遍 masked SDEdit(脱衣+校色,
引擎 generate_masked_sdedit=ComfyUI SetLatentNoiseMask 等价)。分段日志。

09-04 全节点对拍根修:蒙版链与 ComfyUI 工作流逐实现同构——V3 加工链
(引导滤波引导图=原图/软蒙版不二值化,拷贝自 ComfyUI_LayerStyle,MIT)、
fashn 384×576 INTER_AREA 预处理+精确 label 匹配(含 top)、MaskComposite
x=2 偏移软并集、GrowMask 十字灰度形态学。
"""
from __future__ import annotations

import io
import time
from pathlib import Path
from typing import Any

_MODEL_DIRS = [
    Path(__file__).resolve().parent.parent,  # <model_root>/image_gen 自身不存在——占位防御
]


def _find_model_dir(models_dir: Path, name: str) -> Path:
    # 应用正式位置(MYSTUDIO_IMAGE_MODEL_DIR=<userData>/model/imagegen,spawn 注入)
    # 优先;其后回落 ComfyUI 模型根(大件同源的指向策略,开发环境可用)
    import os
    candidates = []
    env_dir = os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR")
    if env_dir:
        candidates.append(Path(env_dir).expanduser() / name)
    candidates += [models_dir / name, models_dir.parent / name]
    for candidate in candidates:
        if (candidate / "config.json").exists():
            return candidate
    searched = ", ".join(str(c.parent) for c in candidates)
    raise RuntimeError(f"分割模型 {name} 未下载:请到 设置→本地配置 显式下载(搜索:{searched})")


def _log(stage: str, **fields) -> None:
    parts = " ".join(f"{k}={v}" for k, v in fields.items())
    print(f"[image-sidecar][uncloth] {stage} | {parts}", flush=True)


def run_uncloth_pipeline(
    prompt: str,
    input_image_b64: str,
    params: dict,
    engine_ctx: dict,
) -> str:
    """完整管线;返回 PNG base64。params=渲染层 resolveUnclothParams 的生效值。"""
    import base64

    import numpy as np
    import torch
    from PIL import Image

    from .engines import krea2

    models_dir = Path(engine_ctx["models_dir"])
    t_all = time.time()

    # 指令编辑档(09-05 仿写 Krea2_无衣物_快):本地 Krea2Edit 引擎,
    # 无分割蒙版链——grounded encode+参考注意力+denoise=1.0 纯采样
    if params.get("mode") == "instruct":
        from PIL import Image as _PILImage
        raw_ed = input_image_b64.split(",", 1)[-1] if input_image_b64.startswith("data:") else input_image_b64
        img_ed = _PILImage.open(io.BytesIO(base64.b64decode(raw_ed))).convert("RGB")
        out_ed = krea2.generate_edit(
            prompt, img_ed,
            steps=int(params.get("steps", 10)),
            seed=int(params.get("seedUndress", 2)),
            **engine_ctx,
        )
        buf = io.BytesIO()
        out_ed.save(buf, format="PNG")
        _log("done", mode="instruct", total=f"{time.time()-t_all:.1f}s")
        return base64.b64encode(buf.getvalue()).decode()

    # 0. 输入图(等比缩 MP)
    mp = float(params.get("megapixels", 1.0))
    raw = input_image_b64.split(",", 1)[-1] if input_image_b64.startswith("data:") else input_image_b64
    img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
    # upscale_method(当前 lanczos;sidecar Python PIL 同名映射)+ division_factor
    _PIL_RESIZE = {"lanczos": 1, "nearest-exact": 0, "bilinear": 2, "area": 3, "bicubic": 3}  # PIL LANCZOS=1
    method_map = {"lanczos": __import__("PIL.Image", fromlist=["LANCZOS"]).LANCZOS,
                  "nearest-exact": __import__("PIL.Image", fromlist=["NEAREST"]).NEAREST,
                  "bilinear": __import__("PIL.Image", fromlist=["BILINEAR"]).BILINEAR,
                  "area": __import__("PIL.Image", fromlist=["BILINEAR"]).BILINEAR,
                  "bicubic": __import__("PIL.Image", fromlist=["BICUBIC"]).BICUBIC}
    resample = method_map.get(params.get("upscaleMethod", "lanczos"),
                              __import__("PIL.Image", fromlist=["LANCZOS"]).LANCZOS)
    div = max(1, int(params.get("divisionFactor", 1)))
    mp = mp / div  # division_factor 分母(ComfyUI 语义:目标像素/division)
    target_px = int(mp * 1_000_000)
    if img.width * img.height > target_px:
        scale = (target_px / (img.width * img.height)) ** 0.5
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), resample)
    _log("input", size=f"{img.width}x{img.height}")

    # 1. 双分割并集
    masks = []
    parts_ids = params.get("segformerParts") or []
    fashn_parts = [p.strip() for p in (params.get("fashnParts") or "").split(",") if p.strip()]

    # ── 以下两函数同构拷贝自 ComfyUI_LayerStyle py/imagefunc.py(MIT,(c) 2024
    #    chflame163;09-04 全节点对拍根修:此前自研 BoxBlur「近似」非引导滤波,
    #    引导图也没用原图——V3 边缘精修=蒙版边缘吸附原图边界,核心就在引导图) ──
    def _guided_filter_alpha(guide_rgb, mask01, filter_radius):
        """LayerStyle guided_filter_alpha 同参数同构:d=radius+1 奇数化,
        eps=sigma/10=0.015;src 复制三通道进彩色引导,输出取 R 通道
        (源码经 convert('RGB') 复制 + image2mask split()[0],行为照抄)。"""
        import cv2
        from cv2.ximgproc import guidedFilter
        d = filter_radius + 1
        if not d % 2:
            d += 1
        src3 = np.repeat(np.asarray(mask01, dtype="float32")[:, :, None], 3, axis=2)
        out = guidedFilter(np.asarray(guide_rgb, dtype="float32"), src3, d, 0.015)
        return out[:, :, 0].astype("float32")

    def _histogram_remap(arr, blackpoint, whitepoint):
        bp = min(blackpoint, whitepoint - 0.001)
        scale = 1.0 / (whitepoint - bp)
        return np.clip((np.asarray(arr, dtype="float32") - bp) * scale, 0.0, 1.0)

    detail = params.get("maskDetail") or {}

    def detail_process(orig_img, m_uint8):
        """SegformerUltraV3(GuidedFilter 路径)逐行同构(09-04 探查):
        二值 isin → Brightness1.08(源码在 GF 前,二值输入上 no-op,同构保留)
        → guidedFilter(引导图=原图, r=(erode+dilate)//6+1) → histogram_remap
        → 软蒙版(0-255 重绘白,不二值化——工作流全链软值,latent 域边缘渐变)。"""
        from PIL import ImageEnhance

        mask_img = Image.fromarray((m_uint8 * 255).astype("uint8"), mode="L")
        if not detail.get("processDetail", True):
            return np.asarray(mask_img, dtype="float32") / 255.0
        mask_img = ImageEnhance.Brightness(mask_img).enhance(1.08)
        erode = int(detail.get("detailErode", 8))
        dilate = int(detail.get("detailDilate", 6))
        radius = (erode + dilate) // 6 + 1
        guide = np.asarray(orig_img, dtype="float32") / 255.0
        m01 = np.asarray(mask_img, dtype="float32") / 255.0
        m_gf = _guided_filter_alpha(guide, m01, radius)
        m_remap = _histogram_remap(m_gf, float(detail.get("blackPoint", 0.01)),
                                   float(detail.get("whitePoint", 0.99)))
        return m_remap

    # 部位名(ComfyUI 位序)→ ATR/LIP 分割 label id
    PART_TO_ID = {
        "hat": 1, "hair": 2, "sunglass": 3,
        "upper_clothes": 4, "skirt": 5, "pants": 6, "dress": 7, "belt": 8,
        "left_shoe": 9, "right_shoe": 10, "face": 11,
        "left_leg": 12, "right_leg": 13, "left_arm": 14, "right_arm": 15,
        "bag": 16, "scarf": 17,
    }
    parts_ids = sorted({PART_TO_ID[name] for name in parts_ids if name in PART_TO_ID}) if parts_ids and isinstance(parts_ids[0], str) else parts_ids

    if parts_ids:
        t0 = time.time()
        from transformers import AutoModelForSemanticSegmentation, AutoProcessor

        d = _find_model_dir(models_dir, "segformer_b3_clothes")
        model = AutoModelForSemanticSegmentation.from_pretrained(str(d)).eval()
        processor = AutoProcessor.from_pretrained(str(d))
        inputs = processor(images=img, return_tensors="pt")
        with torch.no_grad():
            logits = model(**inputs).logits
        logits = torch.nn.functional.interpolate(logits.float(), size=(img.height, img.width), mode="bilinear")[0]
        seg = logits.argmax(0).cpu().numpy()
        raw = np.isin(seg, list(parts_ids)).astype(np.uint8)
        m = detail_process(img, raw)
        masks.append(m)
        _log("segformer", parts=list(parts_ids), coverage=f"{float(m.mean()):.1%}", secs=f"{time.time()-t0:.1f}s")
        del model

    if fashn_parts:
        t0 = time.time()
        from transformers import AutoModelForSemanticSegmentation

        # FASHN SegFormer-B4 行为同构(comfyui-fashn-human-parser 无 LICENSE,
        # 仿照写而非拷贝,09-04 根修):预处理=硬编码 384×576 INTER_AREA + 手动
        # ImageNet 归一化(弃 AutoProcessor——其尺寸非 384×576,分割边界系统性
        # 偏差);label 精确名匹配(工作流 label 主标签 top=上衣 也在内),
        # label 表读模型自带 config.id2label(事实约定,不抄插件硬编码表)
        _FASHN_MEAN = np.array([0.485, 0.456, 0.406], dtype="float32")
        _FASHN_STD = np.array([0.229, 0.224, 0.225], dtype="float32")

        d = _find_model_dir(models_dir, "fashn-human-parser")
        _fdev = params.get("fashnDevice", "cpu")
        _fdtype = {"float32": "float32", "float16": "float16", "bfloat16": "bfloat16"}.get(
            params.get("fashnDtype", "float32"), "float32")
        model = AutoModelForSemanticSegmentation.from_pretrained(
            str(d), torch_dtype=getattr(torch, _fdtype, torch.float32)
        ).to(device=_fdev).eval()
        import cv2 as _cv2
        img_np = np.asarray(img)
        resized = _cv2.resize(img_np, (384, 576), interpolation=_cv2.INTER_AREA)
        norm = (resized.astype("float32") / 255.0 - _FASHN_MEAN) / _FASHN_STD
        tensor = torch.from_numpy(norm.transpose(2, 0, 1)).unsqueeze(0).to(
            device=_fdev, dtype=getattr(torch, _fdtype, torch.float32))
        with torch.no_grad():
            logits = model(pixel_values=tensor).logits
        logits = torch.nn.functional.interpolate(
            logits.float(), size=(img.height, img.width), mode="bilinear", align_corners=False)[0]
        seg = logits.argmax(0).cpu().numpy()
        id2label = {int(k): str(v).lower() for k, v in dict(model.config.id2label).items()}
        wanted = {i for i, label in id2label.items() if label in set(fashn_parts)}
        m = np.isin(seg, list(wanted)).astype("float32") if wanted else np.zeros(seg.shape, "float32")
        masks.append(m)
        _log("fashn", labels=fashn_parts, coverage=f"{float(m.mean()):.1%}", secs=f"{time.time()-t0:.1f}s")
        del model

    if not masks:
        raise RuntimeError("两套分割部位均为空,无重绘区域")

    # 双模型融合 = MaskComposite(destination=V3软蒙版, source=fashn, x=2, y=0,
    # add) 同构(09-04 对拍):source 右移 2px 贴入(作者对齐双模型系统偏差),
    # 逐像素相加后 clamp(0,1) 饱和并集(软蒙版;旧 sum>0 硬二值并集已弃)
    union = masks[0].astype("float32")
    for extra in masks[1:]:
        x_off, y_off = 2, 0  # 工作流 MaskComposite widgets: x=2, y=0
        h, w = union.shape
        vis_w = min(x_off + extra.shape[1], w) - x_off
        vis_h = min(y_off + extra.shape[0], h) - y_off
        region = union[y_off:y_off + vis_h, x_off:x_off + vis_w]
        union[y_off:y_off + vis_h, x_off:x_off + vis_w] = np.clip(
            region + extra[:vis_h, :vis_w], 0.0, 1.0)
    _log("mask-union", coverage=f"{float(union.mean()):.1%}", soft=True)

    # GrowMask 同构(comfy 核心 grey_erosion/grey_dilation 十字 footprint 迭代,
    # tapered_corners=True;PIL MaxFilter 方形窗口弃用——斜角形状与源不同)
    from scipy import ndimage as _ndi

    _CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)

    def grow(mask_arr: Any, px: int) -> Any:
        out = mask_arr
        for _ in range(abs(px)):
            out = (_ndi.grey_erosion if px < 0 else _ndi.grey_dilation)(out, footprint=_CROSS)
        return out

    mask_undress = Image.fromarray((grow(union, int(params.get("growUndress", -16))) * 255).astype("uint8"), mode="L")
    mask_color = Image.fromarray((grow(union, int(params.get("growColor", 16))) * 255).astype("uint8"), mode="L")
    steps = int(params.get("steps", 8))

    # 2. 两遍 masked SDEdit
    loras = params.get("loras")
    out1 = krea2.generate_masked_sdedit(
        prompt, img, mask_undress,
        steps=steps, seed=int(params.get("seedUndress", 3)),
        denoise=float(params.get("denoiseUndress", 0.65)),
        use_lora=True, loras=loras, **engine_ctx,
    )
    _log("pass1-undress", denoise=params.get("denoiseUndress"), seed=params.get("seedUndress"))

    # 快档(09-05「Krea2_无衣物_快」流):fashn 单分割(segformerParts 空,分支
    # 自然跳过)+单遍即出图,无校色遍无后处理;精档走完整两遍+色彩对齐+硬合成
    if params.get("mode") == "fast":
        buf = io.BytesIO()
        out1.save(buf, format="PNG")
        _log("done", mode="fast", total=f"{time.time()-t_all:.1f}s")
        return base64.b64encode(buf.getvalue()).decode()

    out2 = krea2.generate_masked_sdedit(
        prompt, out1, mask_color,
        steps=steps, seed=int(params.get("seedColor", 1)),
        denoise=float(params.get("denoiseColor", 0.3)),
        use_lora=True, loras=loras, **engine_ctx,
    )
    _log("pass2-color", denoise=params.get("denoiseColor"), seed=params.get("seedColor"))

    # 3. 遍2 后处理(09-05 对齐新版工作流 #98/#99/#100):mkl 色彩对齐(向原图)
    # + 非重绘区像素硬合成原图——治重绘区色差 + 治蒙版外的 VAE 重建微扰
    # (latent 锚定只保 latent 不动,decode 后仍有重建差;新版工作流在像素层
    # 堵死)。color-matcher=上游 pip 库依赖引用(GPL-3.0,AGPL 仓合规;算法
    # 非 KJNodes 插件代码,不拷贝)。
    from color_matcher import ColorMatcher
    gen_np = np.asarray(out2, dtype="float32")
    ref_np = np.asarray(img, dtype="float32")
    mask_final = mask_color
    if ref_np.shape[:2] != gen_np.shape[:2]:
        # 原图(1MP 缩放版)与生成图(16 对齐)尺寸差:以生成图为准重采样
        ref_np = np.asarray(img.resize((out2.width, out2.height), Image.LANCZOS), dtype="float32")
        mask_final = mask_color.resize((out2.width, out2.height), Image.BILINEAR)
    matched = ColorMatcher().transfer(src=gen_np, ref=ref_np, method="mkl")
    matched = np.clip(np.asarray(matched, dtype="float32"), 0, 255)
    m_rgb = (np.asarray(mask_final, dtype="float32") / 255.0)[:, :, None]
    final = matched * m_rgb + ref_np * (1.0 - m_rgb)
    out2 = Image.fromarray(np.clip(final, 0, 255).astype("uint8"))
    _log("post-color-match", method="mkl", composite="hard")

    buf = io.BytesIO()
    out2.save(buf, format="PNG")
    _log("done", total=f"{time.time()-t_all:.1f}s")
    return base64.b64encode(buf.getvalue()).decode()

# 审查②注记(09-04):cfg/sampler/scheduler 字段存储在节点供用户查看与未来
# 引擎扩展,当前引擎(diffusers FlowMatchEulerDiscreteScheduler)与工作流
# euler/simple 同构;cfg=1↔guidance=0 同语义已固化在引擎 GUIDANCE_SCALE。
