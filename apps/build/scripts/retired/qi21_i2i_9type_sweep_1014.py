#!/usr/bin/env python3
"""qi21-道劫-i2i 九型全测扫(2026-10-14 深夜,用户令「9型都测试了吗」)。

逐型发车(正器 qi21_i2i_workflow_fire 子进程):同指令(换袍)/同双参考/PE 关直写/
放大旁路/viggle 档,每型随机种子(铁令)。判据(机器,禁人眼):
  ①非黑(≥0.5);②alpha 门控=透明四型(道具/多视图/高清人脸/表情差分)应带低alpha,
    其余五型应实体(alpha min≥200);③型层锚词抽查(装配文收据含该型特征词)。
汇总:i2i-fire-1013/sweep9/report.md + 逐型 PNG。差型逐个深查修复重测(另脚本)。
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
FIRE = REPO / "apps/build/scripts/qi21_i2i_workflow_fire.py"
DOC = REPO / "docs/prompts/道劫_类型主体句示例.md"
OUT = REPO / "apps/output/i2i-fire-1013/sweep9"
TYPES = ["人物", "场景", "道具", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
# 引擎 COMBO 真名(多视图=「人物多视图」;1014 首扫实弹 400 教学)
COMBO = {"多视图": "人物多视图"}
ALPHA_TYPES = {"道具", "多视图", "高清人脸", "表情差分"}
INSTR = ("把 <image2> 中人物所穿的灰底金纹长袍完整地穿到 <image1> 的人物身上,"
         "保持 <image1> 人物的脸型、发型、姿态与背景不变。")
# 型层锚词(=qi21_bases.json 各型 positive_text 特征词,判型底座真挂上)
ANCHORS = {"人物": "单人立绘", "场景": "空镜场景", "道具": "器物设定图", "美宣": "叙事美宣",
           "多视图": "四视图", "高清人脸": "头肩特写", "分镜剧情图": "连环画", "表情差分": "九宫格",
           "概念气氛图": "以气氛为主"}


def subject_of(typ):
    t = DOC.read_text(encoding="utf-8")
    alias = {"人物多视图": "多视图"}.get(typ, typ)
    m = re.search(rf"## \d+\. [^\n]*?{re.escape(alias)}[^\n]*\n.*?```[a-z]*\n(.*?)\n```", t, re.S)
    if not m:
        sys.exit(f"示例库未找到 {typ}")
    return m.group(1).strip()


def judge(png):
    a = np.asarray(Image.open(png).convert("RGBA"))
    nonblack = (a[..., :3].mean(axis=2) > 10).mean()
    amin, amax = int(a[..., 3].min()), int(a[..., 3].max())
    return nonblack, amin, amax


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for typ in TYPES:
        t0 = time.time()
        d = OUT / typ
        verdict = nonblack = amin = amax = anchor_ok = None
        for attempt in (1, 2):  # 1014:坏种子残率≈1/13,BAD 自动换种子重试一次
            r = subprocess.run(
                [sys.executable, str(FIRE), "--instruction", INSTR,
                 "--type", COMBO.get(typ, typ), "--subject", subject_of(typ),
                 "--ref1", "yanliao_yuanying_front.png", "--ref2", "yanliao_heti_front.png",
                 "--no-pe", "--bypass-upscale", "--out", str(d)],
                capture_output=True, text=True, timeout=1800)
            imgs = sorted(d.glob("QI21*.png")) if d.exists() else []
            if not imgs:
                rows.append((typ, "FAIL", f"无产物:{r.stdout[-200:]}{r.stderr[-200:]}", "", 0))
                break
            png = imgs[-1]
            nonblack, amin, amax = judge(png)
            alpha_ok = (amax <= 10 or amin <= 10) if typ in ALPHA_TYPES else amin >= 200
            verdict = "PASS" if (nonblack >= 0.5 and alpha_ok) else "BAD"
            if verdict == "PASS":
                break
        if verdict is None:
            continue
        snap = next(d.glob("prompt_preview_*.txt"), None)
        anchor_ok = "-"
        if snap:
            anchor_ok = "锚✓" if ANCHORS.get(typ, "") in snap.read_text() else "锚✗"
        rows.append((typ, verdict,
                     f"非黑={nonblack:.2f} alpha={amin}-{amax} "
                     f"({'带透' if typ in ALPHA_TYPES else '实体'}门{'过' if alpha_ok else '拒'})",
                     anchor_ok, time.time() - t0))
        print(f"[sweep] {typ}: {rows[-1][1]} {rows[-1][2]} {anchor_ok} {rows[-1][4]:.0f}s", flush=True)
        # 装配文锚词
        snap = next(d.glob("prompt_preview_*.txt"), None)
        anchor_ok = "-"
        if snap:
            anchor_ok = "锚✓" if ANCHORS.get(typ, "") in snap.read_text() else "锚✗"
        rows.append((typ, verdict,
                     f"非黑={nonblack:.2f} alpha={amin}-{amax} "
                     f"({'带透' if typ in ALPHA_TYPES else '实体'}门{'过' if alpha_ok else '拒'})",
                     anchor_ok, time.time() - t0))
        print(f"[sweep] {typ}: {rows[-1][1]} {rows[-1][2]} {anchor_ok} {rows[-1][4]:.0f}s", flush=True)
    rep = OUT / "report.md"
    body = ["# i2i 九型全测扫(2026-10-14 深夜;viggle σ链9步双段/单参考正源回切后)", "",
            "| 型 | 判 | 指标 | 锚 | 耗时 |", "|---|---|---|---|---|"]
    for typ, v, m, a, s in rows:
        body.append(f"| {typ} | {v} | {m} | {a} | {s:.0f}s |")
    rep.write_text("\n".join(body) + "\n", encoding="utf-8")
    bad = [r for r in rows if r[1] != "PASS"]
    print(f"\n[sweep] 终局: {9 - len(bad)}/9 PASS, 差型 {[r[0] for r in bad]} → {rep}")


if __name__ == "__main__":
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        sys.exit(0)
    main()
