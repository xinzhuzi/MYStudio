#!/usr/bin/env python3
"""道劫专属工作流 K2-文生图-道劫.json 实弹验证(09-17 制作当日)。

一次完整闭环:
  1. 等引擎队列清空(轮询 /queue,p2 纪律:不与用户任务抢跑,上限 10 分钟);
  2. 只读加载仓库工作流做 UI→API 转换(object_info + named widgets 对齐,非启发式;
     照 p2_duipai_run.py 转换法;[64] 无 widgets_values_named → 按 object_info 输入序
     位置回退,负向基线必须带上——09-16 E2E 抓过位置式丢失致 API 负向为空的缺陷);
  3. [50] 主体句填 docs/prompts/道劫_新提示词包_0917.md §二「填好示例」逐字,
     种子固定 20250915,其余参数全默认(4步/cfg1 速度档/1024²);
  4. POST /prompt → 轮询 /history;
  5. 校验最终正向(节点 [62] easy showAnything 在 history 回读的 ui.text,与喂给
     [51] 正向编码的是同一根 [72] 装配输出):以 §一底座开头 + 含主体句开头
     「一位女修士」;
  6. 经 /view 下载成图 → 拷贝到仓库 output/daojie_livefire_0917.png;
  7. 打印 JSON 摘要(图片路径/耗时/最终正向前 120 字),成功退出码 0。

用法:python3 apps/build/scripts/daojie_livefire_0917.py [--base-url http://127.0.0.1:17000]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL_DEFAULT = "http://127.0.0.1:17000"
REPO = Path(__file__).resolve().parents[3]  # apps/build/scripts → 仓库根
WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
PROMPT_MD = REPO / "docs/prompts/道劫_新提示词包_0917.md"
OUT_PNG = REPO / "output" / "daojie_livefire_0917.png"
CLIENT_ID = "daojie-livefire-0917"
IDLE_WAIT_MAX_S = 600    # 提交前等队列清空上限(10 分钟)
EXEC_TIMEOUT_S = 900     # 提交后等执行完成上限(15 分钟)
POLL_S = 5
SEED = 20250915

# 纯 UI 件(种子/分辨率选择器)由覆盖内联字面量接管;[62] 预览件保留——
# 它是 output_node,history 里回读最终正向靠它
SKIP_NODES = {20, 61, 86}  # 86=生效披露显示件(v9 按型路由剪枝后无 applied 源,UI 跑由 Route 披露)
SKIP_TYPES = {"MarkdownNote", "Note"}
UI_ONLY_WIDGETS = {"control_after_generate"}


def http_json(url: str, payload: dict | None = None, timeout: float = 30) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def http_bytes(url: str, timeout: float = 120) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as r:
        return r.read()


def md_fence(heading_prefix: str) -> str:
    """md 指定标题之后第一个 ```text 围栏的逐字内容(与契约测试同法)。"""
    lines = PROMPT_MD.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith(heading_prefix))
    j = next(k for k in range(start, len(lines)) if lines[k].startswith("```text"))
    end = next(k for k in range(j + 1, len(lines)) if lines[k].startswith("```"))
    return "\n".join(lines[j + 1:end])


def _resolve_src(nodes, links, nid, slot, depth=0):
    """旁路(mode=4)穿透:被旁路节点的出槽 N 回追其入槽 N 的连线源(照 p2 纪律)。"""
    node = nodes.get(nid)
    if node is None:
        raise RuntimeError(f"连线源节点 {nid} 不在工作流")
    if node.get("mode") != 4:
        return nid, slot
    if depth > 16:
        # 上限 09-19 提到 16:全量扩架后道劫链连续旁路件可达 11 个(19/46/67/69/
        # 73/76/77/78/82/83/84),旧 8 层被真链顶穿;16 仍足以挡环路
        raise RuntimeError(f"旁路穿透超过 16 层(节点 {nid}),疑似环路")
    in_slots = node.get("inputs") or []
    if slot >= len(in_slots):
        raise RuntimeError(f"旁路节点 {nid} 出槽 {slot} 无同序入槽可穿透")
    lid = in_slots[slot].get("link")
    if lid is None or lid not in links:
        raise RuntimeError(f"旁路节点 {nid} 入槽 {slot} 未连线,无法穿透")
    up = links[lid]
    return _resolve_src(nodes, links, up[1], up[2], depth + 1)


