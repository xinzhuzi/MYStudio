#!/usr/bin/env python3
"""1118 h3-lowvram 静窗守望器 v2(改造件;原 lowvram_window_watch_1118.py 不动)。

v1→v2 唯一改造:去掉旧结构完链指纹条件(fp>=1,原 :34-36)——1118 实测引擎 history 恒无
chunks==1 旧结构完链(App 已转发新结构+重启清零),该条件在新常态永不开窗(恒退码3)。
v2 静窗=纯队列口径:queue 0/0 持续 hold 秒。
退出码:0=空窗开;3=守望超时无窗。代理环境自剥(Mac 直连铁律)。
(livefire v2 已内建同款静窗,本件保留供独立守望/长窗观测用。)
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
    """(running, pending) 纯队列口径,无指纹条件。"""
    try:
        q = get("/queue")
        return len(q.get("queue_running", [])), len(q.get("queue_pending", []))
    except Exception:  # noqa: BLE001
        return -1, -1


def main():
    max_wait = int(sys.argv[sys.argv.index("--max-wait-sec") + 1]) if "--max-wait-sec" in sys.argv else 300
    hold = int(sys.argv[sys.argv.index("--hold-sec") + 1]) if "--hold-sec" in sys.argv else 20
    t0 = time.time()
    last = None
    while time.time() - t0 < max_wait:
        run, pend = state()
        last = (run, pend)
        if run == 0 and pend == 0:
            ok_since = time.time()
            while time.time() - ok_since < hold:
                time.sleep(4)
                r2, p2 = state()
                if not (r2 == 0 and p2 == 0):
                    last = (r2, p2)
                    break
            else:
                print(f"WINDOW_OPEN held={hold}s waited={int(time.time()-t0)}s")
                return 0
        if int(time.time() - t0) % 60 < 6:
            print(f"waiting {int(time.time()-t0)}s: run/pend={last}", flush=True)
        time.sleep(8)
    print(f"NO_WINDOW after {max_wait}s last={last}")
    return 3


if __name__ == "__main__":
    sys.exit(main())
