#!/usr/bin/env python3
"""B4 三视图对拍判据件(0930 实弹役首件,配方=apps/build/scripts/b4_duipai_plan_0930.md §三)。

发 1/2/4(三联合板 1536×512)程序判据:
  J1 分隔线在场   1/3 与 2/3 边界 ±1.5%W 带内各存在竖直白色列集:
                   列灰度均值 ≥230 且列内 5-95 百分位差 ≤25 且 ≥85%H 连续白;
                   两条内部分隔线均检出。
  J2 格数恰 3     全图列灰度剖面(窗口平滑)检测内部白带 = 恰 2 条(=3 格)。
  J3 跨线泄漏     两条分隔带内非白像素(灰度<230)占比 ≤3%。
  J4 三格同光照同底 三格 LAB 均值两两 ΔE ≤20;顶/底各 5% 横带亮度方差低
                   (plan 未定数;本件取 std≤40=自定阈值,实测值随报告如实记)。
  J5 全身可裁     每格前景(背景色阈值分割)bbox 高度 ≥ 格高 55%。
发 3(分张透明)程序判据:
  J6 原生透明在场 PNG alpha==0 占比 ≥80%(plan 口径);
                   并报 0930 S11 校准口径(四角 alpha≤2 + 全透占比≥50%,
                   s11-calibration.md 用户拍板)双轨,不抹历史。
  J7 全身竖像形态 有效像素(α>0)bbox 宽高比 ∈[0.45, 0.95]。

GLM 视觉判据 G1-G4 由实弹后人工+GLM 逐项填(judge 只置 null 占位,merge 脚本回填)。

用法: python3 b4_duipai_judge.py --out-dir apps/output/b4-duipai-0930 \
           [--shots f1,f2,f3,f4] [--f1 f1.png --f2 f2.png --f3 f3.png --f4 f4.png]
退出码: 0=全绿;1=有红;2=资产缺失。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ── 阈值(plan §三逐字;自定阈值单独标注 provenance) ─────────────────────
T_WHITE = 230          # J1/J2/J3 白判定灰度阈
T_WHITE_STRICT = 250   # J2 严阈(纯白分隔带;适配暖米底灰≈230.6 冲撞,自定阈值)
T_PCT_DIFF = 25        # J1 列内 5-95 百分位差
T_CONT_H = 0.85        # J1 连续高度占比
T_BAND_W = 0.015       # J1/J3 分隔带半宽(±1.5%W)
T_LEAK = 0.03          # J3 非白占比上限
T_DELTA_E = 20.0       # J4 LAB 两两 ΔE 上限(plan 数)
T_BAND_STD = 40.0      # J4 顶/底横带亮度 std 上限(plan 未定数,自定阈值)
T_BBOX_H = 0.55        # J5 前景 bbox 高度占比下限
T_FG_DIST = 60.0       # J5 前景/背景 RGB 距离阈(自定阈值:素底分割)
T_ALPHA0_PLAN = 0.80   # J6 plan 口径(0927d 探针 84.02% 邻域实证)
T_ALPHA0_CAL = 0.50    # J6 S11 校准口径(0930 用户拍板)
T_CORNER_CAL = 2       # J6 校准口径四角 alpha 容差
T_WH_LO, T_WH_HI = 0.45, 0.95  # J7 宽高比带


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB→Lab(D65),向量化;J4 ΔE 用。"""
    c = rgb.astype(np.float64) / 255.0
    mask = c > 0.04045
    c = np.where(mask, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T
    wp = np.array([0.95047, 1.0, 1.08883])
    t = xyz / wp
    mask = t > 0.008856
    t = np.where(mask, np.cbrt(t), 7.787 * t + 16.0 / 116.0)
    return np.stack([116 * t[..., 1] - 16,
                     500 * (t[..., 0] - t[..., 1]),
                     200 * (t[..., 1] - t[..., 2])], axis=-1)


def j_dividers(gray: np.ndarray) -> dict:
    """J1+J2+J3 共用面:列剖面/带扫描。gray=H×W float。"""
    h, w = gray.shape
    res = {"w": w, "h": h}
    # J1:两条内部边界带内找合格白列
    j1_details, j1_ok = {}, True
    for name, cx in (("x1", w / 3), ("x2", 2 * w / 3)):
        lo, hi = int(cx - T_BAND_W * w), int(cx + T_BAND_W * w)
        lo, hi = max(lo, 0), min(hi, w)
        found = None
        for x in range(lo, hi):
            col = gray[:, x]
            mean = float(col.mean())
            p5, p95 = np.percentile(col, 5), np.percentile(col, 95)
            cont = float((col >= T_WHITE).sum()) / h
            if mean >= T_WHITE and (p95 - p5) <= T_PCT_DIFF and cont >= T_CONT_H:
                found = {"x": x, "mean": round(mean, 1), "p95-p5": round(float(p95 - p5), 1),
                         "cont": round(cont, 4)}
                break
        j1_details[name] = {"band": [lo, hi], "col": found}
        j1_ok = j1_ok and found is not None
    res["J1"] = {"pass": bool(j1_ok), "detail": j1_details,
                 "threshold": "带内列 mean>=230 且 p95-p5<=25 且 白连续>=85%H;两条均检出"}
    # J2:窗口平滑列剖面,内部白带 run 计数。plan 字面阈 230 在暖米素底
    # (灰≈230.6,合成自测证)下退化(整幅成 1 大白带)——判定双轨:plan 字面照报,
    # 过门另认严阈 250 纯白分隔带计数==2(适配 provenance=自定阈值,实测值并报)。
    prof = gray.mean(axis=0)
    k = max(3, int(round(0.01 * w)) | 1)  # 1%W 窗口(奇数)
    ker = np.ones(k) / k
    sm = np.convolve(prof, ker, mode="same")
    inner_lo, inner_hi = int(0.05 * w), int(0.95 * w)

    def _runs(thr: float, profile: np.ndarray) -> list:
        rs, in_run = [], False
        for x in range(inner_lo, inner_hi):
            if profile[x] >= thr and not in_run:
                in_run, run_start = True, x
            elif profile[x] < thr and in_run:
                in_run = False
                rs.append([run_start, x - 1])
        if in_run:
            rs.append([run_start, inner_hi - 1])
        return rs

    runs_plan = _runs(T_WHITE, sm)
    # 严阈走原始剖面:细分隔线(数 px 纯白)经 1%W 平滑后峰值≈242 达不到 250
    # (合成自测证),平滑只保留给 plan 字面轨。
    runs_strict = _runs(T_WHITE_STRICT, prof)
    j2_pass = len(runs_plan) == 2 or len(runs_strict) == 2
    res["J2"] = {"pass": bool(j2_pass),
                 "detail": {"runs_plan230": runs_plan, "n_plan230": len(runs_plan),
                            "runs_strict250": runs_strict, "n_strict250": len(runs_strict)},
                 "threshold": "plan 字面:内部白带(≥230)run 恰 2;适配:严阈 250 纯白分隔带 run==2 亦过门(暖米底灰≈230 与 230 阈冲撞,合成自测证;两轨实测并报)"}
    # J3:两条分隔带内非白占比
    leak = {}
    for name, cx in (("x1", w / 3), ("x2", 2 * w / 3)):
        lo, hi = int(cx - T_BAND_W * w), int(cx + T_BAND_W * w)
        lo, hi = max(lo, 0), min(hi, w)
        band = gray[:, lo:hi]
        leak[name] = round(float((band < T_WHITE).mean()), 4)
    res["J3"] = {"pass": all(v <= T_LEAK for v in leak.values()), "detail": leak,
                 "threshold": "分隔带内灰度<230 占比<=3%"}
    return res


def j_panels(img_rgb: np.ndarray, gray: np.ndarray) -> dict:
    """J4+J5:三格 LAB ΔE / 顶底横带方差 / 前景 bbox。"""
    h, w, _ = img_rgb.shape
    thirds = [(0, w // 3), (w // 3, 2 * w // 3), (2 * w // 3, w)]
    labs = [rgb_to_lab(img_rgb[:, a:b]).reshape(-1, 3).mean(axis=0) for a, b in thirds]
    de = [float(np.linalg.norm(labs[i] - labs[j])) for i, j in ((0, 1), (0, 2), (1, 2))]
    j4_de = {"p1-p2": round(de[0], 2), "p1-p3": round(de[1], 2), "p2-p3": round(de[2], 2)}
    bands = {}
    for nm, sl in (("top5", slice(0, int(0.05 * h))), ("bottom5", slice(int(0.95 * h), h))):
        bands[nm] = round(float(gray[sl, :].std()), 2)
    j4 = {"pass": all(d <= T_DELTA_E for d in de) and all(v <= T_BAND_STD for v in bands.values()),
          "detail": {"deltaE": j4_de, "band_std": bands},
          "threshold": f"ΔE<=20(plan);band std<= {T_BAND_STD}(自定阈值,plan 未定数)"}
    # J5:每格背景色=格边缘中位色,前景=RGB 距离>60,bbox 高度占比
    j5_det = {}
    j5_ok = True
    for i, (a, b) in enumerate(thirds, 1):
        panel = img_rgb[:, a:b]
        pgray = gray[:, a:b]
        edge = np.concatenate([panel[: int(0.03 * h)], panel[int(0.97 * h):]], axis=0)
        bg = np.median(edge.reshape(-1, 3), axis=0)
        fg = np.linalg.norm(panel.astype(np.float64) - bg, axis=-1) > T_FG_DIST
        ys, xs = np.nonzero(fg)
        if len(ys) == 0:
            j5_det[f"panel{i}"] = {"bbox_h_ratio": 0.0, "note": "零前景像素"}
            j5_ok = False
            continue
        ratio = float((ys.max() - ys.min() + 1) / pgray.shape[0])
        j5_det[f"panel{i}"] = {"bbox_h_ratio": round(ratio, 4),
                               "bbox_y": [int(ys.min()), int(ys.max())]}
        j5_ok = j5_ok and ratio >= T_BBOX_H
    j5 = {"pass": bool(j5_ok), "detail": j5_det,
          "threshold": f"每格前景 bbox 高度>=格高 {T_BBOX_H}(前景=距格边缘中位色 RGB>60,自定阈值)"}
    return {"J4": j4, "J5": j5}


def judge_triptych(path: Path) -> dict:
    img = Image.open(path).convert("RGB")
    rgb = np.asarray(img)
    gray = rgb @ np.array([0.299, 0.587, 0.114])
    out = j_dividers(gray)
    out.update(j_panels(rgb, gray))
    return out


def judge_transparent(path: Path) -> dict:
    img = Image.open(path)
    if img.mode != "RGBA":
        return {"J6": {"pass": False, "detail": {"mode": img.mode, "note": "非 RGBA,无 alpha 通道"}},
                "J7": {"pass": False, "detail": {"note": "无 alpha,不判"}}}
    a = np.asarray(img)[:, :, 3]
    h, w = a.shape
    ratio0 = float((a == 0).mean())
    corners = {k: int(a[y, x]) for k, (y, x) in
               (("tl", (3, 3)), ("tr", (3, w - 4)), ("bl", (h - 4, 3)), ("br", (h - 4, w - 4)))}
    plan_ok = ratio0 >= T_ALPHA0_PLAN
    cal_ok = (ratio0 >= T_ALPHA0_CAL) and all(v <= T_CORNER_CAL for v in corners.values())
    ys, xs = np.nonzero(a > 0)
    if len(ys):
        bw, bh = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        whr = round(bw / bh, 4)
    else:
        bw = bh = 0
        whr = None
    return {
        "J6": {"pass": bool(plan_ok),
               "detail": {"ratioAlpha0": round(ratio0, 6), "corners": corners,
                          "alphaMin": int(a.min()), "alphaMax": int(a.max()),
                          "alphaMean": round(float(a.mean()), 2)},
               "threshold": f"plan: alpha0>=80%;校准口径并报: corners<=2 且 alpha0>=50%",
               "calibrated": {"pass": bool(cal_ok), "ratioAlpha0": round(ratio0, 6),
                              "corners": corners}},
        "J7": {"pass": whr is not None and T_WH_LO <= whr <= T_WH_HI,
               "detail": {"bbox_w": bw if whr is not None else None,
                          "bbox_h": bh if whr is not None else None, "w_over_h": whr},
               "threshold": "α>0 bbox 宽高比∈[0.45,0.95]"},
    }


G_SLOTS = {
    "G1": "三格同人(脸型/发型/服装逐格一致;A4 可捐赠项在场性)——GLM 视觉,实弹后填",
    "G2": "视角正确(左正/中侧/右背)——GLM 视觉,实弹后填",
    "G3": "跨风格同人(发3 vs 发1/2;可选)——GLM 视觉,实弹后填",
    "G4": "摄影质感污染(发1/2 三格写实质感=A4 不捐赠项污染风险)——GLM 视觉,实弹后填",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="apps/output/b4-duipai-0930")
    ap.add_argument("--shots", default="f1,f2,f3,f4")
    ap.add_argument("--f1", default="f1.png")
    ap.add_argument("--f2", default="f2.png")
    ap.add_argument("--f3", default="f3.png")
    ap.add_argument("--f4", default="f4.png")
    args = ap.parse_args()
    out_dir = Path(args.out_dir)
    report_path = out_dir / "judge-report.json"
    prev = {}
    if report_path.exists():  # 幂等续跑:保留已有 G 回填
        try:
            prev = json.loads(report_path.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
    report = {"mode": "b4-duipai-judge", "generatedAt": _now(),
              "shots": {}, "thresholds": {
                  "J1": "±1.5%W 带内列 mean>=230/p95-p5<=25/白连续>=85%H×2",
                  "J2": "内部白带 run 恰 2", "J3": "带内非白<=3%", "J4": "ΔE<=20;band std<=40(自定)",
                  "J5": "前景 bbox 高>=55% 格高", "J6": "plan>=80%;校准 corners<=2+>=50% 并报",
                  "J7": "α>0 bbox 宽高比∈[0.45,0.95]"}}
    missing, has_red = [], False
    for shot in [s.strip() for s in args.shots.split(",") if s.strip()]:
        fname = getattr(args, shot.replace("f", "f"))
        p = out_dir / fname
        if not p.exists():
            missing.append(shot)
            report["shots"][shot] = {"file": str(p), "missing": True}
            continue
        entry = {"file": str(p)}
        try:
            if shot == "f3":
                entry.update(judge_transparent(p))
            else:
                entry.update(judge_triptych(p))
            entry["G"] = {k: (prev.get("shots", {}).get(shot, {}).get("G", {}).get(k)
                              if isinstance(prev.get("shots", {}).get(shot, {}).get("G"), dict) else None)
                          or {"verdict": None, "note": G_SLOTS[k]} for k in G_SLOTS}
            reds = [k for k, v in entry.items() if k.startswith("J") and isinstance(v, dict) and not v["pass"]]
            entry["reds"] = reds
            has_red = has_red or bool(reds)
        except Exception as exc:  # noqa: BLE001
            entry["error"] = str(exc)[:500]
            has_red = True
        report["shots"][shot] = entry
    report["missing"] = missing
    report["generatedAt"] = _now()
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"report": str(report_path), "reds": {
        s: e.get("reds", e.get("error")) for s, e in report["shots"].items()},
        "missing": missing}, ensure_ascii=False))
    sys.exit(2 if missing else (1 if has_red else 0))


def _now() -> str:
    import datetime
    return datetime.datetime.now().isoformat(timespec="seconds")


if __name__ == "__main__":
    main()
