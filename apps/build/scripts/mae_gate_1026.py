#!/usr/bin/env python3
"""任务B④:数值门——人脸区/躯干区/全图 MAE(源图 vs A臂 / 源图 vs B臂)+双臂互差。

解释器:引擎私有 venv(自带 numpy/PIL):
  /Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/venv/bin/python

区域框:按源图(2048×2706)取景手工定(视觉分析百分比换算,落台账):
  人脸区 x≈42% y≈7% w≈13% h≈12% → (860,189,266,325)
  躯干区 x≈33% y≈21% w≈34% h≈22% → (676,568,696,595)
尺寸对齐:TE res=0 出图随参考尺寸(1MP 缩放);源图按 cover 等比+中心裁到出图尺寸,
区域框随同一变换映射;两臂若有尺寸差,以A为基准同法对齐(记档)。

判读三数分列(B判据):
  ①服装域变化量=躯干区 MAE,B 应显著大于 A 才算换得动
  ②身份保持=人脸区 MAE,B 应与 A 同档或更小
  ③双臂互差(全图 MAE)+两臂耗时
数值仅供参考,有效性结论以对比条人眼终审为准(终审归用户人眼)。
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

OUT_DIR = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/outfit_probe_1026")
SRC = OUT_DIR.parent / "晏燎/trial_基准/晏燎_筑基期_正视图_v1.png"
ARM_A = OUT_DIR / "B_armA_基线.png"
ARM_B = OUT_DIR / "B_armB_outfit.png"
LIVE = OUT_DIR / "live_report.json"

# 源图取景手工框(x, y, w, h)——源图 2048×2706
FACE_BOX_SRC = (860, 189, 266, 325)    # ≈(42%, 7%, 13%, 12%)
TORSO_BOX_SRC = (676, 568, 696, 595)   # ≈(33%, 21%, 34%, 22%)


def align_to(im: Image.Image, w: int, h: int) -> Image.Image:
    """cover 等比+中心裁到 (w,h)。"""
    if im.size == (w, h):
        return im
    s = max(w / im.width, h / im.height)
    nw, nh = round(im.width * s), round(im.height * s)
    im2 = im.resize((nw, nh), Image.LANCZOS)
    x0, y0 = (nw - w) // 2, (nh - h) // 2
    return im2.crop((x0, y0, x0 + w, y0 + h))


def map_box(box, sw: int, sh: int, w: int, h: int):
    """把源图框经同一 cover+中心裁变换映射到 (w,h) 系(并夹边)。"""
    s = max(w / sw, h / sh)
    nw, nh = round(sw * s), round(sh * s)
    ox, oy = (nw - w) // 2, (nh - h) // 2
    x, y, bw, bh = box
    x0 = max(0, round(x * s) - ox)
    y0 = max(0, round(y * s) - oy)
    x1 = min(w, round((x + bw) * s) - ox)
    y1 = min(h, round((y + bh) * s) - oy)
    return (x0, y0, x1 - x0, y1 - y0)


def mae_full(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a.astype(np.float64) - b.astype(np.float64))))


def mae_box(a: np.ndarray, b: np.ndarray, box) -> float:
    x, y, w, h = box
    return float(np.mean(np.abs(a[y:y + h, x:x + w].astype(np.float64)
                               - b[y:y + h, x:x + w].astype(np.float64))))


def main() -> int:
    src_im = Image.open(SRC).convert("RGB")
    a_im = Image.open(ARM_A).convert("RGB")
    b_im = Image.open(ARM_B).convert("RGB")

    rec = {"source_size": src_im.size, "armA_size": a_im.size, "armB_size": b_im.size}

    # 对齐:以 A 臂尺寸为基准(A/B 同图应同尺寸;若有差以A为准,B 同法对齐记档)
    w, h = a_im.size
    src_al = align_to(src_im, w, h)
    b_al = b_im if b_im.size == (w, h) else align_to(b_im, w, h)
    rec["alignment"] = {
        "base": "armA_size", "final_size": [w, h],
        "src_aligned_by": "cover-scale+center-crop",
        "armB_realigned": b_im.size != (w, h),
    }
    # 对齐后源图落盘(拼条与复核用)
    src_al.save(OUT_DIR / "src_aligned.png")

    face_box = map_box(FACE_BOX_SRC, *src_im.size, w, h)
    torso_box = map_box(TORSO_BOX_SRC, *src_im.size, w, h)
    rec["boxes"] = {
        "face_src_px": list(FACE_BOX_SRC), "torso_src_px": list(TORSO_BOX_SRC),
        "face_aligned_px": list(face_box), "torso_aligned_px": list(torso_box),
    }

    src = np.asarray(src_al)
    a = np.asarray(a_im)
    b = np.asarray(b_al)

    numbers = {
        "faceA": mae_box(src, a, face_box), "faceB": mae_box(src, b, face_box),
        "torsoA": mae_box(src, a, torso_box), "torsoB": mae_box(src, b, torso_box),
        "fullA": mae_full(src, a), "fullB": mae_full(src, b),
        "AB_full": mae_full(a, b),
    }
    numbers = {k: round(v, 3) for k, v in numbers.items()}

    live = json.loads(LIVE.read_text(encoding="utf-8")) if LIVE.exists() else {}
    elapsed = {t: live.get("arms", {}).get(t, {}).get("post_to_done_s") for t in ("A", "B")}
    rec["elapsed_s"] = elapsed
    rec["mae_0_255"] = numbers

    # 判读三数分列(数值仅供参考,终审人眼)
    rec["reading"] = {
        "①服装域变化量(torso)": {
            "A": numbers["torsoA"], "B": numbers["torsoB"],
            "B_minus_A": round(numbers["torsoB"] - numbers["torsoA"], 3),
            "判据": "B 应显著大于 A 才算换得动"},
        "②身份保持(face)": {
            "A": numbers["faceA"], "B": numbers["faceB"],
            "判据": "B 应与 A 同档或更小"},
        "③双臂互差(全图)与耗时": {
            "AB_full_MAE": numbers["AB_full"], "elapsed_s": elapsed},
        "声明": "数值仅供参考,有效性结论以对比条人眼终审为准(终审归用户人眼)",
    }

    (OUT_DIR / "numbers.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1),
                                          encoding="utf-8")
    md = [
        "# 数值门(任务B④)——人脸/躯干/全图 MAE(0-255 尺度)",
        "",
        f"- 源图 {rec['source_size']} → 对齐 {w}×{h}(cover等比+中心裁);A/B 原始尺寸 "
        f"{rec['armA_size']}/{rec['armB_size']}",
        f"- 区域框(源图px): 人脸={list(FACE_BOX_SRC)} 躯干={list(TORSO_BOX_SRC)};"
        f" 对齐系px: 人脸={list(face_box)} 躯干={list(torso_box)}",
        "",
        "| 指标 | 源vs A臂 | 源vs B臂 |", "|---|---|---|",
        f"| 人脸区 MAE | {numbers['faceA']} | {numbers['faceB']} |",
        f"| 躯干区 MAE | {numbers['torsoA']} | {numbers['torsoB']} |",
        f"| 全图 MAE | {numbers['fullA']} | {numbers['fullB']} |",
        "", f"- 双臂互差(全图 MAE A vs B)= {numbers['AB_full']}",
        f"- 两臂耗时(POST→done): A={elapsed.get('A')}s / B={elapsed.get('B')}s",
        "",
        "**数值仅供参考,有效性结论以对比条人眼终审为准(终审归用户人眼)。**",
        "本测=『文本指令换装+LoRA 一致性』单参考用法(非官方双图用法)。",
    ]
    (OUT_DIR / "numbers.md").write_text("\n".join(md), encoding="utf-8")
    print(json.dumps(rec["reading"], ensure_ascii=False, indent=1))
    print(f"[mae] 落 {OUT_DIR / 'numbers.json'} 与 numbers.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
