# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""无衣物管线独立脚本(09-04-krea2-uncloth-node,Q9 裁定:脚本先行)。

忠实复刻 ComfyUI「Krea2-NSFW专业流-改图-无衣物」:
  输入图(等比缩 MP)→ 双分割(segformer_b3_clothes ∥ fashn-human-parser)
  → 蒙版并集 → 两遍采样(遍1 脱衣 denoise+蒙版收缩;遍2 校色 denoise+过渡带)
  → 像素域合成(SetLatentNoiseMask 的工程近似)

全程分段日志(分割耗时/蒙版面积/两遍参数与耗时)。模型查找顺序:
  1) $MYSTUDIO_IMAGE_MODEL_DIR/<name>/(应用侧正式位置)
  2) 本机 ComfyUI 目录(开发验证借用,只读)

用法:
  python uncloth_pipeline.py --input in.png --output out.png \
    [--prompt-file p.txt] [--denoise-undress 0.65] [--denoise-color 0.3]
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_ROOT))

MODEL_ROOTS = [
    Path(os.environ["MYSTUDIO_IMAGE_MODEL_DIR"]).expanduser()
    if os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR")
    else Path.home() / "Library/Application Support/漫影工作室/model/imagegen",
    Path.home() / "Project/ComfyUI/models",
    Path.home() / "ComfyUI-Shared/models",
]


def log(stage: str, **fields) -> None:
    parts = " ".join(f"{k}={v}" for k, v in fields.items())
    print(f"[uncloth] {stage} | {parts}", flush=True)


def find_model_dir(name: str) -> Path:
    for root in MODEL_ROOTS:
        if root is None:
            continue
        candidate = root / name
        if (candidate / "config.json").exists():
            return candidate
    searched = ", ".join(str(r) for r in MODEL_ROOTS)
    raise SystemExit(f"[uncloth] 模型 {name} 未找到(搜索:{searched})——请先在设置-本地配置下载")


