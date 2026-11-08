#!/usr/bin/env python3
"""道劫 t2i 全加速车道同题对比·补齐三轮(1108)

已有同句同seed成绩(他轮产物):E臂40步(e40_00130)/Pruna普通+mikkoani(mk_6v02_00128)/
Pruna upsampled+mikkoani(mk_6v02up_00129)。本脚本补齐剩余三档:
  viggle 9步混动(v0.3 r256,7+2)/ Turbo 8步(官方avg_rank_178,官方σ表)/ 原生40步cfg1(Fix挂件)
口径=qi21_pruna_mikkoani_retest_1108.py 同款:画布内存只改档位(不动臂/不动主体句
[400]=§1终版例句)、seed 恒 7014、mps 修复、node_errors 必查、双产物(直出+2K)。

用法: python3 qi21_accel_lanes_compare_1108.py
产物: ~/Downloads/1108-pruna-poster/(lane_ 前缀)
"""

import json
import pathlib
import struct
import sys
import time
import urllib.parse
import urllib.request
import uuid

REPO = pathlib.Path(__file__).resolve().parents[3]
SCRIPTS = REPO / "apps/build/scripts"
sys.path.insert(0, str(SCRIPTS))
import qwen21_bridge_template_build as builder  # noqa: E402

ENGINE = "http://192.168.0.101:17000"
CANVAS = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
SNAPSHOT = pathlib.Path("/tmp/objinfo.json")
OUT_DIR = pathlib.Path.home() / "Downloads/1108-pruna-poster"
SEED = 7014
POLL_DEADLINE_S = 20 * 60
HISTORY_TIMEOUT_S = 120
TYPE_POSTER = "人物海报"
ROUNDS = [
    ("lane_viggle9", "2 · viggle"),
    ("lane_turbo8", "0 · Turbo 8步"),
    ("lane_native40", "1 · 原生出图"),
]


