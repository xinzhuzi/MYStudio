#!/usr/bin/env python3
"""把拆分产生的「仅类型可达」新文件登记进防复发门禁的基线(2026-11-24 超线文件拆分)。

用法(在 apps/ 下):python3 build/scripts/campaigns/file_split_1124/baseline_register.py <文件(相对 apps/frontend)> …
门禁口径:「不可达」只按运行时导入算,纯类型模块记为 type-only 不可达、由基线逐条登记(types/ 下已有 17 件同性质)。
本工具只登记门禁当前报告为 type-only 的指定文件,不重新生成整份基线(不吸收别的会话的在途文件);
指定文件若被门禁判为 none(连类型边都到不了)则拒绝——那说明它真的没人用。
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APPS = os.path.abspath(os.path.join(HERE, "../../../.."))  # file_split_1124 → campaigns → scripts → build → apps
subprocess.run(["node", os.path.join(APPS, "build/scripts/arch_layer_gate.mjs")], capture_output=True, cwd=APPS)
report = json.load(open(os.path.join(APPS, "output/automation/arch-layer-gate-report.json"), encoding="utf-8"))
current = {x["file"]: x["kind"] for x in report["unreachable"]}
bp = os.path.join(APPS, "build/scripts/arch-layer-gate-baseline.json")
raw = open(bp, encoding="utf-8").read()
base = json.loads(raw)
have = {x["file"] for x in base["unreachable"]}
added, refused = [], []
for f in sys.argv[1:]:
    if f in have:
        continue
    kind = current.get(f)
    if kind == "type-only":
        base["unreachable"].append({"file": f, "kind": kind})
        have.add(f)
        added.append(f)
    else:
        refused.append((f, kind))
if added:
    base["unreachable"].sort(key=lambda x: x["file"])
    indent = 2 if raw.lstrip().startswith('{\n  "') else 1
    with open(bp, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(base, ensure_ascii=False, indent=indent) + ("\n" if raw.endswith("\n") else ""))
print(f"已登记 {len(added)} 件(type-only): {added}")
if refused:
    print(f"拒绝 {len(refused)} 件(门禁的判定: {dict(refused)})")
    sys.exit(1)
