#!/usr/bin/env python3
"""1118 h3-lowvram G1-G3 实弹:同 seed 挂前/挂后各一发,逐位对账+时长+显存。

挂前=引擎 history 最近一支三采 prompt(旧结构:无 1072,#3011 chunks=1);
挂后=同 prompt +{'1072':MiniMaxLowVRAMAttention(model←1062,head_chunks=2)}
      +1071.model 改吃 1072 +#3011.chunks=2。
G1 逐位一致=三口产物 MD5 全等;G2 时长=两发 wall 账;G3 显存=轮询 system_stats 峰值。
"""
import hashlib
import json
import os
import sys
import threading
import time
import urllib.request

for k in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(k, None)

BASE = "http://192.168.0.101:17000"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "output", "lowvram-1118")
FINGERPRINT = ("ReCaVSRUpscale",)  # 1118 实测:history 七支完链=72 节点(含 1062/1071/3011+ReCaVSR)


def http(path, payload=None, timeout=30, retries=3):
    """1118 实弹教训:轮询无重试会被一次网络抖动/引擎重启整死——恒三连试。"""
    last = None
    for i in range(retries):
        try:
            url = BASE + path
            data = json.dumps(payload).encode() if payload is not None else None
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read() or b"{}")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(4)
    raise last


def pick_recent_prompt():
    h = http("/history?max_items=100")
    for pid, rec in h.items():
        p = rec.get("prompt") or []
        if len(p) < 3:
            continue
        graph = p[2] if isinstance(p[2], dict) else {}
        types = {v.get("class_type") for v in graph.values() if isinstance(v, dict)}
        if all(f in types for f in FINGERPRINT) and "1062" in graph and "1071" in graph:
            return pid, graph
    return None, None


def md5_view(fname, subfolder="", folder="output"):
    url = f"{BASE}/view?filename={urllib.request.quote(fname)}&subfolder={urllib.request.quote(subfolder)}&type={folder}"
    m = hashlib.md5()
    with urllib.request.urlopen(url, timeout=120) as r:
        while True:
            b = r.read(1 << 16)
            if not b:
                break
            m.update(b)
    return m.hexdigest()


class VramPoller:
    def __init__(self):
        self.peak_free = None
        self.samples = 0
        self.stop = False
        self.t = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop:
            try:
                st = http("/system_stats", timeout=8)
                for dev in st.get("devices", []):
                    free = dev.get("vram_free") or dev.get("VRAMFree")
                    if isinstance(free, (int, float)):
                        self.peak_free = free if self.peak_free is None else min(self.peak_free, free)
                        self.samples += 1
            except Exception:
                pass
            time.sleep(2)

    def start(self):
        self.t.start()

    def finish(self):
        self.stop = True
        self.t.join(timeout=5)
        return self.peak_free


def queue_state():
    try:
        q = http("/queue", timeout=8)
        return [len(q.get("queue_running", [])), len(q.get("queue_pending", []))]
    except Exception:
        return [-1, -1]


def run_arm(tag, graph):
    poller = VramPoller()
    poller.start()
    t0 = time.time()
    qb = queue_state()
    resp = http("/prompt", {"prompt": graph, "client_id": f"lowvram-{tag}"})
    errs = resp.get("node_errors") or {}
    if errs:
        print(f"[{tag}] node_errors: {list(errs)[:6]}")
        return None, None, None, qb, [-1, -1]
    pid = resp["prompt_id"]
    print(f"[{tag}] prompt_id={pid} 已入队 {time.strftime('%H:%M:%S')}")
    while True:
        time.sleep(5)
        h = http(f"/history/{pid}")
        rec = h.get(pid)
        if rec:
            st = rec.get("status", {})
            if st.get("completed") or st.get("status_str") == "success":
                break
            if st.get("status_str") in ("error",):
                print(f"[{tag}] ERROR:", json.dumps(st)[:400])
                return None, None, None, qb, [-1, -1]
        sys.stdout.write(f"[{tag}] …{int(time.time()-t0)}s\r")
    wall = time.time() - t0
    peak_free = poller.finish()
    qa = queue_state()
    outs = {}
    for oid, ovals in (rec.get("outputs") or {}).items():
        for kind in ("images", "gifs", "videos"):
            for item in ovals.get(kind, []) or []:
                fn = item.get("filename")
                if fn:
                    sub = item.get("subfolder", "")
                    outs[f"{sub}/{fn}"] = md5_view(fn, sub)
    print(f"[{tag}] wall={wall:.1f}s vram_free谷={peak_free} queue {qb}->{qa} 产物 {len(outs)} 口")
    for k, v in sorted(outs.items()):
        print(f"    {v}  {k}")
    return wall, peak_free, outs, qb, qa


