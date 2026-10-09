#!/usr/bin/env python3
"""九型 PE 实拍·报告重建(0924):
驱动末步写报告时 apps/out 目录被外因清掉(ENOENT,驱动日志 14:55 在案;九拍图证
与引擎 history 完好)——本脚本从两处真源重建 nine-pe-driver-report.json:
  ① 引擎 /history:9 条 success 项(pid/服务端排队图/引擎文件名/执行段秒数),按
     40:140 prompt 种子指纹对位九型;
  ② /tmp/qi21-ninepe-0924/driver.log:逐拍墙钟/sips 尺寸/PE 文本长/PASS 台账;
  ③ ~/Downloads/q21-nine-pe-0924/{idx}-pe-rewritten.txt:PE 改写全文(前 80 字)。
用法:python3 qi21_nine_pe_rebuild_0924.py(引擎须在位;纯读+写报告,零副作用)
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ENGINE = "http://127.0.0.1:17002"
REPORT_DIR = Path.home() / "Project/Github/MYStudio/apps/out/q21-final-0924"
REPORT = REPORT_DIR / "nine-pe-driver-report.json"
DRIVER_LOG = Path("/tmp/qi21-ninepe-0924/driver.log")
IMG_DIR = Path.home() / "Downloads/q21-nine-pe-0924"
WF = str(Path.home() / "Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json")

TYPES = [
    (1, "人物", "她立于山门石阶最上一级"), (2, "场景", "九根断裂的石柱围成半圆"),
    (3, "道具", "一柄传承千年的青铜剑"), (4, "美宣", "雷劫降临的至暗时刻"),
    (5, "三视图", "横幅六格等分"), (6, "高清人脸", "几缕碎发垂在颊边"),
    (7, "分镜剧情图", "老船工收篙回望"), (8, "表情差分", "九宫格表情差分"),
    (9, "概念气氛图", "灵潮涨落之夜"),
]


def http_json(url):
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    hist = http_json(f"{ENGINE}/history")
    # 对位:success 且 40:140 种子含该型指纹
    cases = []
    for idx, name, sig in TYPES:
        hit = None
        for pid, e in hist.items():
            if e.get("status", {}).get("status_str") != "success":
                continue
            blob = json.dumps(e.get("prompt", [None, None, {}])[2], ensure_ascii=False)
            if sig in blob and '"switch": true' in blob.replace('"switch":true', '"switch": true'):
                hit = (pid, e, blob)
                break
        if not hit:
            print(f"第{idx}型({name})history 对位失败", file=sys.stderr)
            cases.append({"idx": idx, "type": name, "error": "history 对位失败"})
            continue
        pid, e, blob = hit
        imgs = [i for o in (e.get("outputs") or {}).values() for i in (o.get("images") or [])]
        msgs = e.get("status", {}).get("messages", [])
        ts = None
        for m in msgs:
            if isinstance(m, list) and m[0] == "execution_start" and isinstance(m[1], dict):
                ts = m[1].get("timestamp")
            if isinstance(m, list) and m[0] == "execution_success" and isinstance(m[1], dict) and ts:
                ts = m[1].get("timestamp") - ts
        exec_secs = round(ts / 1000) if ts else None
        pe_txt = (IMG_DIR / f"{idx}-pe-rewritten.txt").read_text(encoding="utf-8")
        img = IMG_DIR / f"{idx}-{name}.png"
        cases.append({
            "idx": idx, "type": name, "pid": pid,
            "image": str(img), "engineFile": imgs[0]["filename"] if imgs else None,
            "bytes": img.stat().st_size if img.exists() else None,
            "peTextHead80": pe_txt[:80], "peTextLen": len(pe_txt),
            "execSecs": str(exec_secs) if exec_secs is not None else None,
            "serverQueueBlob": blob,
        })

    # driver.log 解析:墙钟/尺寸/结果台账
    log = DRIVER_LOG.read_text(encoding="utf-8", errors="replace")
    results = []
    for ln in log.splitlines():
        m = re.match(r"\d\d:\d\d:\d\d (PASS|FAIL)  (.+?)(?: — (.*))?$", ln)
        if m:
            results.append({"name": m.group(2), "pass": m.group(1) == "PASS", "detail": m.group(3) or ""})
    for c in cases:
        tag = f"[{c['idx']}-{c['type']}]"
        m = re.search(re.escape(tag) + r" 引擎执行成功\(execution_success;墙钟 (\d+)s/执行段 (\d+)s\)", log)
        if m:
            c["wallSecs"] = m.group(1)
            c["execSecs"] = m.group(2)
        m2 = re.search(re.escape(tag) + r" sips 尺寸=(\d+x\d+).*?实际 (\d+x\d+)", log)
        if m2:
            c["expectedDims"] = m2.group(1)
            c["size"] = m2.group(2)
    report = {
        "phase": "all", "engine": ENGINE, "wf": WF,
        "startedAt": "2026-09-24T14:04:43+08:00(重建自驱动日志首行)",
        "finishedAt": "2026-09-24T14:55:17+08:00(九拍末次 /free)",
        "genTimeoutMs": 1200000,
        "engineLog": "/tmp/qi21-ninepe-0924/engine.log",
        "rebuilt": True,
        "rebuildNote": "驱动末步原位写报告时 apps/out 被外因清空(ENOENT;九拍与图证完好),"
                       "本报告由引擎 /history + 驱动日志 + PE 文本存档重建;干跑取证以驱动日志台账为准。",
        "cases": cases, "results": results,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"rebuilt {REPORT}: cases={len(cases)} checks pass={sum(1 for r in results if r['pass'])} fail={sum(1 for r in results if not r['pass'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