def _expand_subgraph_chain(sg: dict, oi: dict, host_id, host_inputs, nodes, links):
    """子图链式展开(v8,聚合节点退役后):子图内激活节点沿 model 链摊平进 API 图。

    返回 (entries, tail_api_id):entries=子图内激活节点的 API 条目(id=f"{host_id}.{inner_id}");
    tail_api_id=链尾(其 model 输出对位子图 model 输出槽)。
    子图 links 兼容两种格式:0.37 对象 {origin_id,...} / 旧数组 [id,src,slot,dst,slot,type]。
    """
    sgn = {x["id"]: x for x in sg["nodes"]}
    inner_edges = {}  # target_id -> (origin_id, origin_slot)
    for l in sg.get("links", []):
        if isinstance(l, dict):
            oid_, oslot, tid, _tslot = l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"]
        else:
            _, oid_, oslot, tid, _tslot = l[:5]
        inner_edges[tid] = (oid_, oslot)
    active = [x for x in sg["nodes"]
              if x.get("mode") != 4 and x["type"] in oi
              and x["type"] not in ("MarkdownNote",)]
    if not active:
        raise RuntimeError(f"子图 {sg.get('name')} 无激活可执行节点")
    # 拓扑排序:沿 model 入边(输入槽0)迭代
    ordered, seen = [], set()

    def visit(x):
        if x["id"] in seen:
            return
        seen.add(x["id"])
        edge = inner_edges.get(x["id"])
        if edge and edge[0] in sgn:
            visit(sgn[edge[0]])
        ordered.append(x)

    for x in active:
        visit(x)
    entries, api_of_inner = {}, {}
    for x in ordered:
        cls = x["type"]
        order = (list(oi[cls]["input"].get("required", {}).keys())
                 + list(oi[cls]["input"].get("optional", {}).keys()))
        inputs, positional = {}, []
        linked = {}
        for slot_def in x.get("inputs") or []:
            if slot_def.get("name") != "model":
                continue
            edge = inner_edges.get(x["id"])
            if edge and edge[0] in api_of_inner:
                linked["model"] = api_of_inner[edge[0]]
            elif edge and edge[0] in sgn and sgn[edge[0]].get("mode") == 4:
                # 上游是旁路件:穿透到子图边界→宿主 model 输入源
                host_lid = next((s.get("link") for s in (host_inputs or []) if s.get("name") == "model"), None)
                if host_lid is not None and host_lid in links:
                    up = links[host_lid]
                    src, out_slot = _resolve_src(nodes, links, up[1], up[2])
                    linked["model"] = [str(src), out_slot]
            elif not edge:
                # 链头:无内边=接宿主 [90] 的 model 输入线
                host_lid = next((s.get("link") for s in (host_inputs or []) if s.get("name") == "model"), None)
                if host_lid is not None and host_lid in links:
                    up = links[host_lid]
                    src, out_slot = _resolve_src(nodes, links, up[1], up[2])
                    linked["model"] = [str(src), out_slot]
                else:
                    raise RuntimeError(f"子图链头 {x['id']} 无宿主 model 输入线可接")
        wv = x.get("widgets_values") or []
        for name in order:
            if name in linked:
                inputs[name] = linked[name]
            elif name in UI_ONLY_WIDGETS:
                continue
            elif any(s.get("name") == name for s in (x.get("inputs") or [])):
                continue  # 连线型输入(未连=信任展开链语义)
            else:
                positional.append(name)
        if positional:
            if len(positional) == len(wv):
                for name, val in zip(positional, wv):
                    inputs[name] = val
            else:
                raise RuntimeError(f"子图节点{x['id']} {cls} 位置对不齐: {positional} vs {wv!r}")
        api_id = f"{host_id}.{x['id']}"
        api_of_inner[x["id"]] = [api_id, 0]
        entries[api_id] = {"class_type": cls, "inputs": inputs}
    # 链尾=输出未被「其他激活节点」消费者(边目标为旁路件不算消费)
    active_ids = {x["id"] for x in active}
    consumed = {oid_ for tid, (oid_, _os) in inner_edges.items()
                if tid in active_ids and oid_ in active_ids}
    tails = [x for x in active if x["id"] not in consumed]
    if len(tails) != 1:
        raise RuntimeError(f"子图链尾不唯一({len(tails)} 个): 拓扑异常")
    return entries, f"{host_id}.{tails[0]['id']}"


