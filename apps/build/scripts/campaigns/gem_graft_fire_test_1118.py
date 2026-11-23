#!/usr/bin/env python3
"""gem_graft_fire_test_1118.py — 道劫两件 Gem② 嫁接实弹测试(1118)

用法:
  python3 gem_graft_fire_test_1118.py fire           # 发 t2i 实弹 + 轮询到完成/超时
  python3 gem_graft_fire_test_1118.py check <pid>    # 续查某 prompt_id
  python3 gem_graft_fire_test_1118.py fetch <pid>    # 只取产物(已完成的)
产物落: apps/output/gem-graft-1118/
口径: 冷/热以引擎是否需现载权重为准,计时含载入。
"""
import json
import os
import struct
import sys
import time
import urllib.request

ENGINE = "http://192.168.0.101:17000"
TWIN = "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/qwen21-道劫-t2i-api.json"
OUT_DIR = "apps/output/gem-graft-1118"
POLL_S = 5
POLL_MAX_S = 540  # Bash 前台 600s 帽内自保,超时走 check 续查

os.environ.pop("http_proxy", None)
os.environ.pop("https_proxy", None)
os.environ.pop("all_proxy", None)
os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ.pop("ALL_PROXY", None)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_json(path, data=None):
    req = urllib.request.Request(
        ENGINE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with opener.open(req, timeout=60) as r:
        return json.loads(r.read().decode())


def png_dims(path):
    with open(path, "rb") as f:
        head = f.read(26)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", head[16:24])
    return w, h


def poll(pid, budget_s):
    t0 = time.time()
    while time.time() - t0 < budget_s:
        h = http_json("/history/" + pid)
        if pid in h:
            rec = h[pid]
            st = rec.get("status", {})
            if st.get("completed") or rec.get("outputs"):
                return rec
        time.sleep(POLL_S)
    return None


def fetch_outputs(rec, tag):
    os.makedirs(OUT_DIR, exist_ok=True)
    got = []
    for nid, out in rec.get("outputs", {}).items():
        for img in out.get("images", []):
            fn, sub, typ = img["filename"], img.get("subfolder", ""), img["type"]
            url = f"{ENGINE}/view?filename={urllib.request.quote(fn)}&subfolder={urllib.request.quote(sub)}&type={typ}"
            dest = os.path.join(OUT_DIR, f"{tag}_{nid}_{fn}")
            with opener.open(url, timeout=120) as r, open(dest, "wb") as f:
                f.write(r.read())
            got.append((dest, png_dims(dest), os.path.getsize(dest)))
    return got


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "fire"
    if mode == "fire":
        graph = json.load(open(TWIN))["graph"]
        # 实弹口径不改图:原样发(App 发的就是这张图);提示词/seed=件内现行值
        t0 = time.time()
        resp = http_json("/prompt", {"prompt": graph, "client_id": "gem-graft-test-1118"})
        pid = resp["prompt_id"]
        print(f"[fire] prompt_id={pid} accepted={resp.get('number')}", flush=True)
        rec = poll(pid, POLL_MAX_S)
        dt = time.time() - t0
        if rec is None:
            print(f"[poll] {dt:.0f}s 未完(可能冷载),续查: python3 {sys.argv[0]} check {pid}", flush=True)
            sys.exit(7)
        finish(rec, pid, dt, "t2i")
    elif mode == "check":
        pid = sys.argv[2]
        t0 = time.time()
        rec = poll(pid, POLL_MAX_S)
        if rec is None:
            print("[poll] 仍未完", flush=True)
            sys.exit(7)
        finish(rec, pid, time.time() - t0, "t2i-resume")
    elif mode == "fetch":
        finish(http_json("/history/" + sys.argv[2]), sys.argv[2], 0.0, "t2i-fetch")


def finish(rec, pid, dt, tag):
    st = rec.get("status", {})
    print(f"[done] completed={st.get('completed')} status_msg={st.get('status_str')} 耗时口径(本次轮询窗)={dt:.0f}s")
    if st.get("status_str") != "success":
        print("[error] 引擎侧执行失败,拉日志排查:", json.dumps(st, ensure_ascii=False)[:2000])
        sys.exit(8)
    for dest, dims, size in fetch_outputs(rec, tag):
        print(f"[out] {dest} dims={dims} bytes={size}")
    print(f"[pid] {pid}")


if __name__ == "__main__":
    main()
