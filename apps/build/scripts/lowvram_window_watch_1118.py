#!/usr/bin/env python3
"""1118 h3-lowvram 静窗守望器(world.run 驱动形态)。

退出码:0=空窗开(完链指纹在 history+队列 0/0 持续 hold 秒);3=守望超时无窗。
代理环境自剥(urllib 会吃 http_proxy 假阴性——Mac 直连铁律)。
"""
import json
import os
import sys
import time
import urllib.request

for k in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(k, None)

BASE = "http://192.168.0.101:17000"


def get(path, timeout=8):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def state():
    """(完链指纹数, 队列 running, pending)——指纹=ReCaVSR+1062/3011 完链(新旧结构皆可:
    发弹器 v2 双版本自适应,旧→正注入/新→反注入)。"""
    try:
        h = get("/history?max_items=30")
        fp = 0
        for rec in h.values():
            p = rec.get("prompt") or []
            if len(p) >= 3 and isinstance(p[2], dict):
                g = p[2]
                types = {v.get("class_type") for v in g.values() if isinstance(v, dict)}
                if "ReCaVSRUpscale" in types and "1062" in g and "3011" in g:
                    fp += 1
        q = get("/queue")
        return fp, len(q.get("queue_running", [])), len(q.get("queue_pending", []))
    except Exception:
        return -1, -1, -1


def main():
    max_wait = int(sys.argv[sys.argv.index("--max-wait-sec") + 1]) if "--max-wait-sec" in sys.argv else 300
    hold = int(sys.argv[sys.argv.index("--hold-sec") + 1]) if "--hold-sec" in sys.argv else 20
    t0 = time.time()
    last = None
    while time.time() - t0 < max_wait:
        fp, run, pend = state()
        last = (fp, run, pend)
        if fp >= 1 and run == 0 and pend == 0:
            ok_since = time.time()
            while time.time() - ok_since < hold:
                time.sleep(4)
                fp2, run2, pend2 = state()
                if not (fp2 >= 1 and run2 == 0 and pend2 == 0):
                    last = (fp2, run2, pend2)
                    break
            else:
                print(f"WINDOW_OPEN fp={fp} held={hold}s waited={int(time.time()-t0)}s")
                return 0
        if int(time.time() - t0) % 60 < 6:
            print(f"waiting {int(time.time()-t0)}s: fp/run/pend={last}", flush=True)
        time.sleep(8)
    print(f"NO_WINDOW after {max_wait}s last={last}")
    return 3


if __name__ == "__main__":
    sys.exit(main())