def _expand_routed_subgraph(sg: dict, oi: dict, host_id, host_inputs, nodes, links, main_base):
    """v9 按型分流子图展开:只展开 base 型对应行(其余 8 行剪枝),Route 省略=行尾直通。

    main_base=主图侧型值([80] widgets;优先),fallback=子图内 Route widgets[0]。
    行→型映射=行尾连到 Route 的槽位(槽 i+1=NINE[i],v9 生成器保证)。
    """
    route = next(x for x in sg["nodes"] if x["type"] == "MyDaojieRoute")
    base = main_base or (route.get("widgets_values") or ["人物"])[0]
    sgn = {x["id"]: x for x in sg["nodes"]}
    in_edge = {}   # tid -> (oid, oslot) 单入边(loader 链)
    route_slots = {}  # slot -> origin_id(行尾)
    for l in sg.get("links", []):
        if isinstance(l, dict):
            oid_, oslot, tid, tslot = l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"]
        else:
            _, oid_, oslot, tid, tslot = l[:5]
        if tid == route["id"]:
            route_slots[tslot] = oid_
        else:
            in_edge[tid] = (oid_, oslot)
    NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
    if base not in NINE:
        raise RuntimeError(f"按型路由:未知型 {base!r}")
    _nslot = {s.get("name"): i for i, s in enumerate(route.get("inputs") or [])}
    _slot = _nslot.get(base)
    if _slot is None:
        raise RuntimeError(f"按型路由:Route 无 {base!r} 输入槽")
    tail_inner = route_slots.get(_slot)
    if tail_inner is None:
        raise RuntimeError(f"型「{base}」线路未接 Route")
    # 从行尾反向走到行首
    chain = [tail_inner]
    while True:
        e = in_edge.get(chain[0])
        if e is None or e[0] == -10:
            break
        chain.insert(0, e[0])
    entries, api_of_inner = {}, {}
    for iid in chain:
        x = sgn[iid]
        cls = x["type"]
        order = (list(oi[cls]["input"].get("required", {}).keys())
                 + list(oi[cls]["input"].get("optional", {}).keys()))
        wv = x.get("widgets_values") or []
        inputs = {}
        for name in order:
            if any(s.get("name") == name for s in (x.get("inputs") or [])):
                if iid == chain[0]:  # 行首=宿主 model 源
                    host_lid = next((s.get("link") for s in (host_inputs or []) if s.get("name") == "model"), None)
                    if host_lid is None or host_lid not in links:
                        raise RuntimeError("按型路由:宿主 model 输入线缺失")
                    up = links[host_lid]
                    src, out_slot = _resolve_src(nodes, links, up[1], up[2])
                    inputs[name] = [str(src), out_slot]
                else:
                    prev = api_of_inner[in_edge[iid][0]]
                    inputs[name] = prev
            elif name not in UI_ONLY_WIDGETS:
                idx = [n for n in order if not any(s.get("name") == n for s in (x.get("inputs") or []))
                       and n not in UI_ONLY_WIDGETS].index(name)
                if idx < len(wv):
                    inputs[name] = wv[idx]
        api_id = f"{host_id}.{iid}"
        api_of_inner[iid] = [api_id, 0]
        entries[api_id] = {"class_type": cls, "inputs": inputs}
    return entries, f"{host_id}.{tail_inner}", base


