#!/usr/bin/env python3
"""B4 对拍终版报告汇编器(0930):合并 judge-report + at-line 观测 + f3 record +
G 预标注说明 → b4-duipai-report.json(裁定门材料,含吸收/不吸收/再议建议)。"""
from __future__ import annotations

import json
import datetime as dt
from pathlib import Path

OUT = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/b4-duipai-0930")


def load(name):
    p = OUT / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


judge = load("judge-report.json")
atline = load("j3-atline-observation.json")
recs = load("run-records.json")
f3rec = load("f3-record.json")

shots = {}
for shot in ("f1", "f2", "f3", "f4"):
    e = judge.get("shots", {}).get(shot, {})
    entry = {
        "file": e.get("file", str(OUT / f"{shot}.png")),
        "missing": e.get("missing", not (OUT / f"{shot}.png").exists()),
        "reds": e.get("reds", []),
        "J": {k: e[k] for k in ("J1", "J2", "J3", "J4", "J5", "J6", "J7") if k in e},
        "G": e.get("G", {}),
    }
    if shot in atline:
        entry["J3AtLineObservation"] = atline[shot]
    if shot in recs:
        r = recs[shot]
        entry["seed"] = r.get("seed")
        entry["engineFile"] = r.get("engineFile")
        entry["wall_s"] = r.get("wall_s")
        entry["purpose"] = ("泛化(女面包师→男剑客)" if shot == "f4" and r.get("f4_mode") == "generalization"
                            else "病灶复跑(强化句)" if shot == "f4" else
                            "Q1 基线(模板逐字)" if shot == "f1" else
                            "Q1 稳定性复验(同文双 seed)" if shot == "f2" else "Q2 产线抽验(正字张)")
    shots[shot] = entry

# ── 裁定门评估(数据齐后供用户裁定;本件只摆事实) ──
def reds_of(shot, keys):
    return [k for k in keys if k in shots[shot]["reds"]]

tri = ("f1", "f2", "f4")
structural = {k: all(k not in shots[s]["reds"] for s in tri) for k in ("J1", "J2", "J5")}
j3_all_red = all("J3" in shots[s]["reds"] for s in tri)
j4_reds = [s for s in tri if "J4" in shots[s]["reds"]]
lines_clean = all(v["darkPxOnLine"] <= 6 for s in atline.values() for v in s.values()) if atline else None

f3e = shots["f3"]
f3_j6 = f3e.get("J", {}).get("J6", {})
f3_plan_ok = f3_j6.get("pass")
f3_cal = f3_j6.get("calibrated", {})
gate_c = None
if not f3e.get("missing") and f3_j6:
    gate_c = {
        "planThreshold80": f3_plan_ok,
        "calibratedThreshold(corners<=2+>=50%)": f3_cal.get("pass"),
        "ratioAlpha0": f3_cal.get("ratioAlpha0"),
        "corners": f3_cal.get("corners"),
        "note": ("J6 plan≥80% 口径红但校准口径绿=0927d 探针口径与 0930 S11 校准口径的代差"
                 "(0930 S11 用户拍板:PE+W1收束句路透明健康带=50-67%,probe-0927d 84% 属纯公式臂)"
                 if f3_plan_ok is False and f3_cal.get("pass") else
                 "双口径并报,如实")}

gate_a = {
    "structuralAllGreen": structural,
    "J3BandRedAllThree": j3_all_red,
    "J3AtLineClean": lines_clean,
    "J4BorderlineReds": j4_reds,
    "G1G2Visual": "预标注未执行(本实弹役执行模型无图像输入通道;远端视觉工具不可达本地图床)——留人工+GLM 逐项,plan §三原设计即预标注",
    "reading": ("J1/J2/J5 三发全绿=三联合板结构面稳(恰3格/分隔线在场/全身可裁);"
                "J3 带口径三发红但线上直测 0-6px=版式隔离在线本体成立、带红主因贴线人像两翼;"
                + (f"J4 仅 {j4_reds[0]} 边缘红(band_std 42.63 vs 自定阈 40)" if j4_reds else "J4 三发绿")
                + ";G1/G2 视觉面留预标注——门A 不入「全绿胜任」也不入「J1/J2 双发红不胜任」两支,落再议支"),
}
# holdIf 文案随门C/f3 实况走:plan §四门B「门A 不胜任」行的「+发3 验证背书」系实弹前预写的分支预设,
# 仅当发3 过门且主体在场才成立;实弹实况若推翻预设,则如实记负面证据,防 gate_b 建议与 gate_c 数据自相矛盾。
f3_dual_red = bool(gate_c) and gate_c.get("planThreshold80") is False \
    and gate_c.get("calibratedThreshold(corners<=2+>=50%)") is False
