"""深度图图层分离器——把单张图拆为背景层+主体层。

原理：用 Depth Anything V2 生成深度图 → 阈值分割 → 主体带 alpha，
背景被遮挡区域用高斯模糊填充（视觉上近似"画师补画被挡住的背景"）。
复用现有 depth_estimation 基建，模型仍走显式下载政策。

Usage:
  python -m layer_separation.separator --input image.png \
      --subject-out subject.png --background-out background.png
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def separate_layers(
    input_path: str,
    subject_output: str,
    background_output: str,
    threshold: float = 0.45,
    blur_radius: int = 15,
    depth_model: str = "depth-anything-v2-small",
) -> dict:
    """拆分图层。返回统计信息。

    Raises DepthEstimationError（透传自深度估计）。
    """
    from depth_estimation.adapter import estimate_depth

    depth_tmp = str(Path(subject_output).parent / "_depth_tmp.png")
    result = estimate_depth(input_path, depth_tmp, depth_model)
    if result.get("status") != "accepted":
        raise RuntimeError(f"深度估计失败: {result}")

    img = Image.open(input_path).convert("RGB")
    depth_img = Image.open(depth_tmp).convert("L")
    w, h = img.size
    depth_img = depth_img.resize((w, h))
    d = np.array(depth_img, dtype=np.float32) / 255.0

    # 近处（depth 大）为主体
    subject_mask = d > threshold

    rgb = np.array(img)
    alpha = (subject_mask * 255).astype(np.uint8)
    subject_rgba = np.dstack([rgb, alpha])
    Image.fromarray(subject_rgba, "RGBA").save(subject_output)

    bg_blur = np.array(img.filter(ImageFilter.GaussianBlur(radius=blur_radius)))
    bg = rgb.copy()
    bg[subject_mask] = bg_blur[subject_mask]
    Image.fromarray(bg).save(background_output)

    Path(depth_tmp).unlink(missing_ok=True)

    subject_pct = float(subject_mask.sum() / subject_mask.size * 100)
    return {
        "status": "accepted",
        "subjectOutput": str(Path(subject_output).resolve()),
        "backgroundOutput": str(Path(background_output).resolve()),
        "subjectPercent": round(subject_pct, 1),
        "backgroundPercent": round(100 - subject_pct, 1),
        "threshold": threshold,
        "dimensions": f"{w}x{h}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio 图层分离")
    parser.add_argument("--input", required=True)
    parser.add_argument("--subject-out", required=True)
    parser.add_argument("--background-out", required=True)
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument("--blur-radius", type=int, default=15)
    args = parser.parse_args()
    result = separate_layers(
        args.input, args.subject_out, args.background_out, args.threshold, args.blur_radius
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