def load_runway_image(data_or_path, megapixels: float):
    from PIL import Image

    if isinstance(data_or_path, (bytes,)):
        img = Image.open(io.BytesIO(data_or_path)).convert("RGB")
    else:
        img = Image.open(data_or_path).convert("RGB")
    target_px = int(megapixels * 1_000_000)
    if img.width * img.height > target_px:
        scale = (target_px / (img.width * img.height)) ** 0.5
        img = img.resize(
            (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
            Image.LANCZOS,
        )
    log("input", size=f"{img.width}x{img.height}")
    return img


def segment_mask(img, parts_ids, fashn_parts, guided):
    """双分割并集蒙版(segformer 部位 id ∥ fashn 标签),返回 PIL L 模式(255=重绘区)。"""
    import numpy as np
    import torch
    from PIL import Image
    from transformers import AutoModelForSemanticSegmentation, AutoProcessor

    masks = []

    # 1) segformer_b3_clothes(id 键控)
    if parts_ids:
        t0 = time.time()
        d = find_model_dir("segformer_b3_clothes")
        model = AutoModelForSemanticSegmentation.from_pretrained(str(d)).eval()
        processor = AutoProcessor.from_pretrained(str(d))
        inputs = processor(images=img, return_tensors="pt")
        with torch.no_grad():
            logits = model(**inputs).logits  # (1, classes, h/4, w/4)
        logits = torch.nn.functional.interpolate(
            logits.unsqueeze(0).float() if logits.dim() == 3 else logits.float(),
            size=(img.height, img.width),
            mode="bilinear",
        )[0]
        seg = logits.argmax(0).cpu().numpy()
        mask = np.isin(seg, list(parts_ids)).astype(np.uint8)
        masks.append(mask)
        coverage = float(mask.mean())
        log("segformer", parts=list(parts_ids), coverage=f"{coverage:.1%}", secs=f"{time.time()-t0:.1f}s")

    # 2) fashn-human-parser(标签键控)
    if fashn_parts:
        t0 = time.time()
        d = find_model_dir("fashn-human-parser")
        model = AutoModelForSemanticSegmentation.from_pretrained(str(d)).eval()
        processor = AutoProcessor.from_pretrained(str(d))
        inputs = processor(images=img, return_tensors="pt")
        with torch.no_grad():
            logits = model(**inputs).logits
        logits = torch.nn.functional.interpolate(
            logits.float(), size=(img.height, img.width), mode="bilinear"
        )[0]
        seg = logits.argmax(0).cpu().numpy()
        id2label = model.config.id2label
        wanted = {
            i for i, label in id2label.items() if any(p in str(label).lower() for p in fashn_parts)
        }
        mask = np.isin(seg, list(wanted)).astype(np.uint8) if wanted else np.zeros_like(seg)
        masks.append(mask)
        log("fashn", labels=list(fashn_parts), ids=sorted(wanted), coverage=f"{float(mask.mean()):.1%}", secs=f"{time.time()-t0:.1f}s")

    if not masks:
        raise SystemExit("[uncloth] 两套分割部位均为空,无重绘区域")
    union = (sum(masks) > 0).astype(np.uint8)
    log("mask-union", coverage=f"{float(union.mean()):.1%}")
    return Image.fromarray((union * 255).astype("uint8"), mode="L")


def grow_mask(mask_img, px: int):
    """GrowMask:正=外扩(膨胀),负=收缩(腐蚀)。numpy 极简实现(足额迭代圆盘)。"""
    import numpy as np
    from PIL import ImageFilter

    if px >= 0:
        out = mask_img.filter(ImageFilter.MaxFilter(2 * px + 1)) if px > 0 else mask_img
    else:
        out = mask_img.filter(ImageFilter.MinFilter(2 * (-px) + 1))
    return out


def composite(foreground, background, mask_img):
    """像素域合成(SetLatentNoiseMask 工程近似):蒙版白区取前景。"""
    from PIL import Image as _I
    return _I.composite(foreground, background, mask_img)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--prompt-file")
    parser.add_argument("--prompt")
    parser.add_argument("--denoise-undress", type=float, default=0.65)
    parser.add_argument("--denoise-color", type=float, default=0.3)
    parser.add_argument("--seed-undress", type=int, default=3)
    parser.add_argument("--seed-color", type=int, default=1)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--grow-undress", type=int, default=-16)
    parser.add_argument("--grow-color", type=int, default=16)
    parser.add_argument("--megapixels", type=float, default=1.0)
    parser.add_argument("--parts", default="4,5,6,7,8,12,13,14,15")
    parser.add_argument("--fashn-parts", default="dress,skirt,pants,belt,arms,legs")
    args = parser.parse_args()

    from PIL import Image as _PILImage  # noqa: F401(合成段使用)

    prompt = args.prompt or (Path(args.prompt_file).read_text(encoding="utf-8") if args.prompt_file else "")
    if not prompt:
        raise SystemExit("[uncloth] 提示词为空(--prompt 或 --prompt-file)")

    img = load_runway_image(args.input, args.megapixels)
    union = segment_mask(
        img,
        parts_ids={int(p) for p in args.parts.split(",") if p.strip()},
        fashn_parts=[p.strip() for p in args.fashn_parts.split(",") if p.strip()],
        guided=None,
    )
    mask_undress = grow_mask(union, args.grow_undress)
    mask_color = grow_mask(union, args.grow_color)

    # Krea2 SDEdit(与 krea2.generate 同款双遍:复用引擎函数);ctx 与
    # pipeline.generate_image 同款构建(comfyui_models_dir + hf snapshot)
    from image_gen import model_cache
    from image_gen.engines import krea2

    def to_data_url(image):
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    small_repo = getattr(krea2, "SMALL_REPO", getattr(krea2, "IMAGE_REPO", None))
    ctx = {
        "models_dir": model_cache.comfyui_models_dir(),
        "snapshot_dir": model_cache.hf_snapshot_dir(small_repo) if small_repo else None,
    }

    # latent 域蒙版 SDEdit(引擎 generate_masked_sdedit:ComfyUI
    # SetLatentNoiseMask 等价——蒙版外原图锚定;像素合成近似已被实弹否决)
    t0 = time.time()
    out1 = krea2.generate_masked_sdedit(
        prompt, img, mask_undress, steps=args.steps, seed=args.seed_undress,
        denoise=args.denoise_undress, use_lora=True, **ctx,
    )
    log("pass1-undress", denoise=args.denoise_undress, seed=args.seed_undress, secs=f"{time.time()-t0:.1f}s")

    t1 = time.time()
    out2 = krea2.generate_masked_sdedit(
        prompt, out1, mask_color, steps=args.steps, seed=args.seed_color,
        denoise=args.denoise_color, use_lora=True, **ctx,
    )
    log("pass2-color", denoise=args.denoise_color, seed=args.seed_color, secs=f"{time.time()-t1:.1f}s")

    out2.save(args.output)
    log("done", output=args.output, total=f"{time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