def main():
    import os
    # 断点续跑:A 臂哈希档在盘(history 会被他链清空/引擎重启丢内存态)→ 只烧 B
    resume = None
    if os.path.exists("/tmp/lowvram_armA_md5.json"):
        resume = json.load(open("/tmp/lowvram_armA_md5.json"))
        print(f"复用 /tmp/lowvram_armA_md5.json({len(resume)} 口,断点续跑)")
    pid0, base_graph = pick_recent_prompt()
    assert base_graph, "history 无三采指纹 prompt"
    assert "1072" not in base_graph and base_graph["3011"]["inputs"].get("chunks") == 1, "基线非旧结构"
    print(f"挂前基线=history {pid0[:8]}(节点 {len(base_graph)})")
    # 挂后:注入 1072 + 改 1071 源 + 3011 chunks=2(输入/种子原样)
    import copy
    g2 = copy.deepcopy(base_graph)
    g2["1072"] = {"class_type": "MiniMaxLowVRAMAttention",
                  "inputs": {"model": ["1062", 0], "head_chunks": 2}}
    g2["1071"]["inputs"]["model"] = ["1072", 0]
    g2["3011"]["inputs"]["chunks"] = 2
    if resume:
        w1, v1, o1, qb1, qa1 = None, None, resume, [-1, -1], [-1, -1]
    else:
        w1, v1, o1, qb1, qa1 = run_arm("A挂前", base_graph)
        if o1:
            json.dump(o1, open("/tmp/lowvram_armA_md5.json", "w"))
    w2, v2, o2, qb2, qa2 = run_arm("B挂后", g2)
    if not (o1 and o2):
        sys.exit(2)
    print("\n== G1 逐位对账 ==")
    ok = True
    for k in sorted(set(o1) & set(o2)):
        same = o1[k] == o2[k]
        ok &= same
        print(f"  {'✓' if same else '✗'} {k}: {o1[k]} vs {o2[k]}")
    print("G1", "PASS(逐位一致)" if ok else "FAIL(有差分→停手找根因)")
    delta = (w2 - w1) / w1 * 100 if w1 else None
    print(f"\n== G2 时长 == A={w1:.1f}s B={w2:.1f}s Δ={delta:+.1f}%" if delta is not None
          else f"\n== G2 时长 == A=复用断点档 B={w2:.1f}s")
    print(f"== G3 显存(vram_free 谷,越小=峰值越高)== A={v1} B={v2}")
    # 结果落盘(workflow 消费真源):apps/output/lowvram-1118/result.json
    os.makedirs(OUT_DIR, exist_ok=True)
    result = {
        "g1_pass": ok,
        "armA": {"wall_s": w1, "vram_free_trough": v1, "md5": o1, "queue_before": qb1, "queue_after": qa1},
        "armB": {"wall_s": w2, "vram_free_trough": v2, "md5": o2, "queue_before": qb2, "queue_after": qa2},
        "duration_delta_pct": delta,
        "base_prompt": pid0,
        "ran_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    json.dump(result, open(os.path.join(OUT_DIR, "result.json"), "w"), ensure_ascii=False, indent=2)
    print(f"result.json -> {os.path.join(OUT_DIR, 'result.json')}")


if __name__ == "__main__":
    main()
