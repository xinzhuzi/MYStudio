#!/usr/bin/env python3
"""全型扫测·逐型实发装配提示词审计 · 1118。
从引擎 history 按各型 pid 抠 401(MyQi21PromptPreview) 的 ui.text=装配全文,
落 types/<型>/assembled_prompt.txt 并打印头部摘要+核对标记。"""
from __future__ import annotations
import json, os, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "apps/output/gem-t8-1118/types"
ENGINE = "http://192.168.0.101:17000"
for k in list(os.environ):
    if "proxy" in k.lower():
        del os.environ[k]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

results = json.loads((OUT / "_results.json").read_text(encoding="utf-8"))
for r in results:
    t = r["type"]
    pid = r.get("pid")
    if not r.get("ok") or not pid:
        print(f"[audit] {t}: 无成功 pid,跳过")
        continue
    with opener.open(f"{ENGINE}/history/{pid}", timeout=30) as resp:
        rec = json.load(resp).get(pid, {})
    texts = []
    for nid, o in rec.get("outputs", {}).items():
        ui = o.get("ui") or {}
        if "text" in ui:
            v = ui["text"]
            texts.append(v if isinstance(v, str) else "\n".join(map(str, v)))
    if not texts:
        print(f"[audit] {t}: history 无 ui.text(预览节点未吐文),如实记录")
        continue
    full = max(texts, key=len)
    p = OUT / t / "assembled_prompt.txt"
    p.write_text(full, encoding="utf-8")
    print(f"[audit] {t}: {len(full)}字 落 {p.relative_to(REPO)}")
    print("   头120字:", full[:120].replace("\n", "⏎"))
