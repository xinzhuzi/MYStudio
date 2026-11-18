#!/usr/bin/env python3
"""1118 h3-lowvram G1-G3 实弹 v2(首轮评审三缺口全堵;world.run 驱动)。

基线自适应双版本:挑 history 最近一支完链(ReCaVSR+1062+3011,新旧结构皆可)——
旧结构(chunks=1 无 1072):A=原样,B=正注入三处;
新结构(chunks=2 有 1072):A=反注入(del 1072/1071←1062/3011→1,评审员复算=83 节点 diff 恰三键),B=原样。
两臂同 seed(全图随机源=4 处字面量 42,注入/反注入不触种子)。
G1:产物按去计数文件名对齐;MD5 等→PASS;不等→ffmpeg framemd5 帧级对账区分「像素一致容器差」。
G2:引擎侧 execution_success.ts−execution_start.ts 毫秒差=主口径(同钟自减,轮询 lag 不入账);轮询 wall=副口径。
G3:vram_free 谷(每臂独立采样窗)。
防呆:指纹消失有界重等(6min)、POST 调度瞬态 2s×3 复认、md5 下载三连试、单臂 20min 帽。
退出码:0=两臂毕(result.json 落 apps/output/lowvram-1118/);2=中止。
"""
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

for k in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(k, None)

BASE = "http://192.168.0.101:17000"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "output", "lowvram-1118")
STASH = "/tmp/lowvram_base_graph_1118.json"
ARM_TIMEOUT_S = 1200


def http(path, payload=None, timeout=30, retries=3):
    last = None
    for _ in range(retries):
        try:
            data = json.dumps(payload).encode() if payload is not None else None
            req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read() or b"{}")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(4)
    raise last


def is_complete_chain(g):
    types = {v.get("class_type") for v in g.values() if isinstance(v, dict)}
    return "ReCaVSRUpscale" in types and "1062" in g and "3011" in g


def pick_recent_prompt():
    """回 (pid, graph, is_new):is_new=挂后结构(1072 在或 chunks=2)。"""
    h = http("/history?max_items=50")
    for pid, rec in h.items():
        p = rec.get("prompt") or []
        if len(p) >= 3 and isinstance(p[2], dict) and is_complete_chain(p[2]):
            g = p[2]
            is_new = "1072" in g or g["3011"].get("inputs", {}).get("chunks") == 2
            return pid, g, is_new
    return None, None, None


def grab_baseline(wait_s=360):
    """指纹消失→有界重等(他链探针间隙清 history 是常态,不崩只等)。"""
    t0 = time.time()
    while time.time() - t0 < wait_s:
        pid, g, is_new = pick_recent_prompt()
        if g:
            json.dump({"pid": pid, "graph": g, "is_new": is_new}, open(STASH, "w"))
            print(f"基线=history {pid[:8]}({'新结构→A=反注入' if is_new else '旧结构→B=正注入'}) 节点 {len(g)}(已落 {STASH})")
            return g, is_new
        print(f"指纹未现,重等 {int(time.time()-t0)}s/{wait_s}s…", flush=True)
        time.sleep(15)
    raise SystemExit(2)


def inject_forward(g):
    """旧→挂后:+1072 +1071 改源 +3011.chunks=2(深拷贝)。"""
    g2 = copy.deepcopy(g)
    g2["1072"] = {"class_type": "MiniMaxLowVRAMAttention",
                  "inputs": {"model": ["1062", 0], "head_chunks": 2}}
    g2["1071"]["inputs"]["model"] = ["1072", 0]
    g2["3011"]["inputs"]["chunks"] = 2
    return g2


def inject_reverse(g):
    """新→挂前:del 1072 +1071←1062 +3011.chunks=1(评审员复算:83 节点,diff 恰 [1071/1072/3011])。"""
    g1 = copy.deepcopy(g)
    g1.pop("1072", None)
    g1["1071"]["inputs"]["model"] = ["1062", 0]
    g1["3011"]["inputs"]["chunks"] = 1
    return g1


