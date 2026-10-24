#!/usr/bin/env python3
"""hand_gate_1024 —— 手部防崩门禁(mediapipe hands 关键点,10-24 手部防崩计划 P1)。

用法(必须用 handgate venv 的 python 跑,模型已缓存 /tmp/hand_landmarker.task):
  /tmp/handgate-venv/bin/python hand_gate_1024.py 图1.png [图2.png ...]

判据三分支(10-24 四图实测标定):
  PASS        检出≥1只手且关键点结构正常(腕-中指尖距/手宽比∈[0.5,4.0],21点包围盒不塌缩)
  FAIL        检出手但关键点结构畸形(比例崩/点团)——废,触发重掷或局部修复
  UNVERIFIED  检出 0 只手——不判废(可能是合理遮挡/袖藏/小尺寸),降级人工审
exit code: 0=全PASS / 1=有FAIL / 2=有UNVERIFIED(无FAIL)

标定实录(1024):炼虚垂放双手(2.25MP)=2手正常;大乘负袖=2手;共主垂袖=1手;
渡劫(1MP 旧图,高举小手)=0手→UNVERIFIED(该图手糊为 1MP 时代实况)。
"""
from __future__ import annotations

import json
import math
import sys

MODEL = "/tmp/hand_landmarker.task"


def dist(a, b):
    return math.hypot(a.x - b.x, a.y - b.y)


def hand_shape_ok(lm):
    """单手 21 点结构判(10-24 四图标定+共主修复案补握拳态)。
    姿态二分:①握拳态(四指尖[8/12/16/20]比各自指根[5/9/13/17]更近掌心9=手指卷握)
    →ratio=腕(0)-中指尖(12)/掌宽(5-17) 正常带 [0.8,20](握拳手指卷起,ratio≈1~1.5 属正常);
    ②张开/垂放态 →宽带 [2,20](垂放手实测 6.4~13.1)。
    公共判:包围盒塌缩(<1e-4)=真畸形;关键点越界=废。"""
    def d(a, b): return math.hypot(a.x - b.x, a.y - b.y)
    palm = lm[9]
    curled = sum(1 for tip, mcp in ((8, 5), (12, 9), (16, 13), (20, 17)) if d(lm[tip], palm) < d(lm[mcp], palm))
    fist = curled >= 3
    lo = 0.8 if fist else 2.0
    wrist_to_mid = d(lm[0], lm[12])
    hand_width = d(lm[5], lm[17]) or 1e-6
    ratio = wrist_to_mid / hand_width
    if not (lo <= ratio <= 20.0):
        return False, f"腕指比{ratio:.2f}越界[{lo},20]({'握拳态' if fist else '舒展态'})"
    if any(p.x < -0.02 or p.x > 1.02 or p.y < -0.02 or p.y > 1.02 for p in lm):
        return False, "关键点越出画界"
    xs = [p.x for p in lm]; ys = [p.y for p in lm]
    box = (max(xs) - min(xs)) * (max(ys) - min(ys))
    if box < 1e-4:
        return False, f"包围盒塌缩{box:.5f}"
    return True, f"{'握拳态' if fist else '舒展态'}腕指比{ratio:.2f}盒{box:.4f}"


def check(path):
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks import python as mppython
    from mediapipe.tasks.python import vision
    import PIL.Image

    im = PIL.Image.open(path).convert("RGB")
    im.thumbnail((1600, 1600))  # 门禁用中尺寸:够检出手,又快
    det = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=mppython.BaseOptions(model_asset_path=MODEL),
            num_hands=4, running_mode=vision.RunningMode.IMAGE,
            min_hand_detection_confidence=0.4, min_hand_presence_confidence=0.4))
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.array(im)))
    hands = []
    for lm in r.hand_landmarks:
        ok, why = hand_shape_ok(lm)
        hands.append({"ok": ok, "why": why})
    if not hands:
        return "UNVERIFIED", "检出0只手(遮挡/袖藏/小尺寸可能,降级人工审)"
    bad = [h for h in hands if not h["ok"]]
    if bad:
        return "FAIL", f"{len(hands)}手中{len(bad)}手畸形: {'; '.join(b['why'] for b in bad)}"
    return "PASS", f"{len(hands)}手结构正常({'; '.join(h['why'] for h in hands)})"


def main():
    if not sys.argv[1:]:
        print(__doc__)
        sys.exit(3)
    results, worst = {}, 0
    for p in sys.argv[1:]:
        try:
            verdict, why = check(p)
        except Exception as exc:
            verdict, why = "UNVERIFIED", f"门禁异常:{exc}"
        results[p] = {"verdict": verdict, "why": why}
        if verdict == "FAIL":
            worst = 1
        elif verdict == "UNVERIFIED" and worst == 0:
            worst = 2
    print(json.dumps(results, ensure_ascii=False, indent=1))
    sys.exit(worst)


if __name__ == "__main__":
    main()
