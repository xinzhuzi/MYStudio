#!/usr/bin/env python3
# 1110 设定卡标题真字后叠(役:14型分辨率重设→设定卡固定格式)
# 背景:Qwen-Image-2.1 在标题位只会回声指令名词(六措辞全灭实录 A~F),
# 型文已改为「标题带留白+朱印」;本脚本在留白位确定性叠真字名号=零出错。
# 用法: python3 daojie_sheet_title_overlay.py <生成图.png> <名字> [输出.png]
import sys, os
from PIL import Image, ImageDraw, ImageFont

def overlay(src: str, name: str, dst: str = None) -> str:
    dst = dst or src.rsplit(".", 1)[0] + f"_题名_{name}.png"
    im = Image.open(src).convert("RGBA")
    W, H = im.size
    band_h = int(H * 0.105)  # 五带版式:标题带≈一成高
    font = None
    for fp in ("/System/Library/Fonts/STKaiti.ttc",
               "/System/Library/Fonts/Hiragino Sans GB.ttc",
               "/System/Library/Fonts/PingFang.ttc"):
        if os.path.exists(fp):
            font = ImageFont.truetype(fp, int(band_h * 0.62)); break
    assert font, "无可用中文字体"
    d = ImageDraw.Draw(im)
    bbox = d.textbbox((0, 0), name, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((W - tw) // 2, (band_h - th) // 2 - bbox[1]), name,
           font=font, fill=(28, 26, 24, 255))
    im.convert("RGB").save(dst)
    return dst

if __name__ == "__main__":
    print(overlay(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
