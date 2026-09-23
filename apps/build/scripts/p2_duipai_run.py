#!/usr/bin/env python
"""P2 同题对拍实验运行器(Trellis 09-15-teman-absorption)。

对拍设计(design.md P2 节):
  p2a          宫格一次出图(A) vs 同题九镜单镜独立出图(B), ≥2 seed 面
  p2b-assets   三视图一张(A) vs 单人参考图各一张(B), ≥2 seed 面
  p2b-downstream 两种参考各跑同一组镜头(图生图, krea2_edit_ref 形态)

纪律:
  - 串行提交;每次提交前等引擎队列清空(不与用户任务抢跑)
  - 只读加载仓库工作流做 UI→API 转换(object_info+named widgets 对齐,非启发式);
    实验流副本在引擎家用户区 MY-实验-*.json,仓库零改动
  - 幂等: 结果文件里 status=ok 且产物在盘的调用直接跳过(--force 强制重跑)
  - 每调用失败自动重试一次(强化重试),再败则记录后继续

用法:
  python p2_duipai_run.py --stage p2a
  python p2_duipai_run.py --stage p2b-assets
  python p2_duipai_run.py --stage p2b-downstream   # 需先跑 p2_grid_cut.py 切割
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------- 常量(实验口径)

BASE_URL_DEFAULT = "http://127.0.0.1:17000"  # 实测引擎监听端口(argv --port 17000)
ENGINE_HOME = Path.home() / "Library/Application Support/漫影工作室/comfyui"
ENGINE_OUT = ENGINE_HOME / "output"
REPO = Path.home() / "Project/Github/MYStudio"
WF_T2I_SUPSET = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json"
WF_EDIT_REF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/3_改图/MY-krea2_edit_ref.json"
RESULTS_DIR_DEFAULT = Path("/tmp/p2_duipai")
CLIENT_ID = "p2-duipai-experiment"
CALL_TIMEOUT_S = 2400
IDLE_WAIT_MAX_S = 3600  # 提交前等队列清空的上限

SEEDS = [20250915, 88001177]  # 两个 seed 面(同题同 seed 面: A/B 组同面同 seed)

# ------------------------------------------------------------ 提示词(通用题材,无 IP 词)

CHAR = (
    "a cheerful young woman baker with shoulder-length black hair, neat straight bangs, "
    "round silver-framed glasses, wearing a moss-green apron over a cream blouse with "
    "rolled-up sleeves and a small red neckerchief"
)
SCENE = (
    "inside her warm rustic bakery kitchen with wooden shelves, hanging copper pans, "
    "linen flour sacks, and soft morning sunlight streaming through a large window"
)

# 九镜矩阵: 镜号 + 景别 + 一句动作(同角色同场景)
SHOTS = [
    ("wide shot", "she pushes open the wooden front door of the bakery, morning light spilling across the floor"),
    ("full shot", "she stands at the wooden work table tying the strings of her moss-green apron behind her back"),
    ("medium shot", "she kneads a mound of white dough with both hands, flour dust floating in the air"),
    ("close-up", "the dough turns smooth and round under her palms on the flour-dusted table"),
    ("medium shot", "she lowers the dough into a brown clay bowl and covers it with a damp cloth"),
    ("medium close-up", "she leans slightly sideways with eyes curved into a smile, smelling the rising dough"),
    ("full shot", "she slides a tray of shaped loaves into the brick oven with a long wooden peel"),
    ("medium shot", "golden crusty loaves come out of the oven with rising steam as she reaches in with oven mitts"),
    ("close-up", "she lifts a warm round loaf up to the window light and smiles gently"),
]


def grid_prompt() -> str:
    panels = "; ".join(
        f"Panel {i} ({pos}), {scale}: {action}"
        for i, ((scale, action), pos) in enumerate(
            zip(
                SHOTS,
                ["top-left", "top-center", "top-right", "middle-left", "middle-center",
                 "middle-right", "bottom-left", "bottom-center", "bottom-right"],
            ),
            start=1,
        )
    )
    return (
        "One square image strictly divided into a 3x3 grid of nine equal panels, three rows by "
        "three columns, each panel separated by a clean straight white dividing line, like a "
        "storyboard sheet. No element may cross or overlap the dividing lines; every panel is one "
        f"independent complete film frame. All nine panels feature exactly the same character in "
        f"the same location: {CHAR}, {SCENE}. The character design, outfit, hairstyle, glasses and "
        f"drawing style stay identical in every panel. {panels}."
    )


def single_prompt(idx: int) -> str:
    scale, action = SHOTS[idx]
    return f"{CHAR}, {SCENE}. {scale.capitalize()}: {action}. Single complete film-frame composition."


TRIPTYCH_PROMPT = (
    "One wide image divided into three equal vertical panels side by side, separated by clean "
    "straight white divider lines, forming a character design sheet of one person in three views. "
    "Left panel: full-body front view. Middle panel: full-body side view facing left. Right panel: "
    "full-body back view. The same standing pose, same height, same outfit and same soft lighting "
    "in all three panels, plain warm beige studio background, nothing crossing the divider lines. "
    f"Character: {CHAR}, drawn full-body from head to shoes."
)

VIEW_WORDS = {"front": "front", "side": "left-side", "back": "back"}


def single_view_prompt(view: str) -> str:
    return (
        f"Character design reference image, full-body {VIEW_WORDS[view]} view of {CHAR}, "
        "standing straight with arms relaxed at her sides, plain warm beige studio background, "
        "full figure from head to shoes."
    )


DOWNSTREAM_SHOTS = [
    "Show this same woman baker standing behind the wooden shop counter, smiling as she hands a "
    "paper bag full of fresh bread across the counter.",
    "Show this same woman baker sitting on a wooden bench beside the bakery window, taking a bite "
    "of a croissant.",
    "Show this same woman baker writing the daily menu with chalk on a large blackboard, seen from "
    "a three-quarter angle.",
]

# ---------------------------------------------------------------- HTTP 小工具


def http_json(url: str, payload: dict | None = None, timeout: float = 30) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


# ---------------------------------------------------------------- UI→API 转换(超集流)

# 跳过的节点: 纯 UI 件(种子/分辨率选择器/预览/说明),其输出由覆盖内联字面量接管
T2I_SKIP_NODES = {20, 61, 62}  # rgthree Seed / ResolutionSelector / easy showAnything
T2I_SKIP_TYPES = {"MarkdownNote", "Note", "easy showAnything"}
# KSampler 的 control_after_generate 是 UI-only widget,API 面丢弃
UI_ONLY_WIDGETS = {"control_after_generate"}


def _resolve_src(nodes, links, nid, slot, depth=0):
    """旁路(mode=4)穿透:被旁路节点的出槽 N 回追其入槽 N 的连线源
    (LoRA 线性链 21→19→44→45→14 的 44/45 旁路=14 直连 19;09-16 E2E
    实弹抓出旧版把旁路节点当激活带入 API 图的缺陷后补)。
    同槽穿透不了(多出槽/入槽悬空)即报错,不静默错接。"""
    node = nodes.get(nid)
    if node is None:
        raise RuntimeError(f"连线源节点 {nid} 不在工作流")
    if node.get("mode") != 4:
        return nid, slot
    if depth > 8:
        raise RuntimeError(f"旁路穿透超过 8 层(节点 {nid}),疑似环路")
    in_slots = node.get("inputs") or []
    if slot >= len(in_slots):
        raise RuntimeError(f"旁路节点 {nid} 出槽 {slot} 无同序入槽可穿透")
    lid = in_slots[slot].get("link")
    if lid is None or lid not in links:
        raise RuntimeError(f"旁路节点 {nid} 入槽 {slot} 未连线,无法穿透")
    up = links[lid]
    return _resolve_src(nodes, links, up[1], up[2], depth + 1)


def ui_to_api_t2i(wf: dict, oi: dict, overrides: dict[str, object]) -> dict:
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf.get("links", [])}
    bypassed = {nid for nid, n in nodes.items() if n.get("mode") == 4}
    if bypassed:
        print(f"[p2] 旁路节点不入 API 图(mode=4): {sorted(bypassed)}")
    prompt: dict[str, dict] = {}
    for nid, n in nodes.items():
        if nid in T2I_SKIP_NODES or n["type"] in T2I_SKIP_TYPES or nid in bypassed:
            continue
        cls = n["type"]
        order = list(oi[cls]["input"].get("required", {}).keys()) + \
            list(oi[cls]["input"].get("optional", {}).keys())
        named = n.get("widgets_values_named") or {}
        linked = {}
        for slot_def in n.get("inputs") or []:
            lid = slot_def.get("link")
            if lid is None or lid not in links:
                continue
            src = links[lid][1]
            if src in T2I_SKIP_NODES:
                continue  # 被跳过源的连线一律由覆盖内联
            src, out_slot = _resolve_src(nodes, links, src, links[lid][2])
            linked[slot_def["name"]] = [str(src), out_slot]
        inputs: dict[str, object] = {}
        fell_back = []
        for name in order:
            if name in linked:
                inputs[name] = linked[name]
            elif name in named:
                inputs[name] = named[name]
            else:
                spec = oi[cls]["input"].get("required", {}).get(name) or \
                    oi[cls]["input"].get("optional", {}).get(name)
                if spec and len(spec) > 1 and isinstance(spec[1], dict) and "default" in spec[1]:
                    inputs[name] = spec[1]["default"]  # 空 widget(如负向留空)回落官方默认
                    fell_back.append(name)
                elif spec and spec[0] == "STRING":
                    inputs[name] = ""  # 无默认的 STRING widget(留空文本)按空串提交
                    fell_back.append(name)
        # 位置式 widgets_values 盲区警告(09-16 E2E 实弹:64 负向位置式没被
        # 带上→API 图负向为空)。不猜位置映射(KSampler 连线态下位置序不稳),
        # 要携带值就写 widgets_values_named 或用 overrides 内联。
        if fell_back and n.get("widgets_values"):
            print(f"[p2] 警告: 节点{nid} {cls} 输入 {fell_back} 回落默认/空串"
                  f"(节点带位置式 widgets_values 但无 named 映射,如需携带请加 overrides)")
        leftover = {k for k in named if k not in order and k not in UI_ONLY_WIDGETS}
        if leftover:
            raise RuntimeError(f"节点{nid} {cls} 有未映射 widget: {leftover}")
        if not inputs:
            raise RuntimeError(f"节点{nid} {cls} 映射为空")
        prompt[str(nid)] = {"class_type": cls, "inputs": inputs}
    for key, val in overrides.items():
        nid_s, field = key.split(".", 1)
        prompt[nid_s]["inputs"][field] = val
    return prompt


def build_t2i_graph(oi: dict, *, prompt_text: str, seed: int, width: int, height: int,
                    steps: int, prefix: str) -> dict:
    wf = json.loads(WF_T2I_SUPSET.read_text(encoding="utf-8"))
    overrides = {
        "50.value": prompt_text,          # 正向提示词(经 [60] 漫影风格库注入,MyStylesLibrary 读 art_skills;风格值走 widgets_values_named.style)
        "12.seed": int(seed),             # 内联字面量(绕开 rgthree 种子件)
        "12.steps": int(steps),
        "53.width": int(width),           # 内联字面量(绕开分辨率选择件)
        "53.height": int(height),
        "4.filename_prefix": prefix,
    }
    return ui_to_api_t2i(wf, oi, overrides)


# ------------------------------------------------------- 下游图生图(krea2_edit_ref)

def build_edit_ref_graph(*, ref_name: str, instruction: str, seed: int,
                         width: int, height: int, prefix: str) -> dict:
    tpl = json.loads(WF_EDIT_REF.read_text(encoding="utf-8"))
    graph = copy.deepcopy(tpl["graph"])
    # 单参考形态: 整链摘除 46/52/53 并剥掉 b 路输入(与 comfyui_bridge 同款剪枝)
    for node_id in ("46", "52", "53"):
        graph.pop(node_id, None)
    for node_id in ("34", "36"):
        graph.get(node_id, {}).get("inputs", {}).pop("image_b", None)
    patch = graph.get("35", {}).get("inputs", {})
    for k in ("source_latent_b", "source_image_b"):
        patch.pop(k, None)
    graph["45"]["inputs"]["image"] = ref_name
    graph["36"]["inputs"]["prompt"] = instruction
    graph["30"]["inputs"]["seed"] = int(seed)
    graph["28"]["inputs"]["width"] = int(width)
    graph["28"]["inputs"]["height"] = int(height)
    graph["27"]["inputs"]["filename_prefix"] = prefix
    return graph


# ---------------------------------------------------------------- 引擎资源采样


class EngineSampler(threading.Thread):
    """每 5s 采一次引擎进程 CPU%/RSS 与系统负载;时间序列供按调用切片。"""

    def __init__(self, pid: int):
        super().__init__(daemon=True)
        self.pid = pid
        self.series: list[dict] = []
        self._stop = threading.Event()
        import psutil  # 引擎 venv 自带

        self._proc = psutil.Process(pid)
        self._proc.cpu_percent(None)  # prime

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self.series.append({
                    "t": time.time(),
                    "cpu": self._proc.cpu_percent(None),
                    "rss_mb": round(self._proc.memory_info().rss / 1048576, 1),
                    "load1": round(os.getloadavg()[0], 2),
                })
            except Exception:
                pass
            self._stop.wait(5.0)

    def stop(self) -> None:
        self._stop.set()

    def slice(self, t0: float, t1: float) -> dict:
        pts = [p for p in self.series if t0 <= p["t"] <= t1]
        if not pts:
            return {"samples": 0}
        return {
            "samples": len(pts),
            "cpu_avg": round(sum(p["cpu"] for p in pts) / len(pts), 1),
            "cpu_max": round(max(p["cpu"] for p in pts), 1),
            "rss_max_mb": max(p["rss_mb"] for p in pts),
            "rss_min_mb": min(p["rss_mb"] for p in pts),
        }


def find_engine_pid(port: int) -> int:
    out = subprocess.run(["pgrep", "-f", "ComfyUI/main.py"], capture_output=True, text=True).stdout
    for pid_s in out.split():
        cmd = subprocess.run(["ps", "-p", pid_s, "-o", "command="], capture_output=True, text=True).stdout
        if f"--port {port}" in cmd:
            return int(pid_s)
    raise RuntimeError(f"找不到监听 {port} 的 ComfyUI 进程(引擎未跑?)")


# ---------------------------------------------------------------- 队列与执行


def queue_len(base: str) -> tuple[int, int]:
    q = http_json(f"{base}/queue", timeout=10)
    return len(q.get("queue_running", [])), len(q.get("queue_pending", []))


def wait_idle(base: str) -> None:
    t0 = time.time()
    while True:
        r, p = queue_len(base)
        if r == 0 and p == 0:
            return
        if time.time() - t0 > IDLE_WAIT_MAX_S:
            raise RuntimeError("等待引擎空闲超时(用户任务持续占用)")
        time.sleep(10)


def run_call(base: str, call_id: str, graph: dict, sampler: EngineSampler,
             graphs_dir: Path) -> dict:
    graphs_dir.joinpath(f"{call_id}.json").write_text(
        json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    attempts = []
    for attempt in (1, 2):  # 失败强化重试一次
        t_submit = time.time()
        try:
            wait_idle(base)
            resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
            if resp.get("node_errors"):
                raise RuntimeError(f"节点校验失败: {json.dumps(resp['node_errors'])[:500]}")
            pid = resp["prompt_id"]
            deadline = t_submit + CALL_TIMEOUT_S
            entry = None
            while time.time() < deadline:
                hist = http_json(f"{base}/history/{pid}", timeout=20)
                if pid in hist:
                    entry = hist[pid]
                    break
                time.sleep(3)
            if entry is None:
                raise RuntimeError("执行超时(history 未见完成)")
            status = entry.get("status", {})
            if status.get("status_str") != "success":
                msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
                raise RuntimeError(f"执行失败: {json.dumps(msgs[:1])[:800]}")
            t_done = time.time()
            outputs = []
            for _nid, out in (entry.get("outputs") or {}).items():
                for imgs in (out or {}).values():
                    if isinstance(imgs, list):
                        outputs += [
                            {"filename": x["filename"], "subfolder": x.get("subfolder", ""),
                             "abs": str(ENGINE_OUT / x.get("subfolder", "") / x["filename"])}
                            for x in imgs if isinstance(x, dict) and "filename" in x
                        ]
            missing = [o for o in outputs if not Path(o["abs"]).exists()]
            if not outputs or missing:
                raise RuntimeError(f"产物缺失: {missing or '无输出'}")
            rec = {
                "status": "ok", "attempts": attempt, "prompt_id": pid,
                "submitted_at": dt.datetime.now().isoformat(timespec="seconds"),
                "wall_s": round(t_done - t_submit, 1),
                "engine": sampler.slice(t_submit, t_done),
                "outputs": outputs,
            }
            attempts.append({"attempt": attempt, "ok": True})
            return rec
        except Exception as exc:  # noqa: BLE001
            attempts.append({"attempt": attempt, "ok": False, "error": str(exc)[:600]})
            if attempt == 2:
                return {"status": "failed", "attempts": attempts,
                        "submitted_at": dt.datetime.now().isoformat(timespec="seconds")}
            time.sleep(5)


def upload_image(base: str, path: Path) -> str:
    boundary = "----p2duipai-boundary"
    body = b"".join((
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'.encode(),
        b"Content-Type: image/png\r\n\r\n", path.read_bytes(), b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    req = urllib.request.Request(f"{base}/upload/image", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read().decode())
    name = resp["name"] if resp.get("subfolder", "") == "" else f"{resp['subfolder']}/{resp['name']}"
    return name


# ---------------------------------------------------------------- 调用清单


def manifest(stage: str) -> list[dict]:
    calls: list[dict] = []
    if stage == "p2a":
        for seed in SEEDS:
            calls.append(dict(id=f"A_grid1mp_s{seed}", kind="A宫格1MP", seed=seed,
                              prompt=grid_prompt(), w=1024, h=1024, steps=10,
                              prefix=f"MY-实验/P2a/A_grid1mp_s{seed}"))
            calls.append(dict(id=f"A_grid2mp_s{seed}", kind="A宫格2MP", seed=seed,
                              prompt=grid_prompt(), w=1408, h=1408, steps=10,
                              prefix=f"MY-实验/P2a/A_grid2mp_s{seed}"))
            for i, (scale, _act) in enumerate(SHOTS, start=1):
                calls.append(dict(id=f"B_s{seed}_shot{i:02d}", kind=f"B单镜{i}", seed=seed,
                                  prompt=single_prompt(i - 1), w=1024, h=1024, steps=10,
                                  prefix=f"MY-实验/P2a/B_s{seed}_shot{i:02d}"))
        # 高清档探针: 2MP+12步(参数速查: 高清路线 12 步),单 seed 面
        seed = SEEDS[0]
        calls.append(dict(id=f"A_grid2mp12_s{seed}", kind="A宫格2MP12步探针", seed=seed,
                          prompt=grid_prompt(), w=1408, h=1408, steps=12,
                          prefix=f"MY-实验/P2a/A_grid2mp12_s{seed}"))
    elif stage == "p2b-assets":
        for seed in SEEDS:
            calls.append(dict(id=f"A_tri_s{seed}", kind="A三视图", seed=seed,
                              prompt=TRIPTYCH_PROMPT, w=1536, h=512, steps=10,
                              prefix=f"MY-实验/P2b/A_tri_s{seed}"))
            for view in ("front", "side", "back"):
                calls.append(dict(id=f"B_{view}_s{seed}", kind=f"B单人{view}", seed=seed,
                                  prompt=single_view_prompt(view), w=1024, h=1024, steps=10,
                                  prefix=f"MY-实验/P2b/B_{view}_s{seed}"))
    elif stage == "p2b-downstream":
        # 实际清单在 main() 里解析(需要 p2b-assets 结果 + 切割件),此处返回空
        pass
    else:
        raise SystemExit(f"未知 stage: {stage}")
    return calls


def build_downstream_calls(results: dict, results_dir: Path) -> list[dict]:
    assets = results.get("p2b-assets", {})
    calls = []
    cuts = results_dir / "cuts"
    for seed in SEEDS:
        b_front = None
        for cid, rec in assets.items():
            if cid == f"B_front_s{seed}" and rec.get("status") == "ok":
                b_front = Path(rec["outputs"][0]["abs"])
        a_front = cuts / f"A_tri_s{seed}_p1.png"
        if not b_front or not b_front.exists():
            raise SystemExit(f"seed {seed} 的 B 正面参考缺失(先跑 p2b-assets)")
        if not a_front.exists():
            raise SystemExit(f"seed {seed} 的 A 切割件缺失 {a_front}(先跑 p2_grid_cut.py)")
        for group, ref in (("A", a_front), ("B", b_front)):
            for j, instruction in enumerate(DOWNSTREAM_SHOTS, start=1):
                calls.append(dict(
                    id=f"D_{group}_s{seed}_shot{j}", kind=f"下游{group}镜{j}", seed=seed,
                    instruction=instruction, ref=str(ref),
                    prefix=f"MY-实验/P2b/D_{group}_s{seed}_shot{j}",
                ))
    return calls


# ---------------------------------------------------------------- 主流程


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True,
                    choices=["p2a", "p2b-assets", "p2b-downstream"])
    ap.add_argument("--base-url", default=BASE_URL_DEFAULT)
    ap.add_argument("--results-dir", type=Path, default=RESULTS_DIR_DEFAULT)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    results_dir: Path = args.results_dir
    results_dir.mkdir(parents=True, exist_ok=True)
    graphs_dir = results_dir / "graphs"
    graphs_dir.mkdir(exist_ok=True)

    port = int(args.base_url.rsplit(":", 1)[1])
    engine_pid = find_engine_pid(port)
    sampler = EngineSampler(engine_pid)
    sampler.start()

    results_path = results_dir / f"results_{args.stage}.json"
    results = json.loads(results_path.read_text()) if results_path.exists() else {}
    meta = results.setdefault("_meta", {})
    meta.update({
        "stage": args.stage, "base_url": args.base_url, "engine_pid": engine_pid,
        "started_at": dt.datetime.now().isoformat(timespec="seconds"),
        "system_stats": http_json(f"{args.base_url}/system_stats", timeout=15).get("system", {}).get("os", ""),
    })

    if args.stage == "p2b-downstream":
        master = results_dir / "results_master.json"
        calls = build_downstream_calls(
            json.loads(master.read_text()) if master.exists() else results, results_dir)
    else:
        calls = manifest(args.stage)

    print(f"[{args.stage}] 引擎 pid={engine_pid} 共 {len(calls)} 个调用,串行执行", flush=True)
    t_stage = time.time()
    for call in calls:
        cid = call["id"]
        prev = results.get(cid, {})
        if (not args.force and prev.get("status") == "ok"
                and all(Path(o["abs"]).exists() for o in prev.get("outputs", []))):
            print(f"  跳过(已完成) {cid}", flush=True)
            continue
        if call.get("kind") == "resolve":
            continue
        if args.stage == "p2b-downstream":
            ref_name = upload_image(args.base_url, Path(call["ref"]))
            graph = build_edit_ref_graph(ref_name=ref_name, instruction=call["instruction"],
                                         seed=call["seed"], width=1024, height=1024,
                                         prefix=call["prefix"])
        else:
            graph = build_t2i_graph(http_json(f"{args.base_url}/object_info", timeout=30),
                                    prompt_text=call["prompt"], seed=call["seed"],
                                    width=call["w"], height=call["h"], steps=call["steps"],
                                    prefix=call["prefix"])
        t0 = time.time()
        rec = run_call(args.base_url, cid, graph, sampler, graphs_dir)
        rec["kind"] = call.get("kind", "")
        rec["seed"] = call.get("seed")
        if args.stage != "p2b-downstream":
            rec["w"], rec["h"], rec["steps"] = call["w"], call["h"], call["steps"]
        else:
            rec["ref"] = call["ref"]
            rec["instruction"] = call["instruction"]
        results[cid] = rec
        results_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))
        print(f"  {cid}: {rec['status']} wall={rec.get('wall_s', '?')}s"
              f" (+{round(time.time() - t0 - rec.get('wall_s', 0), 1)}s 开销)"
              f" cpu_max={rec.get('engine', {}).get('cpu_max', '?')}"
              f" rss_max={rec.get('engine', {}).get('rss_max_mb', '?')}MB", flush=True)

    sampler.stop()
    meta["finished_at"] = dt.datetime.now().isoformat(timespec="seconds")
    meta["stage_wall_s"] = round(time.time() - t_stage, 1)
    meta["sampler_series_len"] = len(sampler.series)
    (results_dir / "sampler_series.json").write_text(json.dumps(sampler.series))
    results_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))

    # 汇总进 master(供 p2b-downstage 交叉读取)
    master = results_dir / "results_master.json"
    master_data = json.loads(master.read_text()) if master.exists() else {}
    master_data[args.stage] = {k: v for k, v in results.items() if k != "_meta"}
    master_data.setdefault("_meta", {}).update(meta)
    master.write_text(json.dumps(master_data, ensure_ascii=False, indent=1))

    exit_path = results_dir / f"{args.stage}.exit"
    failed = [k for k, v in results.items() if k != "_meta" and v.get("status") != "ok"]
    exit_path.write_text("ok\n" if not failed else "failed: " + ", ".join(failed) + "\n")
    print(f"[{args.stage}] 完成,失败={len(failed)} 总耗时={meta['stage_wall_s']}s -> {exit_path}", flush=True)


if __name__ == "__main__":
    main()
