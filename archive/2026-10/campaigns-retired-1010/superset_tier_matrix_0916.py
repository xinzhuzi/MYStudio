#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""09-16 一次性矩阵实验脚本(Trellis 任务 09-16-superset-lora-tier-0916 批次1)。

超集 LoRA 阵容五档实测矩阵(design.md 第一节口径,不改超集本体,mode 改在
加载后的 wf 副本上、值改走 overrides):
  A   现速度档                 67 恒旁路           4步/cfg1.0
  B   速度+67×0.7             67→激活             4步/cfg1.0
  C   速度+67×1.0             67→激活             4步/cfg1.0
  C13 速度+67×1.3             67→激活             4步/cfg1.0
  D   质量档                   47→旁路+67→激活×1.0 12步/cfg5.0

固定口径: seed=20 / 1024² / 风格 2D工笔风(默认,不动 [60]) /
正向工笔句 + 防皱负向全文显式 override(坑⑤⑥:[64] 无 named 位置式盲区 +
防并行会话改默认值漂移)。

纪律:
  - 复用 p2_duipai_run.py 的 ui_to_api_t2i/wait_idle/http_json/ENGINE_WF(import 不改)
  - 串行提交,每档前 wait_idle(并行会话共用引擎,严禁重启/停止引擎)
  - 计时 = POST /prompt 入队 → /history 该 prompt_id status=success 墙钟
  - 每档后 grep 当日出图日志最新 [MY出图][摘要](锚定本档保存前缀),断言不符即停
  - 指标用引擎 venv python(numpy): Laplacian 方差 + 高频能量占比(FFT 高通)
  - contact sheet 用引擎 venv PIL 五图横排,格内标注「档名 67×强度」

产物: /tmp/superset_tier_matrix/
  tierA.png tierB.png tierC.png tierC13.png tierD.png + metrics.json
  + sheet_tiers.jpg + graphs/(API 图) + matrix.exit