def build_graph(mode: str) -> tuple[dict, dict]:
    wf = json.loads(CANVAS.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    host7 = root[7]
    host7.setdefault("widgets_values_named", {})["速度档位"] = mode
    host7["widgets_values"][0] = mode
    assert root[6]["widgets_values_named"]["型选择"] == TYPE_POSTER
    info = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    graph, meta = builder.build_graph(workflow=wf, info=info, force_upscale=True)
    assert meta["型"] == TYPE_POSTER and meta["档"] == mode, meta
    graph["7:7014"]["inputs"]["value"] = SEED
    for loader in ("503:501", "503:502"):
        if graph.get(loader, {}).get("inputs", {}).get("device") == "mps":
            graph[loader]["inputs"]["device"] = "cuda:0"
    builder.check_object_info(graph, info)
    # 自证:Pruna ⑦臂不进图(悬空被剪),选中臂在图
    assert "7:7110" not in graph and "7:7112" not in graph, "车道轮不应带 Pruna 臂"
    expect = {"2 · viggle": ("7:7011", "7:7012"),
              "0 · Turbo 8步": ("7:7028", "7:7031"),
              "1 · 原生出图": ("7:7010",)}[mode]
    for k in expect:
        assert k in graph, f"{mode} 缺臂件 {k}"
    print(f"[build] 档={mode} nodes={len(graph)} 臂件={expect}")
    return graph, meta


def http_json(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def engine_wall_s(entry):
    ts = {}
    for ev, data in entry.get("status", {}).get("messages", []):
        if ev in ("execution_start", "execution_success") and isinstance(data, dict) \
                and "timestamp" in data:
            ts.setdefault(ev, data["timestamp"])
    if {"execution_start", "execution_success"} <= ts.keys():
        return round((ts["execution_success"] - ts["execution_start"]) / 1000, 1)
    return None


def png_dims(path):
    b = path.read_bytes()
    return struct.unpack(">II", b[16:24])


def run_round(short, mode, client_id):
    graph, _ = build_graph(mode)
    t0 = time.time()
    resp = http_json(f"{ENGINE}/prompt", {"prompt": graph, "client_id": client_id})
    if resp.get("node_errors"):
        print(f"[{short}] ⚠️ node_errors: {json.dumps(resp['node_errors'], ensure_ascii=False)[:400]}")
    pid = resp["prompt_id"]
    print(f"[{short}] submitted prompt_id={pid}")
    last_beat = 0.0
    while time.time() - t0 < POLL_DEADLINE_S:
        time.sleep(3)
        try:
            hist = http_json(f"{ENGINE}/history/{pid}", timeout=HISTORY_TIMEOUT_S)
        except Exception as e:  # noqa: BLE001
            print(f"[{short}] history retry: {type(e).__name__}: {e}")
            continue
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                msgs = [json.dumps(m[1], ensure_ascii=False)[:600]
                        for m in status.get("messages", []) if m[0] == "execution_error"]
                print(f"[{short}] ERROR: {msgs}")
                return {"short": short, "ok": False, "wall_s": time.time() - t0,
                        "engine_wall_s": None, "files": [], "dims": [], "error": str(msgs)}
            if status.get("completed"):
                wall = time.time() - t0
                ewall = engine_wall_s(entry)
                results = []
                for nid, outs in entry.get("outputs", {}).items():
                    if nid not in ("8", "504"):
                        continue
                    for im in outs.get("images", []):
                        q = urllib.parse.urlencode({
                            "filename": im["filename"], "subfolder": im.get("subfolder", ""),
                            "type": im.get("type", "output")})
                        tag = "2k" if nid == "504" else "direct"
                        dst = OUT_DIR / f"pruna_{short}_s{SEED}_{tag}_{im['filename']}"
                        with urllib.request.urlopen(f"{ENGINE}/view?{q}", timeout=180) as r:
                            dst.write_bytes(r.read())
                        results.append((dst, *png_dims(dst)))
                print(f"[{short}] DONE wall={wall:.1f}s engine_wall={ewall}s")
                for dst, w, h in results:
                    print(f"  → {dst} ({w}x{h})")
                return {"short": short, "ok": len(results) == 2, "wall_s": wall,
                        "engine_wall_s": ewall, "files": [str(p) for p, _, _ in results],
                        "dims": [f"{w}x{h}" for _, w, h in results], "error": ""}
        if time.time() - last_beat > 30:
            try:
                q = http_json(f"{ENGINE}/queue")
                print(f"[{short}] waiting… t+{time.time()-t0:.0f}s "
                      f"queue(run={len(q.get('queue_running', []))},"
                      f"pend={len(q.get('queue_pending', []))})")
            except Exception as e:  # noqa: BLE001
                print(f"[{short}] queue beat failed: {e}")
            last_beat = time.time()
    print(f"[{short}] TIMEOUT")
    return {"short": short, "ok": False, "wall_s": POLL_DEADLINE_S, "engine_wall_s": None,
            "files": [], "dims": [], "error": "timeout"}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client_id = f"lanes-cmp-{uuid.uuid4().hex[:8]}"
    # 后台沙箱出不了局域网(1106 刻碑)——支持单车道前台跑:argv[1]=短名过滤
    only = sys.argv[1] if len(sys.argv) > 1 else None
    rounds = [r for r in ROUNDS if r[0] == only] if only else ROUNDS
    print(f"engine={ENGINE} seed={SEED} 型={TYPE_POSTER} 句=画布[400]§1终版例句\n")
    results = [run_round(s, m, client_id) for s, m in rounds]
    print("\n===== SUMMARY =====")
    for r in results:
        print(f"{r['short']}: ok={r['ok']} client_wall={r['wall_s']:.1f}s "
              f"engine_wall={r.get('engine_wall_s')}s dims={r['dims']} err={r['error'] or '(空)'}")
    sys.exit(0 if all(r["ok"] for r in results) else 1)


if __name__ == "__main__":
    main()
