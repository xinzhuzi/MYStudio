# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""无衣物管线(sidecar 内路径,09-04-krea2-uncloth-node)。

脚本版(scripts/uncloth_pipeline.py)的同源实现:双分割(segformer_b3_clothes ∥
fashn-human-parser)取衣物蒙版并集 → 两遍 masked SDEdit(脱衣+校色,
引擎 generate_masked_sdedit=ComfyUI SetLatentNoiseMask 等价)。分段日志。
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

    def _guided_filter(guide, src, radius, eps=1e-6):
        """He et al. fast guided filter(保边平滑):与 LayerStyle 的
        guided_filter_alpha 同算法族——蒙版边缘柔化但保留衣物/发丝边界。"""
        import numpy as _np2

        def box_filter(img, r):
            # 积分图实现 O(1) 均值滤波
            cum = _np2.cumsum(_np2.cumsum(img, axis=0), axis=1)
            cum = _np2.pad(cum, ((1, 0), (1, 0)))
            h, w = img.shape[:2]
            y2, x2 = _np2.minimum(_np2.arange(h) + r + 1, h), _np2.minimum(_np2.arange(w) + r + 1, w)
            y1, x1 = _np2.maximum(_np2.arange(r, 0, -1) - r - 1 + _np2.arange(r, 0, -1) * 0, 0), _np2.maximum(_np2.arange(w) - r - 1, 0)
            # 简洁实现:用 cv2 风格的 boxFilter 语义
            from PIL import ImageFilter as _IF
            if img.ndim == 2:
                return _np2.asarray(
                    Image.fromarray((img * 255).astype("uint8"), "L").filter(_IF.BoxBlur(radius)),
                    dtype="float32",
                ) / 255.0
            return img

        # 转灰度 guide(蒙版已是灰度)
        I = guide if guide.ndim == 2 else guide.mean(axis=-1)
        P = src if src.ndim == 2 else src.mean(axis=-1)

        mean_I = box_filter(I, radius)
        mean_P = box_filter(P, radius)
        mean_IP = box_filter(I * P, radius)
        cov_IP = mean_IP - mean_I * mean_P
        mean_II = box_filter(I * I, radius)
        var_I = mean_II - mean_I * mean_I

        a = cov_IP / (var_I + eps)
        b = mean_P - a * mean_I
        mean_a = box_filter(a, radius)
        mean_b = box_filter(b, radius)

        return mean_a * I + mean_b

    detail = params.get("maskDetail") or {}

    def detail_process(m_uint8):
        """SegformerUltraV3 蒙版加工(源码对照 09-04 深化):对比线性拉伸
        (black/white_point)→软化(detail_range//6+1 半径;源码为 GuidedFilter
        保边,此处均值滤波工程近似)→提亮 1.08(源码 Brightness 1.08)。"""
        from PIL import ImageEnhance, ImageFilter

        mask_img = Image.fromarray((m_uint8 * 255).astype("uint8"), mode="L")
        if detail.get("processDetail", True):
            arr = np.asarray(mask_img, dtype="float32") / 255.0
            bp = float(detail.get("blackPoint", 0.01))
            wp = float(detail.get("whitePoint", 0.99))
            arr = np.clip((arr - bp) / max(1e-6, wp - bp), 0, 1)
            mask_img = Image.fromarray((arr * 255).astype("uint8"), mode="L")
            erode = int(detail.get("detailErode", 8))
            dilate = int(detail.get("detailDilate", 6))
            radius = (erode + dilate) // 6 + 1
            # GuidedFilter 保边(替换均值近似,09-04 PRD 二期收口):
            # 以自身为引导图,eps 控制保边强度(小=保边强)
            arr_gf = _guided_filter(arr, arr, radius, eps=1e-4)
            mask_img = Image.fromarray((arr_gf * 255).astype("uint8"), mode="L")
        mask_img = ImageEnhance.Brightness(mask_img).enhance(1.08)
        return (np.asarray(mask_img, dtype="float32") / 255.0 > 0.5).astype(np.uint8)

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
        m = detail_process(raw)
        masks.append(m)
        _log("segformer", parts=list(parts_ids), coverage=f"{float(m.mean()):.1%}", secs=f"{time.time()-t0:.1f}s")
        del model

    if fashn_parts:
        t0 = time.time()
        from transformers import AutoModelForSemanticSegmentation, AutoProcessor

        d = _find_model_dir(models_dir, "fashn-human-parser")
        _fdev = params.get("fashnDevice", "cpu")
        _fdtype = {"float32": "float32", "float16": "float16", "bfloat16": "bfloat16"}.get(
            params.get("fashnDtype", "float32"), "float32")
        model = AutoModelForSemanticSegmentation.from_pretrained(
            str(d), torch_dtype=getattr(torch, _fdtype, torch.float32)
        ).to(device=_fdev).eval()
        processor = AutoProcessor.from_pretrained(str(d))
        inputs = processor(images=img, return_tensors="pt").to(device=_fdev, dtype=getattr(torch, _fdtype, torch.float32))
        with torch.no_grad():
            logits = model(**inputs).logits
        logits = torch.nn.functional.interpolate(logits.float(), size=(img.height, img.width), mode="bilinear")[0]
        seg = logits.argmax(0).cpu().numpy()
        id2label = model.config.id2label
        wanted = {i for i, label in id2label.items() if any(p in str(label).lower() for p in fashn_parts)}
        m = np.isin(seg, list(wanted)).astype(np.uint8) if wanted else np.zeros_like(seg)
        masks.append(m)
        _log("fashn", labels=fashn_parts, coverage=f"{float(m.mean()):.1%}", secs=f"{time.time()-t0:.1f}s")
        del model

    if not masks:
        raise RuntimeError("两套分割部位均为空,无重绘区域")
    union = (sum(masks) > 0).astype(np.uint8)
    union_img = Image.fromarray((union * 255).astype("uint8"), mode="L")
    _log("mask-union", coverage=f"{float(union.mean()):.1%}")

    from PIL import ImageFilter

    def grow(mask_img: Any, px: int) -> Any:
        if px > 0:
            return mask_img.filter(ImageFilter.MaxFilter(2 * px + 1))
        if px < 0:
            return mask_img.filter(ImageFilter.MinFilter(2 * (-px) + 1))
        return mask_img

    mask_undress = grow(union_img, int(params.get("growUndress", -16)))
    mask_color = grow(union_img, int(params.get("growColor", 16)))
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

    out2 = krea2.generate_masked_sdedit(
        prompt, out1, mask_color,
        steps=steps, seed=int(params.get("seedColor", 1)),
        denoise=float(params.get("denoiseColor", 0.3)),
        use_lora=True, loras=loras, **engine_ctx,
    )
    _log("pass2-color", denoise=params.get("denoiseColor"), seed=params.get("seedColor"))

    buf = io.BytesIO()
    out2.save(buf, format="PNG")
    _log("done", total=f"{time.time()-t_all:.1f}s")
    return base64.b64encode(buf.getvalue()).decode()

# 审查②注记(09-04):cfg/sampler/scheduler 字段存储在节点供用户查看与未来
# 引擎扩展,当前引擎(diffusers FlowMatchEulerDiscreteScheduler)与工作流
# euler/simple 同构;cfg=1↔guidance=0 同语义已固化在引擎 GUIDANCE_SCALE。
