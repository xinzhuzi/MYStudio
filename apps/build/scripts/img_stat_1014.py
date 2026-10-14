#!/usr/bin/env python3
"""产物机器判据(1014 立:Read 工具图像被服务端丢弃,「看图判图」在该模型上不可用——
判效一律走数值指标)。判:黑屏/全透/实体/带透四态+RGB 完整度。
用法:python3 img_stat_1014.py <png>..."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def stat(p):
    im = Image.open(p)
    a = np.asarray(im.convert("RGBA"))
    rgb = a[..., :3].astype(float)
    nonblack = (rgb.mean(axis=2) > 10).mean()
    alpha = a[..., 3]
    amin, amax = int(alpha.min()), int(alpha.max())
    if nonblack < 0.01:
        verdict = "纯黑屏"
    elif amin >= 250 and amax == 255:
        verdict = "实体图(不透明)"
    elif amax <= 5:
        verdict = "全透明(RGB在但alpha=0)"
    elif amin <= 5 and amax >= 250:
        verdict = "带透明(主体实体+背景透)"
    else:
        verdict = f"半透明混态(alpha {amin}-{amax})"
    return f"{Path(p).parent.name}/{Path(p).name}: 非黑={nonblack:.2f} alpha={amin}-{amax} → {verdict}"


if __name__ == "__main__":
    for x in sys.argv[1:]:
        print(stat(x))
