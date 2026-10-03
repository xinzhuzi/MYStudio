#!/usr/bin/env python3
"""R26.4 t2i 开/关两图并排拼图(0924;引擎 venv PIL)。

左=关态 40 步全图(r26-t2i-off-seed0-full.png),右=开态 4 步加速图
(r26-t2i-on-seed0-4step.png);同高缩放,白底横排,写
apps/out/q21-final-0924/r26-t2i-on-off.png。

用法: "<comfy-home>/venv/bin/python" apps/build/scripts/qi21_r26_compose_0924.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HOME = Path.home()
OFF = HOME / "Downloads/q21-final-0924/r26/r26-t2i-off-seed0-full.png"
ON = HOME / "Downloads/q21-final-0924/r26/r26-t2i-on-seed0-4step.png"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HOME / "Project/Github/MYStudio/apps/out/q21-final-0924/r26-t2i-on-off.png"

GAP = 24
TARGET_H = 1024


def main() -> int:
    if not OFF.exists():
        print(f"missing: {OFF}")
        return 2
    if not ON.exists():
        print(f"missing: {ON}")
        return 2
    a = Image.open(OFF).convert("RGB")
    b = Image.open(ON).convert("RGB")
    print(f"off: {a.size}  on: {b.size}")
    a = a.resize((round(a.width * TARGET_H / a.height), TARGET_H), Image.LANCZOS)
    b = b.resize((round(b.width * TARGET_H / b.height), TARGET_H), Image.LANCZOS)
    canvas = Image.new("RGB", (a.width + GAP + b.width, TARGET_H), (255, 255, 255))
    canvas.paste(a, (0, 0))
    canvas.paste(b, (a.width + GAP, 0))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "PNG")
    print(f"wrote: {OUT} ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
