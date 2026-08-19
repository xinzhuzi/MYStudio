"""人物净底图色键抠底(08-19 multilayer-composition Child3).

与 layered-generation.ts 的 matteSolidBackground 同一算法的文件级实现
(node 侧无 canvas,落盘经系统 Python+Pillow):
  输入=纯绿幕(#00b140)人物净底图,输出=RGBA PNG(alpha 键色透明+边缘过渡带)。
用法:
  python3 -m layer_separation.matte --input subject-green.png --output subject.png
键色/容差与 TS 侧常量配对(key 0x00b140, tolerance 96, edge×2.2)。
"""

from __future__ import annotations

import argparse
import sys

from PIL import Image

KEY = (0x00, 0xB1, 0x40)
TOLERANCE_SQ = 96 * 96
EDGE_BAND_SQ = TOLERANCE_SQ * 2.2


def matte(pixels: Image.Image) -> Image.Image:
    rgba = pixels.convert("RGBA")
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = rgba.getpixel((x, y))
            dist_sq = (r - KEY[0]) ** 2 + (g - KEY[1]) ** 2 + (b - KEY[2]) ** 2
            if a == 0:
                continue
            if dist_sq <= TOLERANCE_SQ:
                rgba.putpixel((x, y), (r, g, b, 0))
            elif dist_sq <= EDGE_BAND_SQ:
                t = (dist_sq - TOLERANCE_SQ) / (EDGE_BAND_SQ - TOLERANCE_SQ)
                rgba.putpixel((x, y), (r, g, b, int(a * min(1.0, t))))
    return rgba


def main() -> int:
    parser = argparse.ArgumentParser(description="净底人物图色键抠底 → RGBA PNG")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    source = Image.open(args.input)
    matted = matte(source)
    matted.save(args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
