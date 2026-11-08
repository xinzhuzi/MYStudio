#!/usr/bin/env python3
"""PrunaAI 6步 LoRA 两件对比——道劫产线 t2i「人物海报」实弹测试(1108)

问题:PrunaAI 出的两件 Qwen-Image-2.1 6步 LoRA(原版 / upsampled)挂上道劫
产线 t2i 链「人物海报」出图,表现如何?

产线真源复用:qwen21_bridge_template_build.py 的画布展平+选中臂物质化逻辑
(与 App 生图桥同一条 builder 管线)。对画布 qi21-道劫-t2i.json 只在内存改
(不落盘,画布文件保持 git 干净),四处:
  ① 宿主[6] 型选择=「人物海报」画布现值,勿动(三层装配=主体句400+型文+美术
     风格底座自动,prompt/negative 均不注入)
  ② 宿主[7] 速度档位 → "2 · viggle"(合法档当载波,named+positional 双写)
  ③ 加速子图 select(7015) latent_viggle 输入链 origin 7024 → 7112
     (PrunaAI 臂:7110 LoRA ×7111 引导 ×7113 六步σ ×7112 采样)
  ④ 内嵌子图 7110 lora_name(两轮各一件,值=引擎 loras 目录实名)
seed 恒 7014(注 7:7014)。503:501/503:502 device mps→cuda:0(1101 刻碑
「必剪mps超分腿」同源);提交后必查响应体 node_errors(非空=支路被剔)。

用法: python3 qi21_pruna_type1_poster_test_1108.py
产物: ~/Downloads/1108-pruna-poster/ + 工作区 out/pruna1108/(同名副本)
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
WS_DIR = REPO / "out/pruna1108"
SEED = 7014
POLL_DEADLINE_S = 20 * 60   # 单发最长等 20 分钟(引擎可能被并行任务占用)
HISTORY_TIMEOUT_S = 120     # /history 单次超时 120s,异常捕获后重试

TYPE_POSTER = "人物海报"       # 画布现值,勿动
SPEED_VIGGLE = "2 · viggle"   # 合法档当载波
ACCEL_SG_ID = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"  # 道劫·加速子图
ROUNDS = [
    ("6v02", "p_q_image_2.1_6_steps_v0.2.safetensors"),
    ("6v02up", "p_q_image_2.1_6_steps_upsampled_v0.2.safetensors"),
]


def build_graph(lora_name: str) -> tuple[dict, dict]:
    # 画布只在内存改,不落盘
    wf = json.loads(CANVAS.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}

    # ② 档="2 · viggle"(named+positional 双写,flatten 双路可读);① 型=人物海报不动
    host7 = root[7]
    host7.setdefault("widgets_values_named", {})["速度档位"] = SPEED_VIGGLE
    host7["widgets_values"][0] = SPEED_VIGGLE
    assert root[6]["widgets_values_named"]["型选择"] == TYPE_POSTER  # 画布现值自证

    # ③ 加速子图:7015.latent_viggle 输入链 origin 7024 → 7112(PrunaAI 臂)
    sg = next(s for s in wf["definitions"]["subgraphs"] if s["id"] == ACCEL_SG_ID)
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    sel = sg_nodes[7015]
    link_id = next(e["link"] for e in sel["inputs"] if e["name"] == "latent_viggle")
    link = next(l for l in sg["links"] if l["id"] == link_id)
    assert link["origin_id"] == 7024 and link["target_id"] == 7015, link
    link["origin_id"] = 7112
    # 同步两侧 outputs[].links(builder 只读 links 表,此处保持画布对象自洽)
    out7024, out7112 = sg_nodes[7024]["outputs"][0], sg_nodes[7112]["outputs"][0]
    out7024["links"] = [i for i in (out7024.get("links") or []) if i != link_id]
    out7112.setdefault("links", [])
    if link_id not in out7112["links"]:
        out7112["links"].append(link_id)

    # ④ 7110 lora_name(named+positional 双写;值=引擎 loras 目录实名)
    lora_node = sg_nodes[7110]
    lora_node["widgets_values"][0] = lora_name
    lora_node.setdefault("widgets_values_named", {})["lora_name"] = lora_name

    info = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    graph, meta = builder.build_graph(workflow=wf, info=info, force_upscale=True)
    assert meta["型"] == TYPE_POSTER and meta["档"] == SPEED_VIGGLE, meta
    # seed 恒 7014(注 7:7014);主体句/negative 用画布现值不注入
    graph["7:7014"]["inputs"]["value"] = SEED
    # mps 超分腿坑:画布 Mac 存值 device='mps',Win 引擎 SeedVR2 只认 'cuda:0'
    for loader in ("503:501", "503:502"):
        if graph.get(loader, {}).get("inputs", {}).get("device") == "mps":
            graph[loader]["inputs"]["device"] = "cuda:0"
    builder.check_object_info(graph, info)
    # 自证:Pruna 臂入模、旧 viggle 臂被剪、选择器 latent_viggle 指向 7112
    assert graph["7:7110"]["inputs"]["lora_name"] == lora_name, graph["7:7110"]["inputs"]
    assert graph["7:7015"]["inputs"]["latent_viggle"] == ["7:7112", 0], graph["7:7015"]["inputs"]
    assert "7:7024" not in graph and "7:7011" not in graph, \
        sorted(k for k in graph if k.startswith("7:70"))
    arms = sorted(k for k, n in graph.items()
                  if n["class_type"] in ("ViggleTurboLora", "ViggleTurboSigmas"))
    print(f"[build] 型={meta['型']} 档={meta['档']} nodes={len(graph)}")
    print(f"[build] Pruna 臂 7110={lora_name} | turbo/sigma 臂件={arms}")
    return graph, meta


def http_json(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def fetch_history(pid: str):
    """单次超时 120s;引擎被并行任务占用时可能卡/抖,异常捕获后由调用方重试。"""
    try:
        return http_json(f"{ENGINE}/history/{pid}", timeout=HISTORY_TIMEOUT_S), None
    except Exception as e:  # noqa: BLE001 —— 如实记录,轮询继续
        return None, f"{type(e).__name__}: {e}"


def engine_wall_s(entry: dict) -> float | None:
    """engine 侧 execution_start→success 消息时间戳差值(秒)。"""
    ts: dict[str, int] = {}
    for ev, data in entry.get("status", {}).get("messages", []):
        if ev in ("execution_start", "execution_success") and isinstance(data, dict) \
                and "timestamp" in data:
            ts.setdefault(ev, data["timestamp"])
    if {"execution_start", "execution_success"} <= ts.keys():
        return round((ts["execution_success"] - ts["execution_start"]) / 1000, 1)
    return None


def png_dims(path: pathlib.Path):
    b = path.read_bytes()
    return struct.unpack(">II", b[16:24])


def run_round(short: str, lora_name: str, client_id: str):
    graph, _ = build_graph(lora_name)
    t0 = time.time()
    resp = http_json(f"{ENGINE}/prompt", {"prompt": graph, "client_id": client_id})
    node_errors = resp.get("node_errors") or {}
    if node_errors:
        print(f"[{short}] ⚠️ node_errors(支路被剔): "
              f"{json.dumps(node_errors, ensure_ascii=False)[:400]}")
    pid = resp["prompt_id"]
    print(f"[{short}] submitted prompt_id={pid}")
    last_beat = 0.0
    err_count = 0
    while time.time() - t0 < POLL_DEADLINE_S:
        time.sleep(3)
        hist, err = fetch_history(pid)
        if err is not None:
            err_count += 1
            print(f"[{short}] history retry#{err_count}: {err}")
            continue
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                msgs = [json.dumps(m[1], ensure_ascii=False)[:600]
                        for m in status.get("messages", []) if m[0] == "execution_error"]
                print(f"[{short}] ERROR: {msgs}")
                return {"short": short, "lora": lora_name, "ok": False,
                        "wall_s": time.time() - t0, "files": [], "dims": [],
                        "error": (f"execution_error: {msgs}" if msgs
                                  else f"status error: {json.dumps(status)[:400]}")}
            if status.get("completed"):
                wall = time.time() - t0
                ewall = engine_wall_s(entry)
                results = []
                for nid, outs in entry.get("outputs", {}).items():
                    if nid not in ("8", "504"):  # 只要直出(8)与 2K(504)
                        continue
                    for im in outs.get("images", []):
                        q = urllib.parse.urlencode({
                            "filename": im["filename"], "subfolder": im.get("subfolder", ""),
                            "type": im.get("type", "output")})
                        tag = "2k" if nid == "504" else "direct"
                        dst = OUT_DIR / f"pruna_{short}_s{SEED}_{tag}_{im['filename']}"
                        with urllib.request.urlopen(f"{ENGINE}/view?{q}", timeout=180) as r:
                            dst.write_bytes(r.read())
                        shutil.copyfile(dst, WS_DIR / dst.name)
                        results.append((dst, *png_dims(dst)))
                print(f"[{short}] DONE wall={wall:.1f}s engine_wall={ewall}s "
                      f"history_retries={err_count}")
                for dst, w, h in results:
                    print(f"  → {dst} ({w}x{h})")
                return {"short": short, "lora": lora_name,
                        "ok": len(results) == 2,
                        "wall_s": wall, "engine_wall_s": ewall,
                        "files": [str(p) for p, _, _ in results],
                        "dims": [f"{w}x{h}" for _, w, h in results],
                        "error": json.dumps(node_errors, ensure_ascii=False)[:500]
                                 if node_errors else ""}
        if time.time() - last_beat > 30:
            try:
                q = http_json(f"{ENGINE}/queue")
                print(f"[{short}] waiting… t+{time.time()-t0:.0f}s "
                      f"queue(run={len(q.get('queue_running', []))},"
                      f"pend={len(q.get('queue_pending', []))})")
            except Exception as e:  # noqa: BLE001
                print(f"[{short}] queue beat failed: {type(e).__name__}: {e}")
            last_beat = time.time()
    print(f"[{short}] TIMEOUT after {POLL_DEADLINE_S}s")
    return {"short": short, "lora": lora_name, "ok": False,
            "wall_s": time.time() - t0, "files": [], "dims": [],
            "error": f"timeout after {POLL_DEADLINE_S}s (history_retries={err_count})"}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WS_DIR.mkdir(parents=True, exist_ok=True)
    client_id = f"pruna-poster-{uuid.uuid4().hex[:8]}"
    print(f"engine={ENGINE} client={client_id}")
    print(f"rounds: {[(s, l) for s, l in ROUNDS]} seed={SEED} 型={TYPE_POSTER}(画布现值)\n")
    results = [run_round(short, lora, client_id) for short, lora in ROUNDS]
    print("\n===== SUMMARY =====")
    for r in results:
        print(f"{r['short']} ({r['lora']}): ok={r['ok']} client_wall={r['wall_s']:.1f}s "
              f"engine_wall={r.get('engine_wall_s')}s "
              f"files={list(zip(r['files'], r['dims']))} error={r['error'] or '(空)'}")
    sys.exit(0 if all(r["ok"] for r in results) else 1)


if __name__ == "__main__":
    main()
