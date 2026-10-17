#!/usr/bin/env python3
"""1010 27B 换件实弹收据:Mac LM Studio 新模型 qwen3.8-27b-coder390(旧
qwen3.8-27b-uncensored-mlx 已删)经 MyQi21ApiPE.rewrite 真实代码路径单发验证。

- 单目标 Mac 路由(api_url=127.0.0.1:1234 + 新模型名)——正是工作流回落二级
  的形态;主路 Win9B 不在本测(未动)。
- 复用短路回归锁同款主体句(境界词在场,机检零违例形态)。
- 判据:ui.api_pe_status 以「AI扩写OK:qwen3.8-27b-coder390」开头 + 终稿非空。
"""
from __future__ import annotations

import importlib.util
import io
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_NODE = REPO / "backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py"

_spec = importlib.util.spec_from_file_location("my_qi21_api_pe_fire", _NODE)
api_pe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api_pe)

SUBJ = "金丹中期剑修"
if len(sys.argv) > 1:
    SUBJ = sys.argv[1]
    print(f"[输入主体句] {len(SUBJ)} 字")
LONG = "金丹中期剑修立于大殿," + "云纹自梁间垂落而气象端凝," * 30 + "收束。"

node = api_pe.MyQi21ApiPE()
buf = io.StringIO()
t0 = time.time()
with redirect_stdout(buf):
    got = node.rewrite(
        正向提示词=SUBJ, 类型句正向=None, 负向提示词=None,
        画幅宽=1024, 画幅高=1024, 透明模式=False,
        系统提示词="只输出JSON", 色卡="",
        api_url="http://127.0.0.1:1234", model="qwen3.8-27b-coder390",
        temperature=0.7, max_tokens=12000, timeout_sec=540,
        thinking_effort="关闭")
elapsed = time.time() - t0

node_log = buf.getvalue()
status = got["ui"]["api_pe_status"][0]
final = got["result"][0] if got["result"] else ""

print(f"[耗时] {elapsed:.1f}s")
print(f"[状态] {status}")
print(f"[终稿长度] {len(final)} 字")
print(f"[终稿头80] {final[:80]}")
print(f"[终稿尾40] {final[-40:]}")
key_lines = [l for l in node_log.splitlines()
             if any(k in l for k in ("免重试", "重试", "补发", "拒收", "回退", "信封", "路由"))]
print("[节点日志关键行]")
for l in key_lines[:10]:
    print("  " + l)

ok = status.startswith("AI扩写OK:qwen3.8-27b-coder390") and len(final) > 100
receipt = REPO / "build/runs/qi21_27b_newname_fire_1010.txt"
receipt.parent.mkdir(parents=True, exist_ok=True)
with receipt.open("a", encoding="utf-8") as f:
    f.write(f"===== {time.strftime('%F %T')} 输入主体句({len(SUBJ)}字) =====\n{SUBJ}\n")
    f.write(f"----- 终稿({len(final)}字, {elapsed:.1f}s) -----\n{final}\n\n")
print(f"[收据] 全文已落 {receipt}")
print("[终稿全文]")
print(final)
print(f"[判定] {'PASS' if ok else 'FAIL'}")
sys.exit(0 if ok else 1)
