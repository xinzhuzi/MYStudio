#!/usr/bin/env python3
"""14型(自由)×「2 · viggle」档 实弹测试(1108)

问题:上一轮官方工具流验证了 Viggle Turbo v0.3 六步 LoRA;那道劫产线 14型(自由)
出图走 viggle 加速臂表现如何?

产线真源复用:qwen21_bridge_template_build.py 的画布展平+选中臂物质化逻辑
(与 App 生图桥同一条 builder 管线),对画布 自研件-qi21-道劫-t2i.json 仅覆写两个保存值:
  型选择: 人物海报 → 自由(14型,装配=只拼操作与保留项)
  速度档位: 3 · 混动 40步+缓存 → 2 · viggle(加速子图 viggle 臂=v0.3 r256 LoRA
            ×1.0 + σ表9值 + SplitSigmas[7] 前段7步/底模后段2步混动)
其余(底模 bf16+heretic TE+texture_fix VAE、AI扩写关、洗底、SeedVR2 2K 超分腿)
全部保持画布/产线现值。注入点=桥模板同款:prompt→400 / seed→7:7014。

用法: python3 qi21_type14_viggle_t2i_test_1108.py
产物: ~/Downloads/1108-viggle-turbo-poster/(type14_ 前缀)
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
CANVAS = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/自研件-qi21-道劫-t2i.json"
SNAPSHOT = pathlib.Path("/tmp/objinfo.json")
OUT_DIR = pathlib.Path.home() / "Downloads/1108-viggle-turbo-poster"
SEEDS = [7014, 90114]
POLL_TIMEOUT_S = 20 * 60

TYPE_14 = "自由"
SPEED_VIGGLE = "2 · viggle"
# 自由型主体句=操作句直落(装配只拼操作与保留项);主题与上一轮海报对齐便于横向比较
PROMPT_14 = (
    "仙侠电影人物海报:年轻女剑客眉目沉静,墨玉色瞳仁,乌黑长发半束只簪一支素银簪,"
    "墨色广袖道袍束月白腰带,足蹬青布道履,黄昏立于赭石悬崖边缘,朱红花瓣纷飞,"
    "旧金色轮廓逆光,青灰云层与青绿远山,低角度全身构图,"
    "画面右侧竖排书法大字「道劫」,暗青与绯红电影海报配色"
)


def build_graph(seed: int) -> tuple[dict, dict]:
    wf = json.loads(CANVAS.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    # 覆写①:型=自由(14型) ②:档=2·viggle(named+positional 双写,flatten 双路可读)
    for nid, named_key, pos_idx, value in (
        (6, "型选择", 0, TYPE_14),
        (7, "速度档位", 0, SPEED_VIGGLE),
    ):
        node = root[nid]
        node.setdefault("widgets_values_named", {})[named_key] = value
        node["widgets_values"][pos_idx] = value
    info = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    graph, meta = builder.build_graph(workflow=wf, info=info, force_upscale=True)
    assert meta["型"] == TYPE_14 and meta["档"] == SPEED_VIGGLE, meta
    # 桥模板同款注入点
    graph["400"]["inputs"]["value"] = PROMPT_14
    graph["7:7014"]["inputs"]["value"] = seed
    # mps 超分腿坑(1101 刻碑「必剪mps超分腿」同源):画布 Mac 存值 device='mps',
    # Win 引擎 SeedVR2 两加载器只认 'cuda:0'——软验证静默剔 504 支路(node_errors
    # 藏在 200 响应体里,只取 prompt_id 会漏看)。钉 cuda:0 恢复产线双产物。
    for loader in ("503:501", "503:502"):
        if graph.get(loader, {}).get("inputs", {}).get("device") == "mps":
            graph[loader]["inputs"]["device"] = "cuda:0"
    builder.check_object_info(graph, info)
    arms = sorted(k for k, n in graph.items() if n["class_type"] in
                  ("ViggleTurboLora", "ViggleTurboSigmas", "SplitSigmas"))
    classes = sorted({n["class_type"] for n in graph.values()})
    print(f"[build] 型={meta['型']} 档={meta['档']} nodes={len(graph)}")
    print(f"[build] viggle 臂件: {arms}")
    print(f"[build] 无E臂件: {not any(c in ('LazyCache',) for c in classes)}; "
          f"SeedVR2 腿: {any('SeedVR2' in c or 'seedvr' in c.lower() for c in classes)}")
    return graph, meta


def http_json(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def png_dims(path: pathlib.Path):
    b = path.read_bytes()
    return struct.unpack(">II", b[16:24])


def run_seed(seed: int, client_id: str):
    graph, _ = build_graph(seed)
    t0 = time.time()
    resp = http_json(f"{ENGINE}/prompt", {"prompt": graph, "client_id": client_id})
    if resp.get("node_errors"):
        print(f"[seed {seed}] ⚠️ node_errors(支路被剔): "
              f"{json.dumps(resp['node_errors'], ensure_ascii=False)[:400]}")
    pid = resp["prompt_id"]
    print(f"[seed {seed}] submitted prompt_id={pid}")
    last_beat = 0.0
    while time.time() - t0 < POLL_TIMEOUT_S:
        time.sleep(3)
        hist = http_json(f"{ENGINE}/history/{pid}")
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print(f"[seed {seed}] ERROR:")
                for m in status.get("messages", []):
                    if m[0] == "execution_error":
                        print("  ", json.dumps(m[1], ensure_ascii=False)[:600])
                return None
            if status.get("completed"):
                wall = time.time() - t0
                results = []
                for nid, outs in entry.get("outputs", {}).items():
                    for im in outs.get("images", []):
                        q = urllib.parse.urlencode({
                            "filename": im["filename"], "subfolder": im.get("subfolder", ""),
                            "type": im.get("type", "output")})
                        tag = "2k" if nid.endswith("504") else "direct"
                        dst = OUT_DIR / f"type14_s{seed}_{tag}_{im['filename']}"
                        with urllib.request.urlopen(f"{ENGINE}/view?{q}", timeout=180) as r:
                            dst.write_bytes(r.read())
                        results.append((dst, *png_dims(dst)))
                print(f"[seed {seed}] DONE wall={wall:.1f}s")
                for dst, w, h in results:
                    print(f"  → {dst} ({w}x{h})")
                return {"seed": seed, "wall_s": wall, "files": results}
        if time.time() - last_beat > 30:
            q = http_json(f"{ENGINE}/queue")
            print(f"[seed {seed}] waiting… t+{time.time()-t0:.0f}s "
                  f"queue(run={len(q.get('queue_running', []))},pend={len(q.get('queue_pending', []))})")
            last_beat = time.time()
    print(f"[seed {seed}] TIMEOUT")
    return None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client_id = f"type14-viggle-{uuid.uuid4().hex[:8]}"
    print(f"engine={ENGINE} client={client_id}")
    print(f"prompt: {PROMPT_14[:80]}…\n")
    results = [run_seed(s, client_id) for s in SEEDS]
    print("\n===== SUMMARY =====")
    for r in results:
        if r:
            print(f"seed {r['seed']}: {r['wall_s']:.1f}s → {[(p.name, f'{w}x{h}') for p, w, h in r['files']]}")
        else:
            print("FAILED run omitted")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