用法: python3 superset_tier_matrix_0916.py   (后台长任务,写 matrix.exit)
"""
from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

REPO = Path.home() / "Project/Github/MYStudio"
P2 = REPO / "apps/build/scripts/p2_duipai_run.py"
WF_SUPERSET = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/"
               "MY-K2_文生图_超集.json")
ENGINE_VENV_PY = Path.home() / "Library/Application Support/漫影工作室/comfyui/venv/bin/python"
# 当日出图日志(文件名无横线,任务口径)
ENGINE_LOG = Path.home() / "Library/Application Support/漫影工作室/comfyui/logs/image-prompts-20260916.log"
OUT_DIR = Path("/tmp/superset_tier_matrix")

SEED = 20
SIZE = 1024
# 工笔句=超集 [50] 现默认(位置式 wv 全文);防皱负向=[64] 现默认全文。显式 override 防漂移(坑⑤⑥)
POS_GONGBI = ("一位容色清丽、眉目如画的黑发少女侧立于画幅中央,精谨线描勾勒眉眼发丝,"
              "身姿修长端雅,石青襦裙配赭石披帛,衣纹线条流畅,身后大面积留白,"
              "画面边缘一枝疏梅淡影。")
NEG_ANTIWRINKLE = ("文字,水印,签名,多余的手指,畸形的手,褶皱,皱褶,绉纹,杂乱布纹,"
                   "织物褶皱,横向条纹,色带,条带痕迹")
DETAIL_FILE_KEY = "细节滑杆DetailSlider_v1.safetensors"   # [67] 细节滑杆(摘要判据)
TURBO_KEY = "Turbo-4步蒸馏"                                # [47] 4步蒸馏(速度档应在/D 档应无)
AFTERLIGHT_KEY = "Afterlight_v1.safetensors"               # [46] 光影(全档激活)
STYLE_FIELD = "风格: 2D工笔风"

TIERS = [
    {"tier": "A",   "note": "现速度档(67旁路)",               "flips": {},               "s67": None,
     "steps": 4,  "cfg": 1.0, "prefix": "tier0916_A"},
    {"tier": "B",   "note": "速度+67×0.7",                    "flips": {67: 0},          "s67": 0.7,
     "steps": 4,  "cfg": 1.0, "prefix": "tier0916_B"},
    {"tier": "C",   "note": "速度+67×1.0",                    "flips": {67: 0},          "s67": 1.0,
     "steps": 4,  "cfg": 1.0, "prefix": "tier0916_C"},
    {"tier": "C13", "note": "速度+67×1.3",                    "flips": {67: 0},          "s67": 1.3,
     "steps": 4,  "cfg": 1.0, "prefix": "tier0916_C13"},
    {"tier": "D",   "note": "质量档(47旁路+67×1.0+12步cfg5)", "flips": {47: 4, 67: 0},   "s67": 1.0,
     "steps": 12, "cfg": 5.0, "prefix": "tier0916_D"},
]

CALL_TIMEOUT_S = 2400      # 单档执行上限(D 档实测 ~470s,余量充足)
CLIENT_ID = "superset-tier-matrix-0916"

spec = importlib.util.spec_from_file_location("p2", P2)
p2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p2)
BASE = p2.BASE_URL_DEFAULT

# 引擎 venv 内跑的指标+拼图代码(主脚本 python3 无 numpy 也可运行)
VENV_CODE = r'''
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

items = json.loads(sys.argv[1])
sheet_path = sys.argv[2]
font = None
for fp in ("/System/Library/Fonts/Hiragino Sans GB.ttc",
           "/System/Library/Fonts/STHeiti Light.ttc"):
    try:
        font = ImageFont.truetype(fp, 22)
        break
    except Exception:
        pass

res = {}
cell, lab = 384, 44
sheet = Image.new("RGB", (len(items) * cell, cell + lab), (24, 24, 24))
d = ImageDraw.Draw(sheet)
for i, it in enumerate(items):
    g = np.asarray(Image.open(it["path"]).convert("L"), dtype=np.float64)
    lap = (-4.0 * g)[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    F = np.fft.fftshift(np.fft.fft2(g))
    e = np.abs(F) ** 2
    h, w = g.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - h / 2.0, xx - w / 2.0)
    cutoff = 0.25 * (min(h, w) / 2.0)   # 高通阈值=谱面最大半径的 1/4(1024² 时=128px)
    hf = float(e[r > cutoff].sum() / e.sum())
    res[it["tier"]] = {"laplacian_var": round(float(lap.var()), 2),
                       "hf_energy_ratio": round(hf, 6)}
    im = Image.open(it["path"]).resize((cell, cell))
    x = i * cell
    sheet.paste(im, (x, lab))
    lab_txt = it["label"] if font else it["label_ascii"]
    d.text((x + 8, 11), lab_txt, fill=(240, 240, 240), font=font)
sheet.save(sheet_path, quality=92)
print(json.dumps(res))
'''


def load_wf(mode_flips: dict[int, int] | None = None) -> dict:
    """加载超集 UI json 副本并按档位改 mode(转换前改,坑②口径同 k2 先例)。"""
    wf = json.loads(WF_SUPERSET.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if mode_flips and n["id"] in mode_flips:
            n["mode"] = mode_flips[n["id"]]
    return wf


def tier_overrides(t: dict) -> dict[str, object]:
    ov: dict[str, object] = {
        "50.value": POS_GONGBI,          # 坑⑥:固定工笔句防默认漂移
        "64.value": NEG_ANTIWRINKLE,     # 坑⑤:[64] 无 named,位置式盲区必须显式 override
        "12.seed": SEED,
        "12.steps": t["steps"],
        "12.cfg": t["cfg"],
        "53.width": SIZE,
        "53.height": SIZE,
        "4.filename_prefix": t["prefix"],
    }
    if t["s67"] is not None:
        ov["67.strength_model"] = t["s67"]
    return ov


def build_all_graphs(oi: dict) -> dict[str, dict]:
    """先离线构建五档 API 图(转换失败即停,不占引擎)。"""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "graphs").mkdir(exist_ok=True)
    graphs = {}
    for t in TIERS:
        g = p2.ui_to_api_t2i(load_wf(t["flips"]), oi, tier_overrides(t))
        (OUT_DIR / "graphs" / f"{t['tier']}.json").write_text(
            json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")
        graphs[t["tier"]] = g
    return graphs


def check_summary(line: str, t: dict) -> list[str]:
    """对 [摘要] 行做档位断言(任务口径:不符即停)。"""
    fails: list[str] = []
    if f"seed={SEED}" not in line:
        fails.append(f"seed!={SEED}")
    m = re.search(r"steps=(\d+)", line)
    if not m or int(m.group(1)) != t["steps"]:
        fails.append(f"steps 期望{t['steps']}")
    m = re.search(r"cfg=([\d.]+)", line)
    if not m or abs(float(m.group(1)) - t["cfg"]) > 1e-6:
        fails.append(f"cfg 期望{t['cfg']}")
    if STYLE_FIELD not in line:
        fails.append("风格!=2D工笔风")
    if AFTERLIGHT_KEY not in line:
        fails.append("Afterlight(46)缺失")
    m = re.search(r"细节滑杆DetailSlider_v1\.safetensors ×([\d.]+)", line)
    if t["s67"] is None:
        if m:
            fails.append("A 桔不应含细节滑杆(67 应旁路)")
    elif not m:
        fails.append("细节滑杆未生效")
    elif abs(float(m.group(1)) - t["s67"]) > 1e-6:
        fails.append(f"细节滑杆强度期望×{t['s67']} 实际×{m.group(1)}")
    if t["tier"] == "D":
        if TURBO_KEY in line:
            fails.append("D 档不应含 4 步蒸馏(47 应旁路)")
    elif TURBO_KEY not in line:
        fails.append("速度档应含 4 步蒸馏(47 激活)")
    return fails


def fetch_summary_line(log_off: int, prefix: str) -> str | None:
    """读日志 pre-submit 偏移后的增量,取锚定保存前缀的最后一行 [摘要]。"""
    with ENGINE_LOG.open("rb") as f:
        f.seek(log_off)
        tail = f.read().decode("utf-8", "replace")
    lines = [ln for ln in tail.splitlines()
             if "[MY出图][摘要]" in ln and f"保存前缀: {prefix}" in ln]
    return lines[-1] if lines else None


def run_one(t: dict, graph: dict) -> dict:
    p2.wait_idle(BASE)                       # 每档提交前等队列清空(并行会话共用引擎)
    log_off = ENGINE_LOG.stat().st_size      # 断言只看本档入队后的日志增量
    t0 = time.time()
    resp = p2.http_json(f"{BASE}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
    if resp.get("node_errors"):
        raise RuntimeError(f"{t['tier']} 节点校验失败: {json.dumps(resp['node_errors'])[:600]}")
    pid = resp["prompt_id"]
    entry = None
    while time.time() - t0 < CALL_TIMEOUT_S:
        hist = p2.http_json(f"{BASE}/history/{pid}", timeout=20)
        if pid in hist:
            entry = hist[pid]
            break
        time.sleep(3)
    if entry is None:
        raise RuntimeError(f"{t['tier']} 执行超时(history 未见完成)")
    status = entry.get("status", {})
    if status.get("status_str") != "success":
        msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
        raise RuntimeError(f"{t['tier']} 执行失败: {json.dumps(msgs[:1])[:900]}")
    wall = round(time.time() - t0, 1)
    outs = []
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                outs += [x for x in imgs if isinstance(x, dict) and "filename" in x]
    if not outs:
        raise RuntimeError(f"{t['tier']} 无输出")
    o = outs[0]
    src = p2.ENGINE_OUT / o.get("subfolder", "") / o["filename"]
    if not src.exists():
        raise RuntimeError(f"{t['tier']} 产物不在盘: {src}")
    dst = OUT_DIR / f"{t['tier']}.png"
    shutil.copy(src, dst)

    line = None                              # 3 次有界重试防日志 flush 滞后
    for _ in range(3):
        line = fetch_summary_line(log_off, t["prefix"])
        if line is not None:
            break
        time.sleep(3)
    if line is None:
        raise RuntimeError(f"{t['tier']} 日志未见保存前缀 {t['prefix']} 的 [MY出图][摘要] 行")
    fails = check_summary(line, t)
    if fails:
        raise RuntimeError(f"{t['tier']} [摘要] 断言失败: {'; '.join(fails)} | 摘要行: {line}")
    print(f"[{t['tier']}] ok {wall}s prompt_id={pid[:8]} 断言全过 -> {dst.name}", flush=True)
    return {"status": "ok", "tier": t["tier"], "note": t["note"], "prompt_id": pid,
            "wall_s": wall, "seed": SEED, "steps": t["steps"], "cfg": t["cfg"],
            "lora_67_strength": t["s67"], "mode_flips": {str(k): v for k, v in t["flips"].items()},
            "prefix": t["prefix"], "file": str(dst), "engine_file": str(src),
            "log_summary": line, "log_assert": "pass"}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "graphs").mkdir(exist_ok=True)
    wf_sha = hashlib.sha256(WF_SUPERSET.read_bytes()).hexdigest()[:16]

    oi = p2.http_json(f"{BASE}/object_info", timeout=60)
    graphs = build_all_graphs(oi)            # 离线转换自检(失败即停,不占引擎)
    print(f"[matrix] 五档 API 图离线构建完成,超集 sha256={wf_sha},开始串行实测", flush=True)

    results: dict[str, dict] = {}
    meta = {"base_url": BASE, "superset_sha256_16": wf_sha, "seed": SEED,
            "size": f"{SIZE}x{SIZE}", "style": "2D工笔风(默认)",
            "positive": POS_GONGBI, "negative": NEG_ANTIWRINKLE,
            "metrics_method": "laplacian_var=灰度 Laplacian(4邻域)方差; "
                              "hf_energy_ratio=|FFT|²能量中半径>谱面最大半径1/4 的占比",
            "started_at": dt.datetime.now().isoformat(timespec="seconds")}
    error: str | None = None
    t_stage = time.time()
    try:
        for t in TIERS:
            rec = run_one(t, graphs[t["tier"]])
            results[t["tier"]] = rec
            (OUT_DIR / "metrics.json").write_text(
                json.dumps({"_meta": meta, "tiers": results}, ensure_ascii=False, indent=1),
                encoding="utf-8")
    except Exception as exc:  # noqa: BLE001  断言/执行失败即停并报告
        error = str(exc)
        print(f"[matrix] 受阻: {error}", flush=True)

    # 指标 + contact sheet(引擎 venv python,五图横排)
    items, metrics = [], {}
    for t in TIERS:
        if t["tier"] not in results:
            continue
        s67 = results[t["tier"]]["lora_67_strength"]
        s67_txt = "67旁路" if s67 is None else f"67×{s67:g}"
        wall = results[t["tier"]]["wall_s"]
        extra = " 47旁路" if t["tier"] == "D" else ""
        items.append({"tier": t["tier"], "path": results[t["tier"]]["file"],
                      "label": f"{t['tier']} {s67_txt}{extra} {wall}s",
                      "label_ascii": f"{t['tier']} 67-off/{s67:g}{extra} {wall}s" if s67 is None
                      else f"{t['tier']} 67x{s67:g}{extra} {wall}s"})
    if items:
        try:
            proc = subprocess.run(
                [str(ENGINE_VENV_PY), "-c", VENV_CODE,
                 json.dumps(items, ensure_ascii=False), str(OUT_DIR / "sheet_tiers.jpg")],
                capture_output=True, text=True, timeout=300)
            if proc.returncode != 0:
                raise RuntimeError(f"venv 指标/拼图失败: {proc.stderr[-500:]}")
            metrics = json.loads(proc.stdout)
            for tier, m in metrics.items():
                results[tier].update(m)
        except Exception as exc:  # noqa: BLE001
            error = error or f"指标阶段失败: {exc}"
            print(f"[matrix] {error}", flush=True)

    meta["finished_at"] = dt.datetime.now().isoformat(timespec="seconds")
    meta["stage_wall_s"] = round(time.time() - t_stage, 1)
    (OUT_DIR / "metrics.json").write_text(
        json.dumps({"_meta": meta, "tiers": results}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    (OUT_DIR / "matrix.exit").write_text("ok\n" if not error and len(results) == len(TIERS)
                                         else f"failed: {error or '档位不全'}\n", encoding="utf-8")
    print(f"[matrix] DONE results={len(results)}/{len(TIERS)} -> {OUT_DIR / 'matrix.exit'}", flush=True)


if __name__ == "__main__":
    main()