f3_subject_lost = f3rec.get("finalTextHasSubject") is False
if gate_c and not (f3_dual_red or f3_subject_lost):
    hold_if = "若 G1 格间不同人/视角错乱 → 暂缓吸收:角色参考资产由现役道劫分张产线承担(门C 实况见下)+发3 验证背书;K2 合板版恢复(外置盘约33G)是否值得另立裁定"
else:
    f3_ratio = f3_cal.get("ratioAlpha0")
    ratio_txt = f"{f3_ratio:.4f}" if isinstance(f3_ratio, (int, float)) else str(f3_ratio)
    reds_txt = (f"门C 实况(见下)发3 双口径皆红(plan 80% 与 0930 S11 校准均 false,"
                f"ratioAlpha0={ratio_txt} 低于健康带下限 0.50,f3-driver.exit=1)" if f3_dual_red
                else "发3 未过门(门C 实况见下)")
    subj_txt = ("+主体丢失(finalTextHasSubject=false,finalText 全文为竖幅山水风景,"
                "baker/apron/glasses/woman 零命中)" if f3_subject_lost else "")
    hold_if = ("若 G1 格间不同人/视角错乱 → 暂缓吸收:角色参考资产仍由现役道劫分张产线承担(该产线本轮发3 跑偏待修),"
               "plan §四门B 行预设的「发3 验证背书」已被实弹推翻——" + reds_txt + subj_txt
               + ",系产线跑偏的负面证据而非背书;plan 门C 行口径=发3 J6 红→先修产线再谈 B4 通用化;"
                 "K2 合板版恢复(外置盘约33G)是否值得另立裁定")

gate_b = {
    "condition": "门A 落再议支 → 吸收裁定建议=再议(条件吸收)",
    "absorbIf": "用户+GLM 看 side-by-side.png 认 G1 三格同人且 G2 左正/中侧/右背属实 → 吸收 TE-MAN 一键三视图形态值得:以 qwen21-t2i 派生预设工作流(1536×512 三联模板说明卡+A5 切割警示随档+复用 p2_grid_cut.py 切割口),只仿设计零拷码(plan §四门B 原文)",
    "holdIf": hold_if,
    "evidence": "结构面证据已足(J1/J2/J5×3 绿+J3 线上直测干净),身份/视角面缺视觉实证——裁定材料齐备,由用户看图拍板",
}

report = {
    "mode": "b4-duipai-final-report",
    "generatedAt": dt.datetime.now().isoformat(timespec="seconds"),
    "budget": {"engineShots": "恰4发(f1/f2/f3/f4;f1 因运行器 /view 取图 bug 引擎侧已成功、产物由 history 零加发回收;f3 首跑被干跑护栏拦于提交前零耗发,修字段名后一发过)",
               "planCap": "≤4 发,零加发(超预算红线未触)"},
    "dryRunDigest": {"f1f2f4": load("b4-digest.json"),
                     "f3": {"w1Precheck": f3rec.get("constitution"), "dryW1Scan": f3rec.get("dryW1Scan"),
                            "dryDigest": f3rec.get("dryDigest"), "note": "f3 干跑①收束句 40:215+拼接×7+剥离件 40:206 全在场;干跑②面板六值直通(主体句字段名=value 探针实证)"}},
    "shots": shots,
    "f3Record": {k: f3rec.get(k) for k in ("pid", "secs", "statusMessages", "engineFile", "finalTextLen", "finalTextHasSubject", "alphaChecker", "results")},
    "gates": {"A_Q1胜任性": gate_a, "B_Q3吸收裁定": gate_b, "C_产线健康": gate_c},
    "glMVisualItems": "G1 三格同人/G2 视角正确/G3 跨风格同人(可选)/G4 摄影质感污染——全部预标注留人工+GLM(side-by-side.png 为裁定材料)",
    "artifacts": {"sideBySide": str(OUT / "side-by-side.png"), "judgeReport": str(OUT / "judge-report.json"),
                  "atLineObservation": str(OUT / "j3-atline-observation.json"), "runRecords": str(OUT / "run-records.json"),
                  "f3Prompt": str(OUT / "f3-prompt.json"), "graphs": str(OUT / "graphs")},
    "thresholdProvenance": {"J1/J2(plan230)/J3/J4-ΔE/J5/J6-80/J7": "plan §三原文",
                            "J2 严阈250轨": "适配(暖米底灰≈230.6 与230阈冲撞,合成自测证)",
                            "J4 band std≤40": "自定阈值(plan 未定数,实测值随报告)",
                            "J6 校准口径(≤2角+≥50%)": "0930 S11 用户拍板校准,与 plan 80% 双轨并报",
                            "J5 前景RGB>60": "自定阈值(素底分割)"},
}
(OUT / "b4-duipai-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
print("report →", OUT / "b4-duipai-report.json")
print("gateA structural:", structural, "| J3 all red:", j3_all_red, "| lines clean:", lines_clean)
print("gateC:", gate_c if gate_c else "f3 产物缺席(如实)")
