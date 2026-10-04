#!/usr/bin/env python3
"""1004 PE 终稿取件器(手动测试配套,零驻留):出图后随时跑,打印最近 N 发的"最终进编码器提示词"。

原理:工作流 [401] 装配预览(easy showAnything)=最终文本出口(PE 开=英文终稿,PE 关=中文装配全文);
showAnything 是输出节点,其文本必落引擎 history.outputs。本脚本只读 /history,不碰引擎不写盘。
用法:python3 pe_final_fetch_1004.py [条数,默认3]
端口:自动取(ps 里 main.py 的 --port;取不到再试账本 17000)。
"""
import json
import subprocess
import sys
import urllib.request


def engine_port() -> int:
    try:
        out = subprocess.run(["ps", "aux"], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            if "main.py" in line and "--port" in line and "grep" not in line:
                for i, tok in enumerate(line.split()):
                    if tok == "--port":
                        return int(line.split()[i + 1])
                    if tok.startswith("--port="):
                        return int(tok.split("=")[1])
    except Exception:
        pass
    return 17000


def fetch(count: int) -> int:
    port = engine_port()
    url = f"http://127.0.0.1:{port}/history?max_entries={max(count * 4, 40)}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            hist = json.loads(r.read())
    except Exception as e:
        print(f"引擎未应答(端口 {port}):{e}")
        print("先打开漫影出一图,再跑本命令。")
        return 1
    rows = []
    for pid, entry in hist.items():
        texts = []
        for node_id, out in (entry.get("outputs") or {}).items():
            for t in out.get("text") or []:
                if isinstance(t, str) and len(t) > 40:  # 过滤短杂文本
                    texts.append((node_id, t))
        if not texts:
            continue
        status = (entry.get("status") or {}).get("status_str", "?")
        rows.append((entry.get("status", {}).get("completed_at") or 0, pid, status, texts))
    rows.sort(reverse=True)
    if not rows:
        print("history 里还没有带文本输出口的出图记录。")
        return 0
    for ts, pid, status, texts in rows[:count]:
        print(f"\n━━━ prompt {pid[:8]} · {status} ━━━")
        for node_id, t in texts:
            print(f"── 出口[{node_id}] 全文({len(t)}字)──")
            print(t)
    return 0


if __name__ == "__main__":
    sys.exit(fetch(int(sys.argv[1]) if len(sys.argv) > 1 else 3))
