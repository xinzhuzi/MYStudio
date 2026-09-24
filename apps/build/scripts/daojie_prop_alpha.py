#!/usr/bin/env python3
"""道具图抠透明底:rembg(u2netp)→RGBA PNG。

用法(必须用引擎venv解释器,rembg装在那):
  "$HOME/Library/Application Support/漫影工作室/comfyui/venv/bin/python" \
      apps/build/scripts/daojie_prop_alpha.py 图片1 [图片2 ...] [--model u2netp]

输出:同目录 <名>_alpha.png;打印透明度统计供验收(全透明/全不透明占比)。
模型缓存 ~/.u2net/(本机已有 u2netp 4.5MB;--model u2net 完整版需下载~170MB,建议配代理)。
09-21 立:道具底座已改纯白平涂底,专为抠图;暖底旧图也能抠但边缘可能带色,优先重出。
"""
import argparse
import sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--model", default="u2netp", choices=["u2netp", "u2net", "isnet-general-use"])
    ap.add_argument("--suffix", default="_alpha")
    a = ap.parse_args()
    try:
        from rembg import remove, new_session
    except ImportError:
        sys.exit("rembg 不在当前解释器——请用引擎venv的python运行(见文件头用法)")
    session = new_session(a.model)
    ok = 0
    for p in a.images:
        src = Path(p).expanduser()
        if not src.is_file():
            print(f"跳过(不存在): {src}")
            continue
        from PIL import Image
        im = Image.open(src)
        out = remove(im.convert("RGBA"), session=session)
        dst = src.with_name(f"{src.stem}{a.suffix}.png")
        out.save(dst)
        hist = out.getchannel("A").histogram()
        total = sum(hist)
        transparent = sum(hist[:16]) / total
        opaque = sum(hist[240:]) / total
        print(f"{src.name} -> {dst.name}  全透明{transparent:.0%} 全不透明{opaque:.0%} 尺寸{out.size}")
        ok += 1
    print(f"完成 {ok}/{len(a.images)}")


if __name__ == "__main__":
    main()
