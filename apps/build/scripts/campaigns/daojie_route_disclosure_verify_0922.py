#!/usr/bin/env python3
"""[86] 披露·屏蔽件不展示 修复的真弹验证 v2(09-22)。

v1 教训:①转换器 SKIP_NODES 丢 [86],披露串不进 history;②正则写死型名而
画布现值是美宣。v2:转换后手动接回显示终端(999 easy showAnything,output
节点),砍路由未选槽(与服务端 lazy 语义一致)→ 剪枝到单链 → 免采样执行
(只加载 K2+该链 LoRA)→ history 披露串必须与画布 mode=0 真链一字不差,
旁路件件名不得出现。干完即停。
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import time

HOME = os.path.expanduser("~/Library/Application Support/漫影工作室/comfyui")
ENGDIR = os.path.join(HOME, "ComfyUI")
VENV_PY = os.path.join(HOME, "venv/bin/python")
PORT = 17002
BASE = f"http://127.0.0.1:{PORT}"
WF = (os.path.expanduser("~/Project/Github/MYStudio/apps/backend/engines/comfyui/")
      + "workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json")
LEDGER = (os.path.expanduser("~/Project/Github/MYStudio/apps/backend/engines/comfyui/")
          + "my_nodes/nodes/daojie_lora_stack.json")
SG_ID = "91286f09-71a2-4da6-8e59-3c3cdce6eec2"
LOG = os.path.expanduser("~/Downloads/daojie_disclosure_verify_engine.log")

_spec = importlib.util.spec_from_file_location(
    "nf", os.path.expanduser("~/Project/Github/MYStudio/apps/build/scripts/campaigns/")
          + "nineform_livefire_0922.py")
nf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(nf)


def http_json(url: str, payload: dict | None = None, timeout: float = 30) -> dict:
    import urllib.error
    import urllib.request
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data,
                                headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return json.loads(body)
        except Exception:
            return {"http_error": e.code, "body": body[:2000]}


def kill_orphan() -> None:
    r = subprocess.run(["pgrep", "-f", f"ComfyUI/main.py.*--port {PORT}"],
                       capture_output=True, text=True)
    for pid in (r.stdout or "").split():
        subprocess.run(["kill", pid])
        print(f"[verify] 已杀残留引擎 pid={pid}", flush=True)
    time.sleep(2)


def spawn_engine() -> subprocess.Popen:
    argv = [VENV_PY, os.path.join(ENGDIR, "main.py"),
            "--listen", "127.0.0.1", "--port", str(PORT), "--enable-manager",
            "--gpu-only", "--reserve-vram", "16", "--use-pytorch-cross-attention",
            "--input-directory", os.path.join(HOME, "input"),
            "--output-directory", os.path.join(HOME, "output")]
    p = subprocess.Popen(argv, cwd=ENGDIR,
                         stdout=open(LOG, "wb"), stderr=subprocess.STDOUT)
    t0 = time.time()
    while time.time() - t0 < 300:
        try:
            http_json(f"{BASE}/object_info", timeout=10)
            print(f"[verify] 引擎就绪({time.time()-t0:.0f}s) pid={p.pid}", flush=True)
            return p
        except Exception:
            time.sleep(5)
    raise RuntimeError("引擎 300s 未就绪,日志见 " + LOG)


def canvas_expected(base_type: str) -> tuple[str, list[str]]:
    """画布口径期望:该型行 mode=0 加载器(头→尾)+台账件名;旁路穿透不计数。"""
    wf = json.load(open(WF, encoding="utf-8"))
    sg = next(s for s in wf["definitions"]["subgraphs"] if s["id"] == SG_ID)
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}  # 子图 links=对象格式(v5 契约)
    route = next(n for n in sg["nodes"] if n["type"] == "MyDaojieRoute")

    def input_link(nid: int, name: str):
        n = nodes[nid]
        inp = next((i for i in n.get("inputs", []) if i.get("name") == name), None)
        if inp is None or inp.get("link") is None:
            return None
        return links[inp["link"]]["origin_id"]

    cur = input_link(route["id"], base_type)
    chain: list[tuple[str, float]] = []
    bypassed_names: list[str] = []
    guard = 0
    while cur is not None and guard < 64:
        guard += 1
        if cur not in nodes:
            break  # 子图 IO 脚(负 id)或外部进线=链头
        n = nodes[cur]
        if n.get("type") != "LoraLoaderModelOnly":
            break
        if n.get("mode") == 4:  # 旁路穿透:披露与链路都不得含它
            bypassed_names.append(n["widgets_values"][0])
            cur = input_link(n["id"], "model")
            continue
        wv = n["widgets_values"]
        chain.append((wv[0], float(wv[1])))
        cur = input_link(n["id"], "model")
    chain.reverse()  # 头(底模侧)在前
    labels = {p["file"]: p.get("label") or os.path.basename(p["file"])
              for p in json.load(open(LEDGER, encoding="utf-8"))}
    parts = [f"{labels.get(f, os.path.basename(f))}×{s:g}" for f, s in chain]
    expect = f"路线={base_type}线·{len(parts)}件 | {' → '.join(parts)}"
    return expect, bypassed_names


def prune_to(graph: dict, roots: list[str]) -> dict:
    keep: set[str] = set()
    stack = [r for r in roots if r in graph]
    while stack:
        nid = stack.pop()
        if nid in keep:
            continue
        keep.add(nid)
        for v in graph[nid].get("inputs", {}).values():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) \
                    and v[0] in graph:
                stack.append(v[0])
            elif isinstance(v, list) and v and isinstance(v[0], list):
                for lk in v:
                    if isinstance(lk, list) and len(lk) == 2 and lk[0] in graph:
                        stack.append(lk[0])
    return {k: graph[k] for k in keep}


def build_frontend_shaped(graph_conv: dict, base_type: str) -> dict:
    """模拟前端展开语义的最小 API 图:保留 MyDaojieRoute 节点(转换器 v9 会把
    路由剪枝拼接掉,那是 API 批量路径;用户走的前端路径路由节点真实存在,
    hidden PROMPT 注入+lazy 只在节点执行时发生——本函数构造的正是这个形态)。
    组成:宿主模型源(从转换器图借)+ 该型行 mode=0 加载器 + 路由 + 显示终端。"""
    wf = json.load(open(WF, encoding="utf-8"))
    sg = next(s for s in wf["definitions"]["subgraphs"] if s["id"] == SG_ID)
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}
    route = next(n for n in sg["nodes"] if n["type"] == "MyDaojieRoute")

    def input_link(nid: int, name: str):
        n = nodes[nid]
        inp = next((i for i in n.get("inputs", []) if i.get("name") == name), None)
        if inp is None or inp.get("link") is None:
            return None
        return links[inp["link"]]["origin_id"]

    # 沿该型行收 mode=0 链(头→尾),旁路穿透
    cur = input_link(route["id"], base_type)
    row: list[int] = []
    guard = 0
    while cur is not None and cur in nodes and guard < 64:
        guard += 1
        n = nodes[cur]
        if n.get("type") != "LoraLoaderModelOnly":
            break
        if n.get("mode") == 4:
            cur = input_link(n["id"], "model")
            continue
        row.append(cur)
        cur = input_link(n["id"], "model")
    row.reverse()
    assert row, f"{base_type} 行无激活加载器"

    # 宿主模型源:主图 [90].model 输入连线源(前端同型;v3 教训:按件名猜上漂)
    main_nodes = {n["id"]: n for n in wf["nodes"]}
    main_links = {l[0]: l for l in wf["links"]}
    m_in = next(i for i in main_nodes[90].get("inputs", []) if i.get("name") == "model")
    host_id = str(main_links[m_in["link"]][1])
    assert host_id in graph_conv, f"宿主节点 {host_id} 不在转换图"
    # base 必须走连线(裸 COMBO 字面值会被空列表校验拒——09-21 既有设计,链接形态才收)
    b_in = next(i for i in main_nodes[90].get("inputs", []) if i.get("name") == "base")
    bl = main_links[b_in["link"]]
    base_src = [str(bl[1]), bl[2]]
    assert base_src[0] in graph_conv, f"底座节点 {base_src[0]} 不在转换图"

    g = prune_to(graph_conv, [base_src[0]])  # [80] 上游(如 [50] 主体句)一并带入
    g[host_id] = graph_conv[host_id]
    prev = [host_id, 0]
    for inner in row:
        wv = nodes[inner]["widgets_values"]
        g[f"90.{inner}"] = {"class_type": "LoraLoaderModelOnly",
                            "inputs": {"lora_name": wv[0], "strength_model": wv[1],
                                       "model": prev}}
        prev = [f"90.{inner}", 0]
    g["90.route"] = {"class_type": "MyDaojieRoute",
                     "inputs": {"base": base_src, base_type: prev}}
    g["999"] = {"class_type": "easy showAnything",
                "inputs": {"anything": ["90.route", 1]}}  # API 单链,不包输入表
    return g


def main() -> int:
    kill_orphan()
    proc = spawn_engine()
    try:
        wf = json.load(open(WF, encoding="utf-8"))
        # 型=画布 [80] 现值(与前端一致,不硬编码)
        n80 = next(n for n in wf["nodes"] if n.get("id") == 80)
        base_type = ((n80.get("widgets_values_named") or {}).get("base")
                     or (n80.get("widgets_values") or [None])[0])
        oi = http_json(f"{BASE}/object_info", timeout=60)
        graph_conv = nf.ui_to_api(wf, oi, {})  # 只为借宿主模型节点的 API 形态
        graph = build_frontend_shaped(graph_conv, base_type)
        print(f"[verify] 前端形态最小图节点数={len(graph)}(宿主1+链{len(graph)-3}+路由+显示)", flush=True)
        json.dump(graph, open(os.path.expanduser(
            "~/Downloads/daojie_disclosure_verify_graph.json"), "w", encoding="utf-8"),
            ensure_ascii=False, indent=1)
        expect, bypassed = canvas_expected(base_type)
        print(f"[verify] 画布期望披露:{expect}", flush=True)
        print(f"[verify] 该行旁路件:{bypassed}", flush=True)

        resp = http_json(f"{BASE}/prompt", {"prompt": graph,
                                            "client_id": "disclosure-verify-0922"},
                         timeout=60)
        if resp.get("node_errors") or resp.get("http_error"):
            print("[verify] 拒绝详情:",
                  json.dumps(resp, ensure_ascii=False)[:1600], flush=True)
            return 1
        pid = resp["prompt_id"]
        t0 = time.time()
        hist = {}
        while time.time() - t0 < 420:
            time.sleep(10)
            hist = http_json(f"{BASE}/history/{pid}", timeout=15).get(pid, {})
            if hist:
                break
        if not hist:
            print("[verify] 超时未完成", flush=True)
            return 1
        blob = json.dumps(hist.get("outputs", {}), ensure_ascii=False)
        m = re.search(r"路线=\S+线·\d+件[^\"\\\\]*", blob)
        disclosure = m.group(0) if m else ""
        print(f"[verify] 实测披露:{disclosure}", flush=True)
        stems = [os.path.basename(b).replace(".safetensors", "") for b in bypassed]
        leaked = [s for s in stems if s and s in disclosure]
        ok = bool(disclosure) and disclosure == expect and not leaked
        print(f"[verify] 旁路件泄漏:{leaked or '无'} | 一致:{disclosure == expect}", flush=True)
        print(json.dumps({"ok": int(ok), "base": base_type, "disclosure": disclosure,
                          "expect": expect}, ensure_ascii=False))
        return 0 if ok else 1
    finally:
        try:
            proc.terminate()
            time.sleep(3)
            proc.kill()
        except Exception:
            pass
        print("[verify] 已收掉自拉引擎(干完即停)", flush=True)


if __name__ == "__main__":
    sys.exit(main())
