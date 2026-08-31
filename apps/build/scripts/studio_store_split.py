#!/usr/bin/env python3
"""studio-store 专批:内联 action 族按既有 slice 模式抽出。

两族:run-task(agent-run+media-task [335,528])/image-workflow([612,778]);
体逐字保留,门面 return 块内以 slice 名替换。幂等:从 git HEAD 重建。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "apps" / "frontend" / "stores" / "studio" / "studio-store.ts"

original = subprocess.run(["git", "show", "HEAD:apps/frontend/stores/studio/studio-store.ts"],
                          capture_output=True, text=True, cwd=REPO).stdout
lines = original.splitlines(keepends=True)
def seg(a, b): return "".join(lines[a - 1: b])

RUN_TASK_BODY = seg(335, 528).rstrip("\n")
IMG_WF_BODY = seg(612, 778).rstrip("\n")

# 闭包引用盘点:两族体内引用的自由变量(除 set/get)
import re
def free_refs(body):
    ids = set(re.findall(r"\b([a-zA-Z_]\w*)\b", body))
    return ids

rt_ids = free_refs(RUN_TASK_BODY)
iw_ids = free_refs(IMG_WF_BODY)

# 原文件顶层导入名+本文件定义的助手(initialState 等)
imported = set()
for m in re.finditer(r"import (?:type )?\{([^}]*)\} from", original):
    for item in m.group(1).split(","):
        n = re.sub(r"^type ", "", item.strip()).split(" as ")[-1].strip()
        if n:
            imported.add(n)
top_defines = set(re.findall(r"^(?:const|function|let) (\w+)", original, re.M))
known = imported | top_defines | {"set", "get", "true", "false", "null", "undefined", "Math", "Date", "JSON", "console", "Promise", "Array", "Object", "window"}

rt_free = sorted((rt_ids - known) - set(re.findall(r"(?:const|let)\s+\w+", RUN_TASK_BODY)))
iw_free = sorted((iw_ids - known) - set(re.findall(r"(?:const|let)\s+\w+", IMG_WF_BODY)))
print("run-task 额外自由变量:", [x for x in rt_free if x[0].islower()])
print("image-wf 额外自由变量:", [x for x in iw_free if x[0].islower()])

HDR = '''import type { StateCreator } from "zustand";

'''
# 已有 slice 的签名风格:回看 material-slice 的导出形态
mat = (REPO / "apps/frontend/stores/studio/material-slice.ts").read_text(encoding="utf-8")
sig = re.search(r"export function createMaterialSliceActions\([^)]*\)[^{]*\{", mat)
print("---material-slice 签名---")
print(sig.group(0) if sig else mat[:400])