class VramPoller:
    def __init__(self):
        self.peak_free = None
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


def engine_delta_ms(rec):
    """G2 主口径:execution_success.ts − execution_start.ts(引擎 Win 同钟,轮询 lag 不入账)。"""
    ts = {}
    for m in rec.get("status", {}).get("messages", []):
        if m[0] in ("execution_start", "execution_success") and len(m) > 1:
            v = m[1] or {}
            if isinstance(v.get("ts"), (int, float)):
                ts[m[0]] = v["ts"]
    if "execution_start" in ts and "execution_success" in ts:
        return ts["execution_success"] - ts["execution_start"]
    return None


def sched_settled(pid, tries=3):
    """缺口③:POST 返回≠已调度——running 空+pending 含我=正常瞬态,2s×3 复认。"""
    for _ in range(tries):
        q = http("/queue", timeout=8)
        run_ids = [str(it[1]) for it in q.get("queue_running", [])]
        pend_ids = [str(it[1]) for it in q.get("queue_pending", [])]
        if pid in run_ids or not pend_ids:
            return True
        if pid in pend_ids and not run_ids:
            time.sleep(2)
            continue
        return True  # 与他链同队=排队,不误判抢前
    return True


def norm_key(sub, fn):
    """去 SaveVideo 自增计数:_00001_ → 归一键(两臂可对齐)。"""
    return f"{sub}/{re.sub(r'_\d+_([^/]*)$', r'_\1', fn)}"


def fetch_output(sub, fn, dst):
    url = f"{BASE}/view?filename={urllib.parse.quote(fn)}&subfolder={urllib.parse.quote(sub)}&type=output"
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=180) as r, open(dst, "wb") as f:
                while True:
                    b = r.read(1 << 16)
                    if not b:
                        break
                    f.write(b)
            return hashlib.md5(open(dst, "rb").read()).hexdigest()
        except Exception:
            time.sleep(4)
    raise RuntimeError(f"download fail {sub}/{fn}")


def framemd5(path):
    """容器差预案:解码帧哈希(像素级真源)。"""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-f", "framemd5", "-"],
                       capture_output=True, timeout=600)
    return hashlib.md5(r.stdout).hexdigest() if r.returncode == 0 else None


def run_arm(tag, graph):
    poller = VramPoller()
    poller.start()
    t0 = time.time()
    qb = queue_state()
    resp = http("/prompt", {"prompt": graph, "client_id": f"lowvram-{tag}"})
    errs = resp.get("node_errors") or {}
    if errs:
        print(f"[{tag}] node_errors: {list(errs)[:6]}")
        return None
    pid = resp["prompt_id"]
    sched_settled(pid)
    print(f"[{tag}] prompt_id={pid} 入队 {time.strftime('%H:%M:%S')}")
    rec = None
    while time.time() - t0 < ARM_TIMEOUT_S:
        time.sleep(5)
        h = http(f"/history/{pid}")
        rec = h.get(pid)
        if rec:
            st = rec.get("status", {})
            if st.get("completed") or st.get("status_str") == "success":
                break
            if st.get("status_str") == "error":
                print(f"[{tag}] ERROR:", json.dumps(st)[:400])
                return None
        print(f"[{tag}] …{int(time.time()-t0)}s", flush=True)
    else:
        print(f"[{tag}] 单臂 {ARM_TIMEOUT_S}s 超时帽")
        return None
    wall = time.time() - t0
    peak_free = poller.finish()
    qa = queue_state()
    edelta = engine_delta_ms(rec)
    outs = {}
    for oid, ovals in (rec.get("outputs") or {}).items():
        for kind in ("images", "gifs", "videos"):
            for item in (ovals.get(kind, []) or []):
                fn = item.get("filename")
                if fn:
                    sub = item.get("subfolder", "")
                    dst = f"/tmp/lowvram_{tag}_{fn}"
                    md5 = fetch_output(sub, fn, dst)
                    outs[norm_key(sub, fn)] = {"md5": md5, "file": dst, "raw": f"{sub}/{fn}"}
    print(f"[{tag}] wall={wall:.1f}s 引擎侧={edelta}ms vram谷={peak_free} queue {qb}->{qa} 产物 {len(outs)} 口")
    return {"wall_s": wall, "engine_ms": edelta, "vram": peak_free, "qb": qb, "qa": qa, "outs": outs}


