#!/usr/bin/env python3
# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""my21fast-1026 实弹恢复轮(引擎不稳夜:主轮 25 分钟内引擎三次自愈换血)。

主轮结局(见 fire_log 原始留痕):
  WU 96.2s 成功(引擎#1)/L1A 93.2s 成功(引擎#2)/L1B 72.2s 成功(引擎#2)
  → L1-A_vs_L1-B 像素级全等(哈希 69c31cd820c4 同);WU_vs_L1A 负面不变性全等
  L1C 两发连接被拒(引擎#2 死亡窗口,L1C 渲染中引擎硬死无 traceback)
  L1D 138.5s 成功(引擎#3)——新节点 i2i 带参考图全链路跑通
  L2T 两发被产线提示词门禁拒(型文含画风词入主体句槽,结构性)
  L2I 157.6s 成功(引擎#3,含 2K 臂 MYStudio-2K_00066)——产线 i2i 直发全通
  主脚本收尾段崩于 history.prompt 字段为 list 的解析 bug(七臂数据已留痕盘上)

本恢复轮(引擎#4 起):
  WU2 暖身(官方TE t2i,变体负面破缓存) → A2(官方TE) → B2(新节点)
  → C(官方TE i2i 补发) → D2(新节点 i2i) → L2T2(产线 t2i,门禁合规主体句)
  判据与主轮同;失败分类重试:连接被拒=等引擎回场再发(至多3发),渲染错=重试1发。
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIRE = REPO / "apps/build/scripts/my21fast_fire1026_fourcases.py"
OUT_DIR = REPO / "apps/output/my21fast_fire_1025"
IMAGES = OUT_DIR / "images"
ENGINE_LOGS = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/user")

spec = importlib.util.spec_from_file_location("fire", FIRE)
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)

_http_json = F._http_json
log = F.log
queue_gate = F.queue_gate
pixel_compare = F.pixel_compare
img_stats = F.img_stats


def engine_wait(base: str, max_s: float = 420.0) -> bool:
    """引擎死亡窗口兜底:等引擎回场(自愈 guard 会拉起)。"""
    t0 = time.time()
    while time.time() - t0 < max_s:
        try:
            _http_json(f"{base}/system_stats", timeout=5)
            return True
        except Exception:  # noqa: BLE001
            log("[wait] 引擎不可达,15s 后再探")
            time.sleep(15)
    return False


def hist_prompt_graph(hist: dict) -> dict:
    """history['prompt'] 兼容 dict 与 list(新引擎=[number,pid,graph,...])两种形。"""
    p = hist.get("prompt")
    if isinstance(p, dict):
        return p
    if isinstance(p, list):
        for el in p:
            if isinstance(el, dict) and el:
                vals = list(el.values())[:3]
                if all(isinstance(v, dict) and "class_type" in v for v in vals):
                    return el
        if len(p) >= 3 and isinstance(p[2], dict):
            return p[2]
    return {}


def send_arm(base: str, arm: str, graph: dict) -> dict:
    """分类重试:连接被拒→等引擎回场再发(≤3发);渲染错→重试1发;全程留痕。"""
    rec = {"arm": arm, "attempts": []}
    last = None
    for attempt in (1, 2, 3):
        try:
            shape = F._payload_shape_ok(graph)
            assert not shape, f"{arm} 投弹体形坏: {shape}"
            queue_gate(base)
            t0 = time.time()
            accepted = _http_json(f"{base}/prompt", timeout=120,
                                  data={"prompt": graph, "client_id": F.CLIENT_ID})
            node_errors = accepted.get("node_errors") or {}
            if node_errors:
                raise RuntimeError(f"{arm} 200+node_errors: {json.dumps(node_errors, ensure_ascii=False)[:500]}")
            pid = accepted["prompt_id"]
            while True:
                hist = _http_json(f"{base}/history/{pid}", timeout=30).get(pid)
                if hist:
                    break
                if time.time() - t0 > F.ARM_TIMEOUT:
                    raise RuntimeError(f"{arm} 轮询超时")
                time.sleep(F.POLL_INTERVAL)
            elapsed = round(time.time() - t0, 1)
            status = hist.get("status", {})
            err = F._history_error(hist)
            ok = status.get("status_str") == "success" and status.get("completed") and err is None
            last = {"attempt": attempt, "prompt_id": pid, "elapsed_s": elapsed,
                    "status_str": status.get("status_str"), "completed": status.get("completed"),
                    "execution_error": err, "ok": ok, "hist": hist}
            rec["attempts"].append({k: v for k, v in last.items() if k != "hist"})
            log(f"[{arm}] 第{attempt}发 耗时 {elapsed}s status={last['status_str']} err={'无' if not err else err['type']}")
            if ok:
                rec.update({"ok": True, "prompt_id": pid, "elapsed_s": elapsed, "hist": hist})
                return rec
            # 渲染失败:分类后按纪律只重试一次
            log(f"[{arm}] 渲染失败分类: {json.dumps(err, ensure_ascii=False)[:400] if err else status}")
            if attempt >= 2:
                rec.update({"ok": False})
                return rec
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            rec["attempts"].append({"attempt": attempt, "exception": msg[:500]})
            log(f"[{arm}] 第{attempt}发异常: {msg[:300]}")
            last = None
            if "Connection refused" in msg or "Connection reset" in msg:
                if not engine_wait(base):
                    rec.update({"ok": False, "note": "引擎未回场"})
                    return rec
                continue  # 连接被拒=引擎死亡窗口,等回场再发(不计入渲染重试预算)
            if attempt >= 2:
                rec.update({"ok": False})
                return rec
            time.sleep(10)
    rec.update({"ok": False, "note": " attempts exhausted"})
    return rec


def collect_outputs(base: str, arm: str, graph: dict, rec: dict) -> None:
    """取原始出图(前缀 QI21道劫*)+2K 只验成功。"""
    if not rec.get("ok"):
        return
    hist = rec["hist"]
    outputs = hist.get("outputs", {})
    raws, twok = [], None
    for key, node in sorted(graph.items()):
        if node.get("class_type") != "SaveImage":
            continue
        prefix = node.get("inputs", {}).get("filename_prefix", "")
        imgs = outputs.get(key, {}).get("images", [])
        if prefix.startswith("QI21道劫"):
            raws += [(prefix, i) for i in imgs]
        elif prefix.startswith("MYStudio-2K"):
            twok = bool(imgs)
    rec["raw_images"] = []
    for prefix, img in raws:
        dest = IMAGES / f"{arm}__{img['filename']}"
        F._download(base, img, dest)
        rec["raw_images"].append({"engine_filename": img["filename"], "prefix": prefix,
                                  "saved": str(dest.relative_to(OUT_DIR))})
    rec["upscale_2k_ok"] = twok
    rec.pop("hist", None)


def first_image(arm: str) -> Path | None:
    for p in sorted(IMAGES.glob(f"{arm}__*.png")):
        return p
    return None


def main() -> int:
    base = F.PROBE_MOD._engine_base()
    assert base.endswith(":17001"), base
    _http_json(f"{base}/system_stats", timeout=10)
    # 引擎#4 v3 节点在场复核
    oi = _http_json(f"{base}/object_info/MyQi21FastEncode", timeout=20)
    assert "COMFY_AUTOGROW_V3" in json.dumps(oi)[:2000], "v3 形缺席!"
    log(f"[engine] {base} 在跑,v3 节点在册")

    bases = json.loads(F.BASES_JSON.read_text(encoding="utf-8"))
    t0 = next(t for t in bases["types"] if t["zh"] == "人物海报")
    style = bases["art_style_base"]
    pos = t0["positive_text"] + "\n" + style["positive_text"]
    neg = t0["negative_text"] + "，" + style["negative_text"]
    wu_neg = neg + "(暖身变体)"
    # L2T2 门禁合规主体句=产线原 308ch 主体句一词之差(锋芒→英气;发色/鞋履在句)
    api = json.loads(F.T2I_API.read_text(encoding="utf-8"))["graph"]
    subject_orig = api["400"]["inputs"]["value"]
    subject_l2t2 = subject_orig.replace("眉目沉静中带一点锋芒", "眉目沉静中带一点英气")
    assert subject_l2t2 != subject_orig, "L2T2 主体句变体失败"

    # 参考图幂等重传
    ref = F.upload_ref(base)

    graphs = {
        "WU2": F.build_l1("t2i", "TextEncodeQwenImage21", "QI21道劫文生图_L1W2", pos, wu_neg),
        "A2": F.build_l1("t2i", "TextEncodeQwenImage21", "QI21道劫文生图_L1A2", pos, neg),
        "B2": F.build_l1("t2i", "MyQi21FastEncode", "QI21道劫文生图_L1B2", pos, neg),
        "C": F.build_l1("i2i", "TextEncodeQwenImage21", "QI21道劫图生图_L1C", pos, neg),
        "D2": F.build_l1("i2i", "MyQi21FastEncode", "QI21道劫图生图_L1D2", pos, neg),
        "L2T2": F.build_l2("t2i", subject_l2t2),
    }
    for arm, g in graphs.items():
        (OUT_DIR / "graphs" / f"{arm}.json").write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")

    results = {}
    for arm in ["WU2", "A2", "B2", "C", "D2", "L2T2"]:
        log(f"[send] {arm} 开投")
        rec = send_arm(base, arm, graphs[arm])
        collect_outputs(base, arm, graphs[arm], rec)
        results[arm] = rec

    # ── 等值对拍 ──
    pairs = [
        ("L1-A2_vs_L1-B2_t2i_暖态对", "A2", "B2"),
        ("L1-C_vs_L1-D2_i2i_补发对", "C", "D2"),
        ("WU2_vs_A2_负面不变性", "WU2", "A2"),
        ("A2_vs_L1A_跨引擎确定性", "A2", "L1A"),
        ("B2_vs_L1B_跨引擎确定性", "B2", "L1B"),
        ("C_vs_L1D_跨引擎i2i确定性", "C", "L1D"),
        ("D2_vs_L1D_新节点确定性", "D2", "L1D"),
    ]
    equality = {}
    for name, a, b in pairs:
        pa, pb = first_image(a), first_image(b)
        if pa and pb:
            equality[name] = pixel_compare(name, pa, pb)
            log(f"[equal] {name}: equal={equality[name]['equal']} "
                f"hash={equality[name]['pixel_hash_a'][:12]}/{equality[name]['pixel_hash_b'][:12]} "
                f"max_diff={equality[name].get('max_abs_diff')}")
        else:
            equality[name] = {"pair": name, "skipped": f"缺图 {a}={'有' if pa else '无'} {b}={'有' if pb else '无'}"}

    # ── L2 门禁(L2T2 现算;L2I 用主轮留痕证据) ──
    l2_gates = {}
    r = results["L2T2"]
    if r.get("ok"):
        hist = _http_json(f"{base}/history/{r['prompt_id']}", timeout=30)[r["prompt_id"]]
        eg = hist_prompt_graph(hist)
        te_sent = {"4015": graphs["L2T2"]["4015"]["class_type"]}
        te_hist = {"4015": (eg.get("4015") or {}).get("class_type")}
        p = first_image("L2T2")
        st = img_stats(p) if p else {}
        l2_gates["L2T2"] = {
            "history_success": True, "te_class_sent": te_sent, "te_class_history": te_hist,
            "te_class_ok": te_sent["4015"] == "MyQi21FastEncode" == te_hist["4015"],
            "expected_wh": [1088, 1440], "actual_wh": st.get("size"),
            "size_gate": st.get("size") == [1088, 1440],
            "opaque_fraction": st.get("opaque_fraction"),
            "opacity_gate": (st.get("opaque_fraction") or 0) >= 0.95,
            "upscale_2k_success_only": r.get("upscale_2k_ok"),
            "subject_injected": subject_l2t2[:40] + "…(锋芒→英气一词之差,308ch 门禁合规)",
        }
    else:
        l2_gates["L2T2"] = {"history_success": False, "attempts": r.get("attempts")}
    # L2I:主轮 04:15:37 轮询实测 status=success/completed/无err(引擎#3,现 history 已随
    # 引擎死亡蒸发);证据=火线日志+引擎#3 日志[MY出图]+盘上产物
    p = first_image("L2I")
    st = img_stats(p) if p else {}
    twok = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/output/MYStudio-2K_00066_.png")
    l2_gates["L2I"] = {
        "history_success": True,
        "history_success_evidence": "主轮 04:15:37 轮询实测 status_str=success completed=True 无 execution_error"
                                    "(引擎#3 日志 'Prompt executed in 154.79 seconds' @04:15:34;prompt_id=b067ece6)",
        "te_class_sent": {"171": "MyQi21FastEncode", "4015": "MyQi21FastEncode"},
        "te_class_evidence": "引擎#3 日志[MY出图][全量JSON] 实录执行图 171/4015=MyQi21FastEncode"
                             "(graphs/L2I.json 同);历史记录随引擎死亡蒸发,以日志实录为凭",
        "expected_wh": [896, 1184], "actual_wh": st.get("size"),
        "size_gate": st.get("size") == [896, 1184],
        "opaque_fraction": st.get("opaque_fraction"),
        "opacity_gate": (st.get("opaque_fraction") or 0) >= 0.95,
        "upscale_2k_success_only": twok.is_file(),
        "upscale_2k_evidence": "MYStudio-2K_00066_.png @04:15(主轮窗口内唯一 2K 产物,L1D 无 2K 臂、L2T 未成图)",
    }
    log(f"[l2gate] L2T2: {json.dumps(l2_gates['L2T2'], ensure_ascii=False)[:300]}")
    log(f"[l2gate] L2I: size={st.get('size')} opaque={st.get('opaque_fraction')} 2K={twok.is_file()}")

    # ── 图像统计 ──
    stats = {}
    for arm in ["WU", "L1A", "L1B", "L1D", "L2I", "WU2", "A2", "B2", "C", "D2", "L2T2"]:
        p = first_image(arm)
        if p:
            stats[arm] = {"file": p.name, **img_stats(p)}

    report = {
        "meta": {"engine": base, "seed": 424242, "steps": 8, "cfg": 1.0, "sampler": "euler",
                 "scheduler": "simple", "note": "恢复轮(引擎不稳夜);主轮留痕见 fire_log_raw.txt",
                 "generated_at": datetime.now().isoformat()},
        "recovery_arms": {a: {k: v for k, v in r.items() if k != "hist"} for a, r in results.items()},
        "original_run_summary": {
            "WU": "96.2s success(引擎#1)", "L1A": "93.2s success(引擎#2)",
            "L1B": "72.2s success(引擎#2)", "L1C": "两发连接被拒(引擎#2死亡窗口)→本轮补发C",
            "L1D": "138.5s success(引擎#3)", "L2T": "两发被产线提示词门禁拒(型文画风词入主体句)→本轮L2T2换合规主体句",
            "L2I": "157.6s success(引擎#3,含2K臂)",
            "original_equalities": {"L1-A_vs_L1-B": "equal=True hash=69c31cd820c4…(主轮 04:15:37 实测)",
                                    "WU_vs_L1A_负面不变性": "equal=True 同哈希"},
        },
        "engine_restart_timeline": [
            "引擎#1 03:25:06 起;~04:04 死于外来 charcard 件渲染中(官方TE+参考图+MPS VAE,悬10分钟后硬死)",
            "引擎#2 04:06:27 起;~04:10 死于 L1C(官方TE i2i)渲染中,VAE 装载后30秒内硬死无traceback",
            "引擎#3 04:10:19 起;L1D/L2T(门禁拒)/L2I 皆其上;04:17:39 前死亡(空闲态,Manager后台任务后)",
            "引擎#4 04:17:39 起(本恢复轮);部署副本三次换血后仍 v3(diff 复核)",
        ],
        "equality": equality, "image_stats": stats, "l2_gates": l2_gates,
    }
    (OUT_DIR / "fire_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    # 引擎日志证据摘录([MY出图] 摘要行)
    evidence = []
    for lg in sorted(ENGINE_LOGS.glob("comfyui_17001*.log")):
        try:
            text = lg.read_text(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            continue
        for line in text.splitlines():
            if "[MY出图][摘要]" in line and ("QI21道劫" in line or "my21fast" in line or "charcard" in line):
                evidence.append(f"[{lg.name}] {line.strip()[:600]}")
    (OUT_DIR / "engine_log_evidence.txt").write_text("\n".join(evidence), encoding="utf-8")

    log(f"[done] 报告落 {OUT_DIR / 'fire_report.json'}")
    print("\n===== 恢复轮摘要 =====", flush=True)
    for a, r in results.items():
        print(f"{a}: ok={r.get('ok')} elapsed={r.get('elapsed_s')}s attempts={len(r.get('attempts', []))}", flush=True)
    for k, v in equality.items():
        print(f"等值 {k}: equal={v.get('equal')} max_diff={v.get('max_abs_diff')}", flush=True)
    for k, v in l2_gates.items():
        print(f"L2门 {k}: success={v.get('history_success')} te_ok={v.get('te_class_ok', v.get('te_class_sent'))} "
              f"size={v.get('actual_wh')}(期望{v.get('expected_wh')}) opaque={v.get('opaque_fraction')}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
