#!/usr/bin/env python3
"""electron/main/main.ts 职责地图:顶层声明+import 分组+区段行距,供拆分设计。

只读分析;输出 stdout 摘要。
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MAIN = REPO / "apps" / "frontend" / "electron" / "main" / "main.ts"
text = MAIN.read_text(encoding="utf-8")
lines = text.splitlines()

print(f"总行数: {len(lines)}")

# import 分组统计
import_re = re.compile(r"^import .*? from ['\"]([^'\"]+)['\"]")
groups = Counter()
for l in lines:
    m = import_re.match(l)
    if not m:
        continue
    spec = m.group(1)
    if spec.startswith("."):
        top = "/".join(spec.lstrip("./").split("/")[:2])
        groups[f"相对:{top}"] += 1
    else:
        groups[f"包:{spec.split('/')[0]}"] += 1
print("\n【import 来源分布】")
for k, v in groups.most_common():
    print(f"  {v:3d}  {k}")

# 顶层声明(function/async function/const xxx = /class)及其行区间
print("\n【顶层声明清单】(行区间=起-讫,长度排序 TOP40)")
decls = []
for i, l in enumerate(lines, 1):
    name = None
    m = re.match(r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)", l)
    if m:
        name, kind = m.group(1), "fn"
    else:
        m = re.match(r"^(?:export\s+)?const\s+(\w+)\s*[:=]", l)
        if m:
            name, kind = m.group(1), "const"
    if name:
        decls.append({"line": i, "name": name, "kind": kind})
decls.append({"line": len(lines) + 1, "name": "<EOF>", "kind": "eof"})
for a, b in zip(decls, decls[1:]):
    a["span"] = b["line"] - a["line"]
big = [d for d in decls[:-1] if d["span"] >= 15]
for d in sorted(big, key=lambda x: -x["span"])[:40]:
    print(f"  L{d['line']:4d} +{d['span']:4d}  {d['kind']:5s} {d['name']}")

# 语义区段探测(注释分隔或初始化调用群)
print("\n【调用面密度】")
for pat in ["app.whenReady", "app.on(", "ipcMain", "spawn(", "new BrowserWindow", "process.on", "clipboard", "dialog", "shell.", "Menu", "globalShortcut", "powerMonitor", "protocol."]:
    n = len(re.findall(re.escape(pat), text))
    if n:
        print(f"  {n:3d}  {pat}")
