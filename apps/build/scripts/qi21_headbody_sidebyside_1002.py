#!/usr/bin/env python3
# ⑥㉒头身比对拍·并排图+8分格(2026-10-02,10-01-qi21-usetest-batch ㉒)
# 用法:python3 qi21_headbody_sidebyside_1002.py <anchored.png> <baseline.png> <out.png>
# 两图同尺寸(同seed同型同速);左=有锚(工作区现态),右=去锚(HEAD 态);叠加
# 全画幅高 8 等分横线(目测头身比标尺——立像主体约占满画幅高,格数≈头身单位)。
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ANCHOR_SENT = "头身比约七头半"


def main() -> int:
    a_path, b_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    h = min(a.height, b.height)
    if a.height != h:
        a = a.resize((int(a.width * h / a.height), h), Image.LANCZOS)
    if b.height != h:
        b = b.resize((int(b.width * h / b.height), h), Image.LANCZOS)
    gap = 24
    canvas = Image.new("RGB", (a.width + b.width + gap, h + 34), (24, 24, 28))
    canvas.paste(a, (0, 34))
    canvas.paste(b, (a.width + gap, 34))
    d = ImageDraw.Draw(canvas)
    # 8 分格横线(两图各自画;红=中线 4/8)
    for x0, w in ((0, a.width), (a.width + gap, b.width)):
        for i in range(1, 8):
            y = 34 + h * i / 8
            d.line([(x0, y), (x0 + w, y)], fill=(255, 80, 80) if i == 4 else (255, 255, 255), width=1)
        for i in range(8):
            y0 = 34 + h * i / 8
            d.rectangle([x0 + w - 30, y0 + 3, x0 + w - 3, y0 + 29], outline=(255, 216, 0))
    # ASCII 标签(默认位图字体无中文)
    d.text((8, 8), "LEFT = WITH head-ratio anchor (workspace)   |   RIGHT = NO anchor (HEAD baseline)   |   grid = 1/8 frame-height", fill=(240, 240, 240))
    canvas.save(out)
    print(out, canvas.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
