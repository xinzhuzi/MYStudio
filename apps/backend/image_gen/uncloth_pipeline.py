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
    target_px = int(mp * 1_000_000)
    if img.width * img.height > target_px:
        scale = (target_px / (img.width * img.height)) ** 0.5
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    _log("input", size=f"{img.width}x{img.height}")

    # 1. 双分割并集
    masks = []
    parts_ids = params.get("segformerParts") or []
    fashn_parts = [p.strip() for p in (params.get("fashnParts") or "").split(",") if p.strip()]

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
            mask_img = mask_img.filter(ImageFilter.BoxBlur(radius=radius))
        mask_img = ImageEnhance.Brightness(mask_img).enhance(1.08)
        return (np.asarray(mask_img, dtype="float32") / 255.0 > 0.5).astype(np.uint8)

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
        model = AutoModelForSemanticSegmentation.from_pretrained(str(d)).eval()
        processor = AutoProcessor.from_pretrained(str(d))
        inputs = processor(images=img, return_tensors="pt")
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
    out1 = krea2.generate_masked_sdedit(
        prompt, img, mask_undress,
        steps=steps, seed=int(params.get("seedUndress", 3)),
        denoise=float(params.get("denoiseUndress", 0.65)),
        use_lora=True, **engine_ctx,
    )
    _log("pass1-undress", denoise=params.get("denoiseUndress"), seed=params.get("seedUndress"))

    out2 = krea2.generate_masked_sdedit(
        prompt, out1, mask_color,
        steps=steps, seed=int(params.get("seedColor", 1)),
        denoise=float(params.get("denoiseColor", 0.3)),
        use_lora=True, **engine_ctx,
    )
    _log("pass2-color", denoise=params.get("denoiseColor"), seed=params.get("seedColor"))

    buf = io.BytesIO()
    out2.save(buf, format="PNG")
    _log("done", total=f"{time.time()-t_all:.1f}s")
    return base64.b64encode(buf.getvalue()).decode()
