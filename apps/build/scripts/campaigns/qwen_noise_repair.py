#!/usr/bin/env python3
"""Qwen-Image-Edit-2511 指令式噪点精修(gpt-image-noise-repair Phase 3)。

背景:本地 Qwen 指向版是 QwenImageEditPlusPipeline(指令编辑),无 img2img
denoise 旋钮——B 站 ZIT 低重绘法不可直接平移。本脚本改用其本行能力:
指令式"去噪保构图"编辑。人脸变形风险高于纯图像法,只作高档精修。

用法:
  PYTHONPATH=apps/backend <venv>/bin/python3 qwen_noise_repair.py IN.png -o OUT.png \
      [--steps 20] [--seed 7] [--prompt-file F]

默认提示词 = 去噪保真指令(中文);实弹约 11 分钟/张(20 步,MPS)。
"""
from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

DEFAULT_PROMPT = (
    "清除画面中的噪点、霉斑和杂色颗粒,保持构图、人物、表情、服装、色彩、"
    "水墨风格与所有细节完全不变,输出干净平滑的完成图。"
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    args = ap.parse_args()

    from image_gen.pipeline import generate_image

    raw = base64.b64encode(Path(args.input).read_bytes()).decode("ascii")
    # 参考图即画布底图:编辑管线以输入图为基础做指令修复
    b64 = generate_image(
        "qwen-image-edit-2511",
        prompt=args.prompt,
        aspect_ratio="16:9",
        reference_image_b64=raw,
        num_inference_steps=args.steps,
        seed=args.seed,
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    print(f"ok {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
