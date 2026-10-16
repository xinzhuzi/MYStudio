#!/usr/bin/env python3
"""qi21-道劫-i2i [6] 宿主标题复原(2026-10-15,第三次)。
UI 保存顽固症:每次画布保存必吃 [6] 宿主自定义 title([7] 不受累)——
本脚本=每次用户保存后的标准复原刀(fail-closed,幂等)。"""
import json, shutil, sys, hashlib
from pathlib import Path
WF = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
INSTALL = Path("/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
TITLE = "[6] 文本提示词类型优化子图"
pre = hashlib.md5(WF.read_bytes()).hexdigest()
d = json.loads(WF.read_text(encoding="utf-8"))
n6 = next(n for n in d["nodes"] if n["id"] == 6)
if n6.get("title") == TITLE:
    print("[t6] 已复原态,幂等拦停"); sys.exit(3)
if n6.get("title") is not None:
    print(f"[t6] FAIL: [6] title 非 None({n6.get('title')!r}),锚不符"); sys.exit(2)
shutil.copy2(WF, WF.with_suffix(".json.bak-1015t6"))
n6["title"] = TITLE
WF.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
r = json.loads(WF.read_text(encoding="utf-8"))
assert next(n for n in r["nodes"] if n["id"] == 6)["title"] == TITLE
new = hashlib.md5(WF.read_bytes()).hexdigest()
print(f"[t6] 复原 {pre[:8]}→{new[:8]}")
shutil.copy2(WF, INSTALL)
assert hashlib.md5(INSTALL.read_bytes()).hexdigest() == new
print("[t6] 装机同步 md5 同")
