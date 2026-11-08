#!/usr/bin/env python3
"""PrunaAI 6步×mikkoani@0.6 补挂重测+E臂同链基线(1108 追问轮)

用户三问:①手还是有问题,有没有好办法?②速度如何?③为啥没挂产线恒用的动漫
挂件(mikkoani@0.6)?——首轮⑦臂按 PrunaAI「drop-in 替换底模」原设计接了裸底模,
本轮补挂产线标准风格栈(7110.model ← 7034=底模+mikkoani@0.6,与 viggle/E 臂同款)
重跑两件,并加一轮 E臂 40步(产线默认档)同链基线,给速度一个公平对照。

三处口径沿 qi21_pruna_type1_poster_test_1108.py(画布内存手术不落盘/viggle 档
载波载 Pruna 臂/mps 修复/node_errors 必查/seed 恒 7014)。

用法: python3 qi21_pruna_mikkoani_retest_1108.py
产物: ~/Downloads/1108-pruna-poster/(mk_ 前缀=补挂轮, e40_ 前缀=基线轮)
"""

import json
import pathlib
import shutil
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
SPEED_VIGGLE = "2 · viggle"          # Pruna 轮载波
SPEED_E = "3 · 混动 40步+缓存"        # 基线轮=产线默认档
ACCEL_SG_ID = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"
ROUNDS = [
    # (短名, lora 或 None=E基线, mikkoani 补挂)
    ("mk_6v02", "p_q_image_2.1_6_steps_v0.2.safetensors", True),
    ("mk_6v02up", "p_q_image_2.1_6_steps_upsampled_v0.2.safetensors", True),
    ("e40", None, False),
]


def build_graph(lora_name, with_mikkoani: bool) -> tuple[dict, dict]:
    wf = json.loads(CANVAS.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    is_pruna = lora_name is not None
    mode = SPEED_VIGGLE if is_pruna else SPEED_E
    host7 = root[7]
    host7.setdefault("widgets_values_named", {})["速度档位"] = mode
    host7["widgets_values"][0] = mode
    assert root[6]["widgets_values_named"]["型选择"] == TYPE_POSTER

    sg = next(s for s in wf["definitions"]["subgraphs"] if s["id"] == ACCEL_SG_ID)
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    if is_pruna:
        # 载波换线:select.latent_viggle ← 7112(Pruna 臂)
        sel = sg_nodes[7015]
        link_id = next(e["link"] for e in sel["inputs"] if e["name"] == "latent_viggle")
        link = next(l for l in sg["links"] if l["id"] == link_id)
        link["origin_id"] = 7112
        out7024, out7112 = sg_nodes[7024]["outputs"][0], sg_nodes[7112]["outputs"][0]
        out7024["links"] = [i for i in (out7024.get("links") or []) if i != link_id]
        out7112.setdefault("links", [])
        if link_id not in out7112["links"]:
            out7112["links"].append(link_id)
        # 7110 lora 件
        lora_node = sg_nodes[7110]
        lora_node["widgets_values"][0] = lora_name
        lora_node.setdefault("widgets_values_named", {})["lora_name"] = lora_name
        if with_mikkoani:
            # 补挂产线风格栈:7110.model ← 7034(底模+mikkoani@0.6)
            m = next(e["link"] for e in sg_nodes[7110]["inputs"] if e["name"] == "model")
            mlink = next(l for l in sg["links"] if l["id"] == m)
            assert mlink["origin_id"] == -10 and mlink["target_id"] == 7110, mlink
            mlink["origin_id"], mlink["origin_slot"] = 7034, 0
            out7034 = sg_nodes[7034]["outputs"][0]
            out7034.setdefault("links", [])
            if m not in out7034["links"]:
                out7034["links"].append(m)

    info = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    graph, meta = builder.build_graph(workflow=wf, info=info, force_upscale=True)
    assert meta["型"] == TYPE_POSTER and meta["档"] == mode, meta
    graph["7:7014"]["inputs"]["value"] = SEED
    for loader in ("503:501", "503:502"):
        if graph.get(loader, {}).get("inputs", {}).get("device") == "mps":
            graph[loader]["inputs"]["device"] = "cuda:0"
    builder.check_object_info(graph, info)
    # 自证
    if is_pruna:
        assert graph["7:7110"]["inputs"]["lora_name"] == lora_name
        src = graph["7:7110"]["inputs"]["model"]
        assert src == (["7:7034", 0] if with_mikkoani else ["1", 0]), src
        assert "7:7024" not in graph and "7:7011" not in graph
    else:
        assert "7:7110" not in graph and "7:7112" not in graph, "E 基线不应带 Pruna 臂"
        assert "7:7045" in graph, "E 基线缺 40步 KSampler(7:7045)"
    mk = "on" if with_mikkoani else ("-" if is_pruna else "inherent")
    print(f"[build] 档={mode} mikkoani={mk} nodes={len(graph)}")
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


def run_round(short, lora_name, with_mikkoani, client_id):
    graph, _ = build_graph(lora_name, with_mikkoani)
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
                        "engine_wall_s": None, "files": [], "dims": [],
                        "error": f"execution_error: {msgs}"}
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
    client_id = f"pruna-mk-{uuid.uuid4().hex[:8]}"
    print(f"engine={ENGINE} seed={SEED} 型={TYPE_POSTER}\n")
    results = [run_round(s, l, mk, client_id) for s, l, mk in ROUNDS]
    print("\n===== SUMMARY =====")
    for r in results:
        print(f"{r['short']}: ok={r['ok']} client_wall={r['wall_s']:.1f}s "
              f"engine_wall={r.get('engine_wall_s')}s dims={r['dims']} err={r['error'] or '(空)'}")
    sys.exit(0 if all(r["ok"] for r in results) else 1)


if __name__ == "__main__":
    main()
