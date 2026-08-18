#!/usr/bin/env python3
"""程序化烘焙 HaldCLUT 胶片风 LUT 集（Trellis 08-18-haldclut-grade）。

背景：交接文档建议的两个 LUT 源（cedeber/hald-clut=GPL-3.0 且内部含 Apple/
Pixelmator 专有条款；G'MIC 系=CECILL 系）均不过 D4 门槛（CC0/MIT/Apache/BSD/
CC-BY-4.0）——改自生成：胶片风调色数学烘焙为 HaldCLUT PNG，零许可风险。
命名标注 film-*-（灵感来自胶片风，非型号仿真），诚实口径。

LUT 排列（与 GLGradeLayer shader 采样公式配对，自洽即可）：
  512×512 PNG，8×8 块网格；块(bx,by) 选蓝色通道 b=(by*8+bx)/63 均匀 64 级；
  块内 64×64：行=绿色 g=row/63，列=红色 r=col/63。
  采样：lut(uv) → 块坐标=vec2(mod(uv.x*8,1), floor(uv.x*8)/8...) 见 shader 注释。

用法: python3 apps/build/scripts/generate-luts.py  # 幂等重烘
"""
import pathlib
from PIL import Image

OUT = pathlib.Path(__file__).resolve().parents[2] / "frontend/assets/luts"
GRID = 8      # 8×8 块
RES = 64      # 块内 64×64（即 RGB 各 64 级）
SIZE = GRID * RES  # 512


def clamp01(x):
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


def smooth(x):
    # 平滑色彩曲线基底
    return x * x * (3 - 2 * x)


def lift_gain_gamma(rgb, lift=0.0, gain=1.0, gamma=1.0):
    return [clamp01((max(c, 0.0) + lift) * gain) ** gamma for c in rgb]


def mix(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def saturation(rgb, s):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return [clamp01(l + (c - l) * s) for c in rgb]


def split_tone(rgb, shadow_tint, highlight_tint, amount):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    tint = mix(shadow_tint, highlight_tint, smooth(l))
    return [clamp01(c + (t - 0.5) * amount * 2 * (0.4 + 0.6 * (1 - abs(l - 0.5) * 2)))
            for c, t in zip(rgb, tint)]


def make_teal_orange(rgb):
    c = lift_gain_gamma(rgb, lift=0.008, gain=1.04, gamma=0.96)
    c = split_tone(c, shadow_tint=(0.36, 0.50, 0.56), highlight_tint=(1.0, 0.94, 0.82), amount=0.22)
    return saturation(c, 1.12)


def make_fuji_cool(rgb):
    c = lift_gain_gamma(rgb, lift=0.012, gain=1.02, gamma=1.04)
    c = split_tone(c, shadow_tint=(0.42, 0.52, 0.62), highlight_tint=(0.94, 0.97, 1.0), amount=0.18)
    return saturation(c, 0.94)


def make_kodak_warm(rgb):
    c = lift_gain_gamma(rgb, lift=0.014, gain=1.05, gamma=0.92)
    c = split_tone(c, shadow_tint=(0.48, 0.42, 0.36), highlight_tint=(1.0, 0.9, 0.76), amount=0.24)
    return saturation(c, 1.08)


def make_bleach_bypass(rgb):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    c = mix(rgb, [l, l, l], 0.55)
    c = lift_gain_gamma(c, lift=-0.02, gain=1.28, gamma=0.88)
    return saturation(c, 0.62)


def make_sepia_ink(rgb):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    sep = [clamp01(l * 1.02), clamp01(l * 0.88), clamp01(l * 0.66)]
    return mix(rgb, sep, 0.8)


def make_cyan_mist(rgb):
    c = lift_gain_gamma(rgb, lift=0.02, gain=0.98, gamma=1.06)
    c = mix(c, [c[0] * 0.9 + 0.06, c[1] * 0.98 + 0.05, c[2] * 1.0 + 0.09], 0.7)
    return saturation(c, 0.86)


def make_mute_sage(rgb):
    c = lift_gain_gamma(rgb, lift=0.01, gain=0.97, gamma=1.02)
    c = split_tone(c, shadow_tint=(0.38, 0.44, 0.40), highlight_tint=(0.92, 0.95, 0.88), amount=0.16)
    return saturation(c, 0.78)


def make_noir_contrast(rgb):
    l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    l = clamp01((l - 0.5) * 1.35 + 0.5)
    return [l, l, l]


LUTS = {
    "film-teal-orange": (make_teal_orange, "经典电影橙青对比（暗部青、亮部暖橙）"),
    "film-fuji-cool": (make_fuji_cool, "富士冷调（青蓝阴影、柔和高光）"),
    "film-kodak-warm": (make_kodak_warm, "柯达暖调（琥珀高光、暖褐阴影）"),
    "film-bleach-bypass": (make_bleach_bypass, "漂白旁路（低饱和高对比）"),
    "film-sepia-ink": (make_sepia_ink, "旧纸墨棕（宣纸陈色，道劫向）"),
    "film-cyan-mist": (make_cyan_mist, "青雾（低对比冷雾感）"),
    "film-mute-sage": (make_mute_sage, "灰绿低饱和（水墨淡彩向）"),
    "film-noir-contrast": (make_noir_contrast, "黑白高对比"),
}


def bake(fn):
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    for by in range(GRID):
        for bx in range(GRID):
            b = (by * GRID + bx) / (RES - 1)
            for row in range(RES):
                g = row / (RES - 1)
                for col in range(RES):
                    r = col / (RES - 1)
                    out = fn([r, g, b])
                    x = bx * RES + col
                    y = by * RES + row
                    px[x, y] = tuple(int(clamp01(c) * 255 + 0.5) for c in out)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["# 自生成胶片风 HaldCLUT 许可清单", "",
             "> 生成源:`apps/build/scripts/generate-luts.py`（本仓库自有代码，MIT 随仓库）。"
             "原建议源 cedeber/hald-clut 为 GPL-3.0 且含 Apple/Pixelmator 专有条款、G'MIC 系为 CECILL——"
             "均不过 D4 门槛（2026-08-18 核查），故改为程序化烘焙；命名 film-* 为胶片风灵感，非型号仿真。", "",
             "| LUT id | 文件 | 说明 |", "|---|---|---|"]
    for name, (fn, desc) in sorted(LUTS.items()):
        img = bake(fn)
        path = OUT / f"{name}.png"
        img.save(path, optimize=True)
        lines.append(f"| `{name}` | `{path.name}` | {desc} |")
        print(f"baked {name}: {path.stat().st_size // 1024}KB")
    (OUT / "LICENSES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("LICENSES.md written")


if __name__ == "__main__":
    main()
