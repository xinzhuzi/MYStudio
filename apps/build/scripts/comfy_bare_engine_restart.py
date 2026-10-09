#!/usr/bin/env python3
"""裸起(非 App 侧车)ComfyUI 引擎原样重启——canvas_deploy 侧车重启路径不可用时的补位。

从监听端口的活进程动态取 argv/cwd/stdout(不手敲中文路径),队列须为 0 才动;
SIGTERM→等端口释放→同 argv、同 cwd、同 PYTHONUTF8 环境 nohup 追加写回原日志→等 /system_stats 健康。
默认 dry-run,--apply 才重启。

用法:python3 apps/build/scripts/comfy_bare_engine_restart.py [--port 17001] [--apply]
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

import psutil

HEALTH_TIMEOUT_S = 240


def _get(port: int, path: str) -> dict:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return json.load(r)


def _listen_pids(port: int) -> list:
    """macOS 全局 net_connections 需 root,改走 lsof。"""
    out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], capture_output=True, text=True).stdout
    return [int(x) for x in out.split()]


def _listener(port: int) -> psutil.Process:
    pids = _listen_pids(port)
    if len(pids) != 1:
        raise SystemExit(f"端口 {port} 监听进程数={len(pids)}(须恰 1)")
    return psutil.Process(pids[0])


def _stdout_path(p: psutil.Process) -> str:
    for f in p.open_files():
        if f.fd == 1:
            return f.path
    raise SystemExit("取不到引擎 stdout 路径,拒绝盲起")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=17001)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    q = _get(a.port, "/queue")
    busy = len(q["queue_running"]) + len(q["queue_pending"])
    p = _listener(a.port)
    spec = {"pid": p.pid, "argv": p.cmdline(), "cwd": p.cwd(), "log": _stdout_path(p), "queue": busy}
    print(json.dumps(spec, ensure_ascii=False, indent=2))
    if busy:
        raise SystemExit(f"队列非空({busy}),不重启")
    if not a.apply:
        return 0
    p.terminate()
    p.wait(timeout=60)
    for _ in range(30):
        if not _listen_pids(a.port):
            break
        time.sleep(1)
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    with open(spec["log"], "ab") as log:
        new = subprocess.Popen(spec["argv"], cwd=spec["cwd"], env=env, stdin=subprocess.DEVNULL,
                               stdout=log, stderr=log, start_new_session=True)
    t0 = time.time()
    while time.time() - t0 < HEALTH_TIMEOUT_S:
        try:
            _get(a.port, "/system_stats")
            print(json.dumps({"restarted": True, "new_pid": new.pid, "secs": int(time.time() - t0)}))
            return 0
        except OSError:
            time.sleep(5)
    raise SystemExit(f"健康等待超时(新 pid {new.pid})")


if __name__ == "__main__":
    sys.exit(main())