def ui_to_api(wf: dict, oi: dict, overrides: dict[str, object]) -> dict:
    """UI 格式 → API 格式(object_info+named widgets 对齐;[64] 类无 named 者位置回退)。"""
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf.get("links", [])}
    bypassed = {nid for nid, n in nodes.items() if n.get("mode") == 4}
    if bypassed:
        print(f"[livefire] 旁路节点不入 API 图(mode=4): {sorted(bypassed)}", flush=True)
    prompt: dict[str, dict] = {}
    # 第一遍:子图节点链式展开(v8 聚合退役后子图内为真实 loader 链)
    sub_tail: dict[str, str] = {}
    for nid, n in nodes.items():
        if nid in SKIP_NODES or n["type"] in SKIP_TYPES or n.get("mode") == 4:
            continue
        if n["type"] not in oi:
            sg = next((s for s in wf.get("definitions", {}).get("subgraphs", [])
                       if s.get("id") == n["type"]), None)
            if sg and any(x["type"] == "MyDaojieRoute" for x in sg["nodes"]):
                # v9 按型分流:型值优先取主图 [80](经 [90].base 线)
                main_base = None
                blid = next((s.get("link") for s in (n.get("inputs") or []) if s.get("name") == "base"), None)
                if blid is not None and blid in links:
                    src80 = links[blid][1]
                    n80 = nodes.get(src80)
                    if n80 is not None:
                        main_base = (n80.get("widgets_values_named") or {}).get("base") \
                            or (n80.get("widgets_values") or [None])[0]
                entries, tail, used_base = _expand_routed_subgraph(sg, oi, nid, n.get("inputs"), nodes, links, main_base)
                prompt.update(entries)
                sub_tail[str(nid)] = tail
                print(f"[livefire] 按型路由展开: 节点{nid} 型={used_base} → {len(entries)} 件, 尾 {tail}", flush=True)
            elif sg and not any(x["type"] == "MyDaojieLoraStack" for x in sg["nodes"]):
                entries, tail = _expand_subgraph_chain(sg, oi, nid, n.get("inputs"), nodes, links)
                prompt.update(entries)
                sub_tail[str(nid)] = tail
                print(f"[livefire] 子图链式展开: 节点{nid} → {len(entries)} 激活节点, 链尾 {tail}", flush=True)
    for nid, n in nodes.items():
        if nid in SKIP_NODES or n["type"] in SKIP_TYPES or nid in bypassed:
            continue
        if str(nid) in sub_tail:
            continue  # 子图宿主已链式展开(见第一遍)
        cls = n["type"]
        if cls not in oi:
            # 子图节点(type=uuid):展开为子图内部的执行节点(非注释/非IO)
            sg = None
            for s in wf.get("definitions", {}).get("subgraphs", []):
                if s.get("id") == cls or s.get("name") == n.get("properties", {}).get("subgraph_name"):
                    sg = s; break
            if sg is None:
                for s in wf.get("definitions", {}).get("subgraphs", []):
                    if s.get("id") == cls:
                        sg = s; break
            if sg:
                inner = [x for x in sg["nodes"] if x["type"] in oi]
                if inner:
                    cls = inner[0]["type"]
                    print(f"[livefire] 子图展开: 节点{nid} {n['type'][:8]}…→{cls}", flush=True)
        order = (list(oi[cls]["input"].get("required", {}).keys())
                 + list(oi[cls]["input"].get("optional", {}).keys()))
        named = n.get("widgets_values_named") or {}
        wv = n.get("widgets_values") or []
        linked = {}
        for slot_def in n.get("inputs") or []:
            lid = slot_def.get("link")
            if lid is None or lid not in links:
                continue
            src = links[lid][1]
            if src in SKIP_NODES:
                continue  # 被跳过源的连线一律由覆盖内联
            src, out_slot = _resolve_src(nodes, links, src, links[lid][2])
            if str(src) in sub_tail:
                src, out_slot = sub_tail[str(src)], out_slot
            linked[slot_def["name"]] = [str(src), out_slot]
        inputs: dict[str, object] = {}
        positional: list[str] = []  # 未连线、非 UI-only、named 又缺席的 widget 序输入
        for name in order:
            if name in linked:
                inputs[name] = linked[name]
            elif name in named:
                inputs[name] = named[name]
            elif name not in UI_ONLY_WIDGETS:
                positional.append(name)
        if positional:
            # 位置回退:widget 值按 object_info 输入序对齐 widgets_values
            # (本流命中者:[64] PrimitiveStringMultiline 的 value=负向基线)
            if len(positional) == len(wv):
                for name, val in zip(positional, wv):
                    inputs[name] = val
                print(f"[livefire] 节点{nid} {cls} 位置回退: "
                      f"{dict(zip(positional, (str(v)[:40] + '…' for v in wv)))}", flush=True)
            else:
                raise RuntimeError(
                    f"节点{nid} {cls} 位置回退对不齐: 待填 {positional} vs widgets {wv!r}")
        leftover = {k for k in named if k not in order and k not in UI_ONLY_WIDGETS}
        if leftover:
            # easy showAnything 的 named.text 不在 API 输入序里,属显示件残留,警告不阻断
            print(f"[livefire] 警告: 节点{nid} {cls} named 键 {leftover} 不在输入序(显示件残留,忽略)",
                  flush=True)
        if not inputs:
            raise RuntimeError(f"节点{nid} {cls} 映射为空")
        prompt[str(nid)] = {"class_type": cls, "inputs": inputs}
    for key, val in overrides.items():
        nid_s, field = key.split(".", 1)
        prompt[nid_s]["inputs"][field] = val
    return prompt


