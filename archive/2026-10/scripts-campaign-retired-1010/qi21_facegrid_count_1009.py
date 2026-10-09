#!/usr/bin/env python3
"""表情差分九宫格数脸验收器(1009 逐格点位轮)。

方法=交接口径:逐列条带(x 三等分)y 向轮廓数脸块——
  每列条带内,按行统计前景像素(alpha>128;无 alpha 图回落亮度<200 反相),
  行填充>条带宽 15% 视为实心行,连续实心行段=一个块;
  块高>60px 且块内实心占比>0.25 计为一张脸。
判据:三列条带各=3 块 → 9/9。

用法:python3 qi21_facegrid_count_1009.py <png>
"""
import sys
from pathlib import Path

from PIL import Image


def band_blocks(mask, x0, x1, min_fill=0.15, min_h=60, min_solid=0.25):
    h, w = mask.shape
    bw = x1 - x0
    runs, start = [], None
    for y in range(h):
        fill = mask[y, x0:x1].sum() / bw
        if fill > min_fill:
            if start is None:
                start = y
        else:
            if start is not None:
                runs.append((start, y))
                start = None
    if start is not None:
        runs.append((start, h))
    faces = []
    for a, b in runs:
        if b - a < min_h:
            continue
        solid = mask[a:b, x0:x1].sum() / (bw * (b - a))
        if solid > min_solid:
            faces.append((a, b, round(solid, 2)))
    return faces


def main(p):
    img = Image.open(p)
    w, h = img.size
    if "A" in img.getbands():
        a = img.getchannel("A")
        import numpy as np
        mask = np.array(a) > 128
        src = "alpha"
        trans = (np.array(a) < 10).mean()
        if trans < 0.02:  # 透明通道在场但图几乎全不透明→按实底图回落
            g = np.array(img.convert("L"))
            mask = g < 200
            src = "luma-fallback"
    else:
        import numpy as np
        g = np.array(img.convert("L"))
        mask = g < 200
        src = "luma"
    print(f"{Path(p).name} {w}x{h} 掩码源={src}")
    total = 0
    for i, (x0, x1) in enumerate([(0, w // 3), (w // 3, 2 * w // 3), (2 * w // 3, w)]):
        faces = band_blocks(mask, x0, x1)
        total += len(faces)
        name = ["左列", "中列", "右列"][i]
        detail = "; ".join(f"y{a}-{b}(实{ s })" for a, b, s in faces) or "无"
        print(f"  {name}: {len(faces)} 块 [{detail}]")
    verdict = "PASS 9/9" if total == 9 else f"FAIL {total}/9"
    print(f"判定: {verdict}")
    return 0 if total == 9 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