def compare_g1(a, b):
    keys = sorted(set(a) & set(b))
    if not keys:
        return False, "产物归一键交集为空(零比较=不得判 PASS)", []
    rows, ok, pixel_ok = [], True, True
    for k in keys:
        x, y = a[k], b[k]
        if x["md5"] == y["md5"]:
            rows.append(f"  = {k}: md5 逐字节等")
            continue
        fx, fy = framemd5(x["file"]), framemd5(y["file"])
        if fx and fy and fx == fy:
            rows.append(f"  ≈ {k}: md5 异但帧哈希等(像素一致,容器字节差)")
        else:
            ok = False
            pixel_ok = False
            rows.append(f"  ✗ {k}: 像素级差分(md5 {x['md5'][:8]} vs {y['md5'][:8]},帧哈希 {fx and fx[:8]} vs {fy and fy[:8]})")
    return ok, ("像素级逐位一致" if pixel_ok else "存在真差分"), rows


def main():
    g, is_new = grab_baseline()
    ga, gb = (inject_reverse(g), g) if is_new else (g, inject_forward(g))
    ra = run_arm("A挂前", ga)
    if not ra:
        sys.exit(2)
    rb = run_arm("B挂后", gb)
    if not rb:
        sys.exit(2)
    ok, verdict, rows = compare_g1(ra["outs"], rb["outs"])
    print("\n== G1 逐位对账 ==")
    print("\n".join(rows))
    print("G1", "PASS(" + verdict + ")" if ok else "FAIL(" + verdict + "→停手找根因)")
    d_poll = (rb["wall_s"] - ra["wall_s"]) / ra["wall_s"] * 100
    d_eng = ((rb["engine_ms"] - ra["engine_ms"]) / ra["engine_ms"] * 100
             if ra["engine_ms"] and rb["engine_ms"] else None)
    print(f"== G2 时长 == 主口径(引擎侧): A={ra['engine_ms']}ms B={rb['engine_ms']}ms Δ={d_eng if d_eng is None else round(d_eng,2)}% ;副口径(轮询): A={ra['wall_s']:.1f}s B={rb['wall_s']:.1f}s Δ={d_poll:+.1f}%")
    print(f"== G3 显存(vram_free 谷)== A={ra['vram']} B={rb['vram']}")
    os.makedirs(OUT_DIR, exist_ok=True)
    result = {
        "g1_pass": ok, "g1_verdict": verdict, "g1_rows": rows,
        "armA": {"wall_s": ra["wall_s"], "engine_ms": ra["engine_ms"], "vram_free_trough": ra["vram"],
                 "queue": [ra["qb"], ra["qa"]], "outputs": {k: v["md5"] for k, v in ra["outs"].items()}},
        "armB": {"wall_s": rb["wall_s"], "engine_ms": rb["engine_ms"], "vram_free_trough": rb["vram"],
                 "queue": [rb["qb"], rb["qa"]], "outputs": {k: v["md5"] for k, v in rb["outs"].items()}},
        "duration_delta_poll_pct": round(d_poll, 2),
        "duration_delta_engine_pct": None if d_eng is None else round(d_eng, 2),
        "baseline": {"is_new_structure": is_new, "stash": STASH},
        "ran_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    json.dump(result, open(os.path.join(OUT_DIR, "result.json"), "w"), ensure_ascii=False, indent=2)
    print(f"result.json -> {os.path.join(OUT_DIR, 'result.json')}")


if __name__ == "__main__":
    main()