def wait_idle(base: str) -> None:
    t0 = time.time()
    while True:
        q = http_json(f"{base}/queue", timeout=10)
        if not q.get("queue_running") and not q.get("queue_pending"):
            return
        if time.time() - t0 > IDLE_WAIT_MAX_S:
            raise RuntimeError("等待引擎空闲超时(用户任务持续占用,上限 10 分钟)")
        time.sleep(POLL_S)


def main() -> int:
    ap = argparse.ArgumentParser(description="道劫工作流实弹验证(单发)")
    ap.add_argument("--base-url", default=BASE_URL_DEFAULT)
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    # 09-18 v2.2 定性切换:底座真源=daojie_bases.json 人物型(新中式+线描层);
    # 主体句=工作流现行 [50](v2.2 新定性+手部锚),不再拿 0917 md 旧示例覆写
    bases = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/"
                        "daojie_bases.json").read_text(encoding="utf-8"))
    base_text = next(e["positive"] for e in bases if e.get("key") == "人物")
    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    subject = next(n["widgets_values"][0] for n in wf["nodes"] if n.get("id") == 50)
    oi = http_json(f"{base}/object_info", timeout=60)

    overrides = {
        "12.seed": SEED,           # 内联字面量(绕开 rgthree 种子件);[50]保持工作流现值
    }
    graph = ui_to_api(wf, oi, overrides)

    wait_idle(base)
    t0 = time.time()
    resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
    if resp.get("node_errors"):
        print(json.dumps({"status": "node_errors", "detail": resp["node_errors"]},
                         ensure_ascii=False), flush=True)
        return 1
    pid = resp["prompt_id"]
    print(f"[livefire] 已提交 prompt_id={pid} seed={SEED} 速度档默认参数", flush=True)

    entry = None
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            entry = hist[pid]
            break
        time.sleep(POLL_S)
    if entry is None:
        print(json.dumps({"status": "timeout", "prompt_id": pid}, ensure_ascii=False), flush=True)
        return 1
    status = entry.get("status", {})
    if status.get("status_str") != "success":
        msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
        print(json.dumps({"status": "execution_failed", "detail": msgs[:1]},
                         ensure_ascii=False), flush=True)
        return 1
    wall_s = round(time.time() - t0, 1)

    # ── 校验最终正向([62] 回读的 ui.text 与喂给 [51] 的是同一根 [72] 输出) ──
    final = None
    out62 = (entry.get("outputs") or {}).get("62") or {}
    texts = out62.get("text") or []
    if isinstance(texts, list) and texts and isinstance(texts[0], str):
        final = texts[0]
    if final is None:
        print(json.dumps({"status": "verify_failed", "reason": "history 无节点62文本输出",
                          "outputs_keys": list((entry.get("outputs") or {}).keys())},
                         ensure_ascii=False), flush=True)
        return 1
    ok_head = final.startswith(base_text)
    ok_subj = "一位女修士" in final
    if not (ok_head and ok_subj):
        print(json.dumps({"status": "verify_failed", "head_ok": ok_head, "subject_ok": ok_subj,
                          "final_head_120": final[:120]}, ensure_ascii=False), flush=True)
        return 1
    exact_note = ("exact=底座+主体句" if final == base_text + subject
                  else "warn:最终正向≠底座+主体句逐字拼接(两道硬门已过,人工看一眼)")

    # ── 取成图(节点 [4] SaveImage)并经 /view 下载 ──
    image = None
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and "filename" in x:
                        image = x
    if image is None:
        print(json.dumps({"status": "no_image", "prompt_id": pid}, ensure_ascii=False), flush=True)
        return 1
    q = (f"filename={urllib.parse.quote(image['filename'])}"
         f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
    png = http_bytes(f"{base}/view?{q}")
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    OUT_PNG.write_bytes(png)

    summary = {
        "status": "ok",
        "prompt_id": pid,
        "image": str(OUT_PNG),
        "engine_image": image["filename"],
        "bytes": len(png),
        "wall_s": wall_s,
        "seed": SEED,
        "final_positive_head_120": final[:120],
        "concat_check": exact_note,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
