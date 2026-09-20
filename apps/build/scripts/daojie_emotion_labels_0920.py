#!/usr/bin/env python3
"""表情差分九宫格情绪标注叠加(09-20 裁定11 补件,幂等)。

用户裁定:「表情差分没有说明这个图片表达的情绪」——行业标准=每格贴情绪标签;
K2 画面内汉字不可行(设定表 CN 实弹),故生成干净九宫格后程序叠加中文标签
(方案=设定表中文标注同款:PingFang.ttc AssetsV2 glob 自愈)。
标签顺序=主体句九情绪点名序(行优先 3×3)。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path.home() / "Downloads/daojie_nineform_recipe_0919/表情差分.png"
DST = Path.home() / "Downloads/daojie_nineform_recipe_0919/表情差分_带标注.png"
EMOTIONS = ["沉静", "含笑", "怒", "哀", "惧", "凌厉", "惊讶", "害羞", "决然"]


def load_font(size: int):
    import glob
    for pat in ("/System/Library/AssetsV2/com_apple_MobileAsset_Font8/*/AssetData/PingFang.ttc",
                str(Path.home() / "Library/Application Support/com.electron.lark.font_workaround/PingFang.ttc")):
        hits = glob.glob(pat)
        if hits:
            return ImageFont.truetype(hits[0], size)
    return ImageFont.load_default()


def main():
    img = Image.open(SRC).convert("RGB")
    w, h = img.size
    cw, ch = w // 3, h // 3
    fs = max(28, ch // 14)
    font = load_font(fs)
    draw = ImageDraw.Draw(img, "RGBA")
    for i, emo in enumerate(EMOTIONS):
        r, c = divmod(i, 3)
        x0, y0 = c * cw, r * ch
        bbox = draw.textbbox((0, 0), emo, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad = fs // 2
        bar_h = th + pad * 2
        draw.rectangle([x0, y0 + ch - bar_h, x0 + cw, y0 + ch], fill=(255, 255, 255, 178))
        draw.text((x0 + (cw - tw) // 2, y0 + ch - bar_h + pad - bbox[1]), emo,
                  fill=(40, 40, 45, 255), font=font)
    DST.write_bytes(b"")
    img.save(DST, "PNG")
    print(f"标注版已存 {DST}({w}×{h},标签{fs}px)")


if __name__ == "__main__":
    main()
