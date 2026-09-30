# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""批量队列治理四协议工具(TE-MAN B5 设计吸收·自研实现,任务 09-29-teman-b5-batch-queue)。

四协议(编排层行为,住脚本=不改引擎面、不进节点包、免打包):
  1. 断点续跑 —— 拍号→产物指纹台账(ndjson,逐事件追加);重跑跳过台账已完成拍;
     --start N 的 N 以原序拍号为准(1 基);随机序只作用于未完成拍集合。
  2. 间隔节流 —— 相邻两次 queuePrompt 提交之间强制 --interval 秒(默认 2)。
  3. 随机序   —— --random 洗牌未完成拍集合;--seed 定种子可复现。
  4. 精确停队 —— 只 POST /queue {"delete":[自持 prompt_id…]},绝不清全队
     (引擎契约:delete 项按 prompt_id 逐单精确删;{"clear":true} 对他方单有
     杀伤,禁用);/interrupt 带 prompt_id 只对「自己且正在跑」的单生效。

技术路线(graphToPrompt 等价链,逐段落地):
  工作流 JSON →(object_info 陪衬的 widget 槽序映射)→ API prompt
  → deepClone → 改拍变量(index)→ 连线闭包裁剪(从产物节点反向收集依赖,
  只执行当前线)→ queuePrompt 循环。

已知坑内置:
  - queue running 挂尸(僵尸单):/queue 报 running ≠ 真在算;真相源=引擎日志
    进度行(<引擎家>/logs/engine.log 的「Prompt executed in … seconds」);拍超时
    自动 tail 进度行给判决;remedy=stop 子命令(定向 interrupt 自家 + delete
    自家 pending)。
  - 输出文件名并发覆盖:每拍独立 filename_prefix(base_0001 形,ComfyUI 计数器
    竞态在异前缀下天然错开);--prefix-node/--prefix-field 显式指到 SaveImage
    才生效(指了才改,不猜节点)。

防误配置预检(七条 low 修补,09-30 收尾批,误配即报不静默):
  - 写入目标预检(--var-*/--prefix-* 通用):节点在闭包内+槽存在+非连线槽,
    指错即打印报错退 2(不再 KeyError 裸栈/覆写连线引擎逐拍 400)。
  - 闭包内悬空连线预检:源节点转换失败未进 API 图时,其硬伤主语不在闭包被
    过滤(漏报)——按闭包图直扫补上,引擎 400 前拦下。
  - 续跑预检:引擎仍压自家 pending(上次中断残留)即拦,提示先 stop(防双跑)。
  - queue_ahead>1 未配 --prefix-node:同前缀并发覆盖警示(不拦)。
  - 提交回执即时落账(中断兜底补记):关死「回执↔台账」窗口,stop 不缺单。
  - 单拍超时仍在 pending=queue_ahead>1 排队等待计入超时(误判),重置时钟
    续等(重置次数封顶 MAX_PENDING_RESETS:永压 pending——如他方挂尸堵队——
    不无限续等,超顶落僵尸判决);真挂尸(running 无进度)判决照走。

引擎口现算(禁抄旧端口常量):MYSTUDIO_COMFYUI_BRIDGE_URL 覆写 →
  <引擎家>/manifest.json 的 engine.port;引擎家=MYSTUDIO_COMFYUI_HOME 覆写 →
  ~/Library/Application Support/漫影工作室/comfyui。引擎无鉴权。

用法(引擎须已运行;台账与产物互不冲突,产物仍按工作流自身配置落引擎 output):
  python3 batch_queue.py run --workflow wf.json \\
      --var-node 207 --var-field seed --var-values 11 22 33 \\
      --prefix-node 9 --prefix-base mybatch \\
      [--start 2] [--random --seed 42] [--interval 2] [--queue-ahead 1] \\
      [--ledger mybatch.ndjson] [--shot-timeout 1800] [--auto-interrupt]
  python3 batch_queue.py status --ledger mybatch.ndjson
  python3 batch_queue.py stop   --ledger mybatch.ndjson [--interrupt-running]
  python3 batch_queue.py --self-test   # 纯逻辑断言,零 IO 零引擎

分层纪律:纯逻辑(转换/克隆/闭包/拍计划/台账/停队集合/指纹)零 IO 可直测
(--self-test 只碰这一层);网络与文件读写收在 IO 层与 CLI。零三方依赖,
系统 python3 可跑。
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_ENGINE_HOME = Path.home() / "Library" / "Application Support" / "漫影工作室" / "comfyui"
CLIENT_ID = "my-batch-queue"

# 僵尸单真相源:引擎 stdout 日志的完成进度行(引擎 server 侧按拍打点)。
PROGRESS_LINE_RE = re.compile(r"Prompt executed in [\d.]+ seconds")
# 转换报告行的主语节点抽取(`!! node=5 slot=…` 的 5)。
REPORT_NODE_RE = re.compile(r"node=([^\s]+)")

# UI 工作流节点 mode:4=muted(从不执行);2=bypass(旁路)。两者都不进 API 图,
# 摘除留痕在 report;消费其输出的在册节点会单独报硬伤。
MUTED_MODES = {2, 4}
SKIP_TYPES = {"MarkdownNote", "Note"}
SEED_CONTROLS = {"fixed", "increment", "decrement", "randomize"}


# ───────────────────────── 纯逻辑层(零 IO) ─────────────────────────

def deep_clone(obj):
    """deepClone 等价:整图深拷贝,拍与拍之间互不串写。"""
    return copy.deepcopy(obj)


def is_link(value) -> bool:
    """API prompt 连线值判定:[源节点 id(str), 槽位(int)];bool 不算 int。"""
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and isinstance(value[1], int)
        and not isinstance(value[1], bool)
    )


def _node_sort_key(nid: str):
    return (0, int(nid), "") if nid.isdigit() else (1, 0, nid)


def closure_prune(prompt: dict, output_node_ids) -> dict:
    """连线闭包裁剪:从产物节点反向收集依赖闭包,只保留当前线。

    其余支路(预览线/旁路选择支路等)整支剔除——引擎侧只校验、只执行当前线,
    防整图重算,也防无关支路的校验连坐。缺号节点如实跳过(断线由转换报告管)。
    """
    keep: set[str] = set()
    stack = [str(n) for n in output_node_ids]
    while stack:
        nid = stack.pop()
        if nid in keep or nid not in prompt:
            continue
        keep.add(nid)
        for value in prompt[nid].get("inputs", {}).values():
            if is_link(value) and value[0] in prompt:
                stack.append(value[0])
    return {nid: prompt[nid] for nid in sorted(keep, key=_node_sort_key)}


def resolve_output_nodes(prompt: dict, explicit) -> list[str]:
    """产物节点:显式 --output-nodes 优先;缺省=图内无出边的汇点。"""
    if explicit:
        return [str(n) for n in explicit]
    has_outgoing: set[str] = set()
    for entry in prompt.values():
        for value in entry.get("inputs", {}).values():
            if is_link(value):
                has_outgoing.add(value[0])
    sinks = [nid for nid in prompt if nid not in has_outgoing]
    if not sinks:
        raise SystemExit("[batch-queue] 图内无汇点,请显式 --output-nodes 指定产物节点")
    return sorted(sinks, key=_node_sort_key)


def _widget_slot_names(class_info: dict, connected: set[str]) -> list[str]:
    """widget 槽序=object_info required+optional 键序,剔除已连线槽。"""
    order = list(class_info.get("input", {}).get("required", {}).keys())
    order += list(class_info.get("input", {}).get("optional", {}).keys())
    return [name for name in order if name not in connected]


def graph_to_prompt(wf: dict, object_info: dict):
    """UI 工作流 → API prompt(graphToPrompt 等价;object_info 定 widget 槽序)。

    返回 (prompt, report);report 为诊断行(skip=摘除/note=残余/!!=硬伤),
    硬伤行主语节点用 `node=<id>` 标注,供闭包内复核(裁掉支路上的硬伤不算数)。
    """
    nodes = {n["id"]: n for n in wf.get("nodes", [])}
    links = {l[0]: l for l in wf.get("links", [])}  # id -> [id, from, slot, to, toslot, type]
    prompt: dict = {}
    report: list[str] = []
    for nid, node in nodes.items():
        cls = node.get("type", "")
        if cls in SKIP_TYPES:
            continue
        if node.get("mode") in MUTED_MODES:
            report.append(f"skip node={nid} mode={node['mode']} {cls}")
            continue
        if cls not in object_info:
            report.append(f"!! node={nid} {cls} 不在 object_info(引擎未装该节点?)")
            continue
        link_inputs: dict = {}
        for slot in node.get("inputs") or []:
            lid = slot.get("link")
            if lid is None or lid not in links:
                continue
            src = links[lid][1]
            src_node = nodes.get(src)
            if src_node is None:
                report.append(f"!! node={nid} slot={slot.get('name')} 连线源 node={src} 不在图内")
                continue
            if src_node.get("mode") in MUTED_MODES or src_node.get("type") in SKIP_TYPES:
                report.append(
                    f"!! node={nid} slot={slot.get('name')} 由已摘除节点 node={src}({src_node.get('type')}) 供源"
                )
                continue
            link_inputs[slot["name"]] = [str(src), links[lid][2]]
        widget_names = _widget_slot_names(object_info[cls], set(link_inputs))
        named = node.get("widgets_values_named") or {}
        positional = list(node.get("widgets_values") or [])
        inputs = dict(link_inputs)
        vi = 0
        for name in widget_names:
            if name in named:
                inputs[name] = named[name]
                continue
            if vi >= len(positional):
                report.append(f"!! node={nid} {cls} widget 槽 {name} 无值(widgets_values 长度不足)")
                continue
            value = positional[vi]
            vi += 1
            if (
                name in ("seed", "noise_seed")
                and vi < len(positional)
                and isinstance(positional[vi], str)
                and positional[vi] in SEED_CONTROLS
            ):
                vi += 1  # control_after_generate 紧随 seed 的固定位,一并消费
            inputs[name] = value
        if vi < len(positional):
            report.append(f"note node={nid} {cls} widgets_values 残余 {positional[vi:]!r}")
        prompt[str(nid)] = {"class_type": cls, "inputs": inputs}
    return prompt, report


def report_node_id(line: str):
    m = REPORT_NODE_RE.search(line)
    return m.group(1) if m else None


def hard_errors_in_closure(report: list[str], closure_ids: set[str]) -> list[str]:
    """硬伤行(!!开头)按闭包过滤:被裁掉的支路上的问题不拦当前线。"""
    out = []
    for line in report:
        if not line.startswith("!!"):
            continue
        nid = report_node_id(line)
        if nid is None or nid in closure_ids:
            out.append(line)
    return out


def dangling_links_in_closure(prompt: dict) -> list[str]:
    """闭包内悬空连线预检:值是连线但源节点不在闭包图内(引擎 400 拒单)。

    成因=源节点在 graph_to_prompt 转换失败(类不在 object_info 等)未进 API 图,
    闭包收集沿连线走不到它;其 `!!` 硬伤主语(源节点)又不在闭包内被
    hard_errors_in_closure 过滤——两头漏报,此处按闭包图直扫补上。
    """
    out = []
    for nid, entry in prompt.items():
        for field, value in entry.get("inputs", {}).items():
            if is_link(value) and value[0] not in prompt:
                out.append(f"node={nid} slot={field} 连线源 node={value[0]} 不在闭包图内(引擎将 400)")
    return out


def set_shot_variable(prompt: dict, node_id, field: str, value) -> None:
    """改 index:把拍变量写进拍图(deepClone 之后)。槽不存在=硬错防静默空拍。"""
    entry = prompt.get(str(node_id))
    if entry is None or field not in entry.get("inputs", {}):
        raise KeyError(
            f"节点 #{node_id} 无输入槽 {field}(核对 --var-node/--var-field;"
            f"若节点被闭包裁掉,检查 --output-nodes)"
        )
    entry["inputs"][field] = value


def field_target_error(prompt: dict, node_id, field: str, option: str) -> str | None:
    """写入目标预检(--var-*/--prefix-* 通用):节点在闭包内+槽存在+非连线槽。

    三型误配置各给一行报错(调用方照预检风格打印后 return 2,不裸栈):
    节点被闭包裁掉/槽不存在(原=提交期 KeyError 裸栈)/槽是连线(写入会覆盖
    连线,引擎逐拍 400)。返回 None=可写。
    """
    entry = prompt.get(str(node_id))
    if entry is None:
        return f"--{option}-node {node_id} 不在闭包内(被裁掉?),核对 --output-nodes"
    if field not in entry.get("inputs", {}):
        return f"节点 #{node_id} 无输入槽 {field}(核对 --{option}-field)"
    value = entry["inputs"][field]
    if is_link(value):
        return (
            f"节点 #{node_id} 槽 {field} 是连线槽(接自 node {value[0]}),"
            f"写入会覆盖连线,引擎将逐拍 400;--{option}-field 请指 widget 槽"
        )
    return None


def coerce_like(existing, raw: str):
    """按槽位现值类型收编 CLI 字符串(--var-values 传的都是文本)。"""
    if isinstance(existing, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(existing, int):
        try:
            return int(raw)
        except ValueError:
            return raw
    if isinstance(existing, float):
        try:
            return float(raw)
        except ValueError:
            return raw
    return raw


def plan_batch(total_shots: int, start_shot: int, completed: set, rng) -> list[int]:
    """拍计划(断点续跑×随机序的组合语义,任务档 design §7 拍板口径):
    拍号 1 基、以原序台账为准;completed(台账已完成)永远跳过;--start 再压一条
    「< N 全部不做」的下界;随机序仅洗牌剩余集合,不改变「第 N 号」的指称。"""
    if total_shots < 1:
        raise ValueError("total_shots 至少为 1")
    if start_shot < 1:
        raise ValueError("start_shot 从 1 起")
    remaining = [s for s in range(1, total_shots + 1) if s >= start_shot and s not in completed]
    if rng is not None:
        rng.shuffle(remaining)
    return remaining


def parse_ledger(lines):
    """台账 ndjson(逐事件追加)→ (按拍归并的最新事件, 自持 prompt_id 集, 坏行报告)。

    事件:event=plan|submit|done|error|zombie|stop;shot=1 基拍号;prompt_id=提交
    回执(prompt_id 记账=精确停队的身份底册)。同拍多事件=最后一次为准
    (error 后重跑 done 才能表达「重试成功」)。
    """
    latest: dict[int, dict] = {}
    own_ids: set[str] = set()
    bad: list[str] = []
    for lineno, raw in enumerate(lines, 1):
        raw = raw.strip()
        if not raw:
            continue
        try:
            rec = json.loads(raw)
        except json.JSONDecodeError:
            bad.append(f"line {lineno}: 非 JSON")
            continue
        if not isinstance(rec, dict) or "event" not in rec:
            bad.append(f"line {lineno}: 缺 event 键")
            continue
        pid = rec.get("prompt_id")
        if isinstance(pid, str) and pid:
            own_ids.add(pid)
        shot = rec.get("shot")
        if isinstance(shot, int) and isinstance(shot, bool) is False and shot >= 1:
            latest[shot] = rec
    return latest, own_ids, bad


def completed_shots(latest: dict) -> set[int]:
    """台账跳号:最后一次事件为 done 的拍集合。"""
    return {shot for shot, rec in latest.items() if rec.get("event") == "done"}


def queue_ids(snapshot: dict, key: str) -> list[str]:
    """GET /queue 快照 → 指定键(running/pending)的 prompt_id 序列([1] 位)。"""
    out = []
    for item in snapshot.get(key, []) or []:
        if isinstance(item, (list, tuple)) and len(item) > 1:
            out.append(str(item[1]))
    return out


def own_pending(own_ids, snapshot: dict) -> list[str]:
    """精确停队目标=自持 id ∩ 引擎 pending;他方单不在 own_ids,永不误删。"""
    pending = set(queue_ids(snapshot, "queue_pending"))
    return sorted(own_ids & pending)


def own_running(own_ids, snapshot: dict) -> list[str]:
    running = set(queue_ids(snapshot, "queue_running"))
    return sorted(own_ids & running)


# 预检⑥重置封顶(0930 收尾 F3):超时×pending 的续等豁免次数上限——永压
# pending(如他方挂尸堵队,自家单永远排不上)不再无限续等;总等待约
# (1+上限)×shot_timeout 后落僵尸判决,remedy=stop 精确删自家 pending。
MAX_PENDING_RESETS = 3


def pending_timeout_action(in_pending: bool, resets_done: int = 0) -> str:
    """预检⑥决策核心(超时已触发后的去向;纯逻辑零 IO,--self-test 直测)。

    "reset"=仍在引擎 pending(queue_ahead>1 排队等待计入超时=误判豁免)→
    重置时钟续等,豁免次数封顶 MAX_PENDING_RESETS;"zombie"=非 pending,
    或豁免耗尽(永压 pending)→走僵尸单判决。
    """
    if in_pending and resets_done < MAX_PENDING_RESETS:
        return "reset"
    return "zombie"


def unique_prefix(base: str, shot: int) -> str:
    """每拍独立前缀防并发覆盖:异前缀下 SaveImage 计数器竞态天然错开。"""
    safe = re.sub(r"[^0-9A-Za-z_-]+", "_", (base or "").strip()) or "batch"
    return f"{safe}_{shot:04d}"


def output_fingerprint(outputs: dict):
    """产物指纹:history.outputs → 排序文件清单 + sha256 前 16 位(台账防拍错认)。"""
    files = []
    for nid, out in (outputs or {}).items():
        if not isinstance(out, dict):
            continue
        for items in out.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, dict) and "filename" in item:
                    files.append(
                        {
                            "node": str(nid),
                            "filename": item["filename"],
                            "subfolder": item.get("subfolder", ""),
                            "type": item.get("type", "output"),
                        }
                    )
    files.sort(key=lambda f: (f["filename"], f["subfolder"], f["node"]))
    digest = hashlib.sha256(
        json.dumps(files, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:16]
    return digest, files


# ───────────────────────── IO 层(网络/文件) ─────────────────────────

def engine_home() -> Path:
    """引擎家:MYSTUDIO_COMFYUI_HOME 覆写 → 装机默认位。"""
    override = os.environ.get("MYSTUDIO_COMFYUI_HOME", "")
    if override:
        return Path(override).expanduser()
    return DEFAULT_ENGINE_HOME


def resolve_engine_url() -> tuple[str, Path]:
    """引擎口现算:MYSTUDIO_COMFYUI_BRIDGE_URL 覆写 → manifest.engine.port。

    禁抄旧端口常量:账本无口=引擎未装/账本异常,如实退出,不回落任何默认口。
    """
    override = os.environ.get("MYSTUDIO_COMFYUI_BRIDGE_URL", "")
    if override:
        return override.rstrip("/"), engine_home()
    home = engine_home()
    manifest_path = home / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(
            f"[batch-queue] 读不到引擎账本 {manifest_path}({exc});引擎未装?"
            f"或用 MYSTUDIO_COMFYUI_HOME 指引擎家"
        )
    engine = manifest.get("engine") if isinstance(manifest.get("engine"), dict) else {}
    port = engine.get("port")
    if not (isinstance(port, int) and 0 < port < 65536):
        raise SystemExit(f"[batch-queue] 账本 {manifest_path} 无 engine.port,拒绝猜口")
    return f"http://127.0.0.1:{port}", home


def http_json(method: str, url: str, payload=None, timeout: float = 30.0) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {exc.code} {method} {url}: {detail[:800]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"连不上 {url}: {exc.reason}(引擎没起?口以 <引擎家>/manifest.json 的 engine.port 为准)"
        ) from exc
    return json.loads(body) if body else {}


class Engine:
    """引擎 HTTP 薄封装(无鉴权;所有写操作只认自持 prompt_id)。"""

    def __init__(self, base_url: str, home: Path):
        self.base = base_url
        self.home = home

    def object_info(self) -> dict:
        return http_json("GET", f"{self.base}/object_info", timeout=180)

    def submit(self, prompt: dict) -> dict:
        return http_json("POST", f"{self.base}/prompt", {"prompt": prompt, "client_id": CLIENT_ID}, timeout=60)

    def history(self, prompt_id: str) -> dict:
        return http_json("GET", f"{self.base}/history/{prompt_id}", timeout=30)

    def queue(self) -> dict:
        return http_json("GET", f"{self.base}/queue", timeout=30)

    def delete_pending(self, own_ids) -> list[str]:
        """精确停队(协议4):只删这些 prompt_id∩pending,绝不清全队。"""
        snap = self.queue()
        victims = own_pending(set(own_ids), snap)
        if victims:
            http_json("POST", f"{self.base}/queue", {"delete": victims}, timeout=30)
        return victims

    def interrupt(self, prompt_id: str) -> None:
        """定向打断:引擎只在该 id 正在跑时才真动(带 prompt_id 的 /interrupt)。"""
        http_json("POST", f"{self.base}/interrupt", {"prompt_id": prompt_id}, timeout=30)

    def log_progress_lines(self, max_lines: int = 6) -> tuple[list[str], float]:
        """僵尸单真相源:引擎 stdout 日志尾部的进度行 + 文件 mtime。"""
        path = self.home / "logs" / "engine.log"
        try:
            mtime = path.stat().st_mtime
            with path.open("rb") as fh:
                fh.seek(0, os.SEEK_END)
                size = fh.tell()
                fh.seek(max(0, size - 65536))
                text = fh.read().decode("utf-8", "replace")
        except OSError:
            return [], 0.0
        hits = [ln.strip() for ln in text.splitlines() if PROGRESS_LINE_RE.search(ln)]
        return hits[-max_lines:], mtime


def ledger_append(path: Path, event: str, **fields) -> dict:
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event}
    rec.update(fields)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec


def read_ledger_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []


# ───────────────────────── CLI:run(四协议批量循环) ─────────────────────────

def _print_zombie_verdict(engine: Engine, shot: int, pid: str, shot_timeout: float) -> None:
    print(f"[shot {shot}] 超时 {shot_timeout:.0f}s 且 /history 无果——僵尸单嫌疑({pid})")
    lines, mtime = engine.log_progress_lines()
    if lines:
        stamp = time.strftime("%H:%M:%S", time.localtime(mtime)) if mtime else "?"
        print(f"  引擎日志进度行(真相源,engine.log mtime={stamp}):")
        for ln in lines:
            print(f"    {ln}")
        print("  ↑ 有新进度行=引擎真在算(放宽 --shot-timeout);无新行=挂尸,走 stop")
    else:
        print("  引擎日志无进度行可对照(挂尸概率大)")
    print(f"  remedy: python3 {sys.argv[0]} stop --ledger <台账> [--interrupt-running]")


def cmd_run(args) -> int:
    url, home = resolve_engine_url()
    engine = Engine(url, home)
    print(f"[batch-queue] 引擎 {url}(家 {home})")

    wf = json.loads(Path(args.workflow).read_text(encoding="utf-8"))
    oi = engine.object_info()
    base_prompt, report = graph_to_prompt(wf, oi)
    for line in report:
        print(f"  {line}")

    output_ids = resolve_output_nodes(base_prompt, args.output_nodes)
    line_prompt = closure_prune(base_prompt, output_ids)
    print(f"[batch-queue] 闭包裁剪:保留 {len(line_prompt)}/{len(base_prompt)} 节点(产物 {'/'.join(output_ids)})")
    hard = hard_errors_in_closure(report, set(line_prompt))
    if hard:
        print(f"[batch-queue] 当前线上有 {len(hard)} 条转换硬伤,先处理后跑:")
        for line in hard:
            print(f"    {line}")
        return 2

    # 防误配置预检④:闭包内悬空连线(源节点转换失败未进 API 图,硬伤闭包过滤
    # 漏报;引擎 400 拒单前在此拦下)
    dangling = dangling_links_in_closure(line_prompt)
    if dangling:
        print(f"[batch-queue] 闭包内有 {len(dangling)} 条悬空连线(引擎将 400 拒单),先处理后跑:")
        for line in dangling:
            print(f"    {line}")
        return 2

    # 防误配置预检①:写入目标(节点在闭包内+槽存在+非连线槽),var 与 prefix 同规
    var_err = field_target_error(line_prompt, args.var_node, args.var_field, "var")
    if var_err:
        print(f"[batch-queue] {var_err}")
        return 2
    existing = line_prompt[str(args.var_node)]["inputs"][args.var_field]
    if args.prefix_node is not None:
        prefix_err = field_target_error(line_prompt, args.prefix_node, args.prefix_field, "prefix")
        if prefix_err:
            print(f"[batch-queue] {prefix_err}")
            return 2

    values = args.var_values
    total = len(values)
    ledger = Path(args.ledger) if args.ledger else Path.cwd() / (Path(args.workflow).stem + ".ndjson")
    latest, own_ids, bad = parse_ledger(read_ledger_lines(ledger))
    for line in bad:
        print(f"  台账坏行(忽略): {line}")
    completed = completed_shots(latest)

    # 防误配置预检③:续跑先查引擎残留自家 pending(上次中断的残留单)——
    # 不查则同拍双跑(前缀防覆盖只保文件名,不保算力);remedy=先精确停队
    stale_pending = own_pending(own_ids, engine.queue())
    if stale_pending:
        shown = ", ".join(stale_pending[:4]) + ("…" if len(stale_pending) > 4 else "")
        print(f"[batch-queue] 引擎仍压着自家 pending {len(stale_pending)} 单({shown});")
        print(f"  直接续跑会双跑,先精确停队: python3 {sys.argv[0]} stop --ledger {ledger}")
        return 2

    # 防误配置预检⑤:并发在飞无逐拍前缀=同前缀 SaveImage 计数器竞态可覆盖(警示不拦)
    if args.queue_ahead > 1 and args.prefix_node is None:
        print(
            f"[batch-queue] 警示:--queue-ahead {args.queue_ahead}>1 且未配 --prefix-node,"
            f"多拍同前缀并发出图,SaveImage 计数器竞态可致同名覆盖;"
            f"建议 --prefix-node <SaveImage id> --prefix-base <基名> 每拍独立前缀"
        )

    rng = random.Random(args.seed) if args.random else None
    plan = plan_batch(total, args.start, completed, rng)
    print(
        f"[batch-queue] 共 {total} 拍,台账已完成 {len(completed)} 拍{{{''.join(str(c) + ',' for c in sorted(completed)).rstrip(',')}}},"
        f"--start={args.start},随机序={'on(seed=' + str(args.seed) + ')' if args.random else 'off'}"
    )
    print(f"[batch-queue] 台账 {ledger};计划执行顺序 {plan}")
    ledger_append(
        ledger, "plan", total=total, start=args.start, random=bool(args.random),
        seed=args.seed, interval=args.interval, queue_ahead=args.queue_ahead, shots=plan,
    )

    inflight: dict[str, int] = {}
    submitted_at: dict[str, float] = {}
    pending_resets: dict[str, int] = {}
    failures = 0
    it = iter(plan)
    try:
        while True:
            while len(inflight) < max(1, args.queue_ahead):
                shot = next(it, None)
                if shot is None:
                    break
                value = coerce_like(existing, values[shot - 1])
                prefix = unique_prefix(args.prefix_base, shot)
                prompt = deep_clone(line_prompt)
                set_shot_variable(prompt, args.var_node, args.var_field, value)
                if args.prefix_node is not None:
                    set_shot_variable(prompt, args.prefix_node, args.prefix_field, prefix)
                resp = engine.submit(prompt)
                node_errors = resp.get("node_errors") or {}
                pid = resp.get("prompt_id")
                if node_errors or not pid:
                    print(f"[shot {shot}] 提交被拒: {json.dumps(node_errors, ensure_ascii=False)[:400]}")
                    ledger_append(ledger, "error", shot=shot, stage="submit_rejected", detail=str(node_errors)[:400])
                    failures += 1
                    continue
                # 预检②:回执一到立即落账(中断兜底补记后重抛,交外层 130 收尾)——
                # 关死「提交回执↔台账落笔」窗口,stop 的身份底册(prompt_id)永不缺单
                try:
                    ledger_append(ledger, "submit", shot=shot, prompt_id=pid, value=value, prefix=prefix)
                except KeyboardInterrupt:
                    ledger_append(ledger, "submit", shot=shot, prompt_id=pid, value=value, prefix=prefix)
                    raise
                inflight[pid] = shot
                submitted_at[pid] = time.time()
                print(f"[shot {shot}/{total}] 提交 {pid} var={value!r} prefix={prefix}")
                if args.interval > 0:
                    time.sleep(args.interval)
            if not inflight:
                break
            for pid, shot in list(inflight.items()):
                entry = engine.history(pid).get(pid)
                if entry is None:
                    if time.time() - submitted_at[pid] > args.shot_timeout:
                        # 预检⑥(决策核心=pending_timeout_action,--self-test 直测):超时
                        # 但仍在引擎 pending=queue_ahead>1 排队等待计入了超时(误判)——
                        # 在队未启算≠挂尸,重置时钟续等(次数封顶,永压 pending 不无限
                        # 续等);真挂尸(报 running 而引擎日志无进度)判决照走
                        if pending_timeout_action(
                            pid in queue_ids(engine.queue(), "queue_pending"),
                            pending_resets.get(pid, 0),
                        ) == "reset":
                            pending_resets[pid] = pending_resets.get(pid, 0) + 1
                            print(
                                f"[shot {shot}] 超时 {args.shot_timeout:.0f}s 但仍在引擎 pending"
                                f"(排队等待计入超时,非僵尸),重置时钟续等"
                                f"(豁免 {pending_resets[pid]}/{MAX_PENDING_RESETS})"
                            )
                            submitted_at[pid] = time.time()
                            continue
                        _print_zombie_verdict(engine, shot, pid, args.shot_timeout)
                        ledger_append(ledger, "zombie", shot=shot, prompt_id=pid)
                        if args.auto_interrupt:
                            engine.interrupt(pid)
                            print(f"[shot {shot}] --auto-interrupt:已定向打断自家 {pid}")
                        failures += 1
                        del inflight[pid]
                    continue
                status = entry.get("status", {})
                status_str = status.get("status_str")
                if status_str is None:
                    continue  # 在册未终态:继续等
                if status_str != "success":
                    msgs = [
                        json.dumps(m, ensure_ascii=False)[:400]
                        for m in status.get("messages", [])
                        if isinstance(m, list) and m and m[0] == "execution_error"
                    ]
                    print(f"[shot {shot}] 执行失败({pid}): {' | '.join(msgs) or status_str}")
                    ledger_append(ledger, "error", shot=shot, prompt_id=pid, detail="; ".join(msgs) or status_str)
                    failures += 1
                else:
                    digest, files = output_fingerprint(entry.get("outputs"))
                    ledger_append(
                        ledger, "done", shot=shot, prompt_id=pid,
                        fingerprint=digest, files=[f["filename"] for f in files],
                    )
                    print(f"[shot {shot}/{total}] 完成 {pid} 指纹 {digest} 产物 {[f['filename'] for f in files]}")
                del inflight[pid]
            time.sleep(max(0.2, args.poll_interval))
    except KeyboardInterrupt:
        print(
            "\n[batch-queue] 手动中断;台账已记到当前拍。续跑=同命令再执行(自动跳过已完成拍);"
            f"精确停队=python3 {sys.argv[0]} stop --ledger {ledger} [--interrupt-running]"
        )
        return 130
    done_now = sum(1 for s in plan if s in completed_shots(parse_ledger(read_ledger_lines(ledger))[0]))
    print(f"[batch-queue] 收队:计划 {len(plan)} 拍,本轮完成 {done_now},失败 {failures};台账 {ledger}")
    return 1 if failures else 0


# ───────────────────────── CLI:stop / status ─────────────────────────

def cmd_stop(args) -> int:
    url, home = resolve_engine_url()
    engine = Engine(url, home)
    ledger = Path(args.ledger)
    latest, own_ids, bad = parse_ledger(read_ledger_lines(ledger))
    if not own_ids:
        print(f"[batch-queue] 台账 {ledger} 无自持 prompt_id(坏行 {len(bad)}),无从精确停队")
        return 2
    snap = engine.queue()
    running = own_running(own_ids, snap)
    others = set(queue_ids(snap, "queue_running")) | set(queue_ids(snap, "queue_pending"))
    others -= own_ids
    interrupted = []
    if args.interrupt_running:
        for pid in running:
            engine.interrupt(pid)
            interrupted.append(pid)
            print(f"[stop] 定向打断自家 running {pid}")
    victims = engine.delete_pending(own_ids)
    for pid in victims:
        print(f"[stop] 删除自家 pending {pid}")
    ledger_append(ledger, "stop", deleted=victims, interrupted=interrupted)
    print(
        f"[stop] 精确停队完成:删自家 pending {len(victims)}、打断自家 running {len(interrupted)};"
        f"他方单 {len(others)} 个原样未动(未发 clear)"
    )
    return 0


def cmd_status(args) -> int:
    url, home = resolve_engine_url()
    engine = Engine(url, home)
    own_ids: set[str] = set()
    if args.ledger:
        _, own_ids, bad = parse_ledger(read_ledger_lines(Path(args.ledger)))
        for line in bad:
            print(f"  台账坏行(忽略): {line}")
    snap = engine.queue()
    running = queue_ids(snap, "queue_running")
    pending = queue_ids(snap, "queue_pending")
    print(f"[status] 引擎 {url}:running {len(running)} / pending {len(pending)}")
    own_r = [i for i in running if i in own_ids]
    own_p = [i for i in pending if i in own_ids]
    print(f"[status] 自家(台账 {args.ledger or '未指'}):running {len(own_r)} {own_r} / pending {len(own_p)} {own_p}")
    print(f"[status] 他方:running {len(running) - len(own_r)} / pending {len(pending) - len(own_p)}(不会被本工具触碰)")
    lines, mtime = engine.log_progress_lines(3)
    if lines:
        stamp = time.strftime("%H:%M:%S", time.localtime(mtime)) if mtime else "?"
        print(f"[status] 引擎日志最近进度行(mtime={stamp}):")
        for ln in lines:
            print(f"    {ln}")
    return 0


# ───────────────────────── --self-test(纯逻辑,零 IO 零引擎) ─────────────────────────

def _self_test_fixture():
    """合成工作流+object_info 夹具:覆盖连线/widget 槽序/seed 控制对/命名 widget/
    Note 摘除/muted 摘除/断源报告。"""
    oi = {
        "CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["x"], {}]}}},
        "CLIPTextEncode": {"input": {"required": {"text": ["STRING", {}], "clip": ["CLIP"]}}},
        "EmptyLatentImage": {"input": {"required": {"width": ["INT"], "height": ["INT"], "batch_size": ["INT"]}}},
        "KSampler": {
            "input": {
                "required": {
                    "model": ["MODEL"], "positive": ["CONDITIONING"], "negative": ["CONDITIONING"],
                    "latent_image": ["LATENT"], "seed": ["INT"], "steps": ["INT"], "cfg": ["FLOAT"],
                    "sampler_name": ["combo"], "scheduler": ["combo"], "denoise": ["FLOAT"],
                }
            }
        },
        "SaveImage": {"input": {"required": {"images": ["IMAGE"], "filename_prefix": ["STRING"]}}},
        "PreviewImage": {"input": {"required": {"images": ["IMAGE"]}}},
    }
    wf = {
        "nodes": [
            {"id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["sd_xl.safetensors"]},
            {"id": 4, "type": "CLIPTextEncode", "widgets_values": ["正提示"],
             "inputs": [{"name": "clip", "type": "CLIP", "link": 101}]},
            {"id": 5, "type": "CLIPTextEncode", "widgets_values": ["负提示"],
             "inputs": [{"name": "clip", "type": "CLIP", "link": 102}]},
            {"id": 6, "type": "EmptyLatentImage", "widgets_values": [512, 512, 1]},
            {"id": 2, "type": "KSampler",
             "widgets_values": [777, "randomize", 20, 8.0, "euler", "normal", 1.0],
             "inputs": [{"name": "model", "link": 103}, {"name": "positive", "link": 104},
                        {"name": "negative", "link": 105}, {"name": "latent_image", "link": 106}]},
            {"id": 9, "type": "SaveImage", "widgets_values": ["outA"],
             "inputs": [{"name": "images", "link": 107}]},
            {"id": 10, "type": "PreviewImage", "inputs": [{"name": "images", "link": 108}]},
            {"id": 99, "type": "Note", "widgets_values": ["备注节点"]},
            {"id": 8, "type": "PreviewImage", "mode": 4, "inputs": [{"name": "images", "link": 109}]},
        ],
        "links": [
            [101, 1, 1, 4, 0, "CLIP"], [102, 1, 1, 5, 0, "CLIP"],
            [103, 1, 0, 2, 0, "MODEL"], [104, 4, 0, 2, 1, "CONDITIONING"],
            [105, 5, 0, 2, 2, "CONDITIONING"], [106, 6, 0, 2, 3, "LATENT"],
            [107, 2, 0, 9, 0, "IMAGE"], [108, 2, 0, 10, 0, "IMAGE"],
            [109, 2, 0, 8, 0, "IMAGE"],
        ],
    }
    return wf, oi


def self_test() -> int:
    failures: list[str] = []

    def check(name: str, cond: bool) -> None:
        print(f"{'PASS' if cond else 'FAIL'}  {name}")
        if not cond:
            failures.append(name)

    # 1) deepClone 独立性
    src = {"1": {"class_type": "A", "inputs": {"seed": 1, "nested": {"k": [1, 2]}}}}
    cloned = deep_clone(src)
    cloned["1"]["inputs"]["seed"] = 999
    cloned["1"]["inputs"]["nested"]["k"].append(3)
    check("deep_clone 深独立(改克隆不伤原图)", src["1"]["inputs"]["seed"] == 1 and src["1"]["inputs"]["nested"]["k"] == [1, 2])

    # 2) 连线值判定
    check("is_link 正判", is_link(["3", 0]) and is_link(["10", 2]))
    check("is_link 误判排除", not is_link([512, 512]) and not is_link(["3", True]) and not is_link("x") and not is_link(["3", 0, 0]))

    # 3) 闭包裁剪:菱形+旁路
    g = {
        "1": {"class_type": "A", "inputs": {}},
        "2": {"class_type": "B", "inputs": {"a": ["1", 0]}},
        "3": {"class_type": "B", "inputs": {"a": ["1", 0]}},
        "4": {"class_type": "C", "inputs": {"b": ["2", 0]}},
        "5": {"class_type": "C", "inputs": {"b": ["3", 0]}},
    }
    check("闭包裁剪=只留当前线", set(closure_prune(g, ["4"])) == {"1", "2", "4"})
    check("闭包裁剪=双产物全闭包", set(closure_prune(g, ["4", "5"])) == {"1", "2", "3", "4", "5"})
    check("闭包裁剪=缺号节点如实跳过", set(closure_prune(g, ["4", "99"])) == {"1", "2", "4"})

    # 4) graphToPrompt 等价转换(夹具全量对拍)
    wf, oi = _self_test_fixture()
    prompt, report = graph_to_prompt(wf, oi)
    expected = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "正提示", "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "负提示", "clip": ["1", 1]}},
        "6": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        "2": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0], "latent_image": ["6", 0],
            "seed": 777, "steps": 20, "cfg": 8.0, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["2", 0], "filename_prefix": "outA"}},
        "10": {"class_type": "PreviewImage", "inputs": {"images": ["2", 0]}},
    }
    check("graph_to_prompt 全量对拍", prompt == expected)
    check("Note 不进图", "99" not in prompt)
    muted_lines = [l for l in report if l.startswith("skip")]
    check("muted 摘除留痕", len(muted_lines) == 1 and "node=8" in muted_lines[0])

    # 5) 断源报告(node 11 消费 muted node 8 的输出,新增连线 110:8→11)
    wf_broken = deep_clone(wf)
    wf_broken["nodes"].append({"id": 11, "type": "PreviewImage", "inputs": [{"name": "images", "link": 110}]})
    wf_broken["links"].append([110, 8, 0, 11, 0, "IMAGE"])
    _, report_broken = graph_to_prompt(wf_broken, oi)
    feed_lines = [l for l in report_broken if l.startswith("!!") and "node=11" in l and "node=8" in l]
    check("断源硬伤报告(消费者由已摘除节点供源)", len(feed_lines) == 1)

    # 6) 硬伤按闭包过滤
    lines = [
        "skip node=8 mode=4 PreviewImage",
        "!! node=11 slot=images 由已摘除节点 node=8(PreviewImage) 供源",
        "!! node=9 SaveImage widget 槽 filename_prefix 无值(widgets_values 长度不足)",
    ]
    check("硬伤闭包过滤=裁掉支路上的不算数",
          hard_errors_in_closure(lines, {"9"}) == [lines[2]]
          and hard_errors_in_closure(lines, {"9", "11"}) == [lines[1], lines[2]])
    check("report_node_id 抽主语", report_node_id(lines[1]) == "11")

    # 7) 改 index 与防呆
    p2 = deep_clone(prompt)
    set_shot_variable(p2, "2", "seed", 424242)
    check("set_shot_variable 写值", p2["2"]["inputs"]["seed"] == 424242 and prompt["2"]["inputs"]["seed"] == 777)
    try:
        set_shot_variable(p2, "2", "不存在的槽", 1)
        check("set_shot_variable 缺槽硬错", False)
    except KeyError:
        check("set_shot_variable 缺槽硬错", True)

    # 8) 拍计划:断点续跑×随机序组合语义
    check("plan 顺序序", plan_batch(5, 1, set(), None) == [1, 2, 3, 4, 5])
    check("plan --start 下界(原序口径)", plan_batch(5, 3, {1}, None) == [3, 4, 5])
    check("plan 台账跳号", plan_batch(5, 1, {2, 4}, None) == [1, 3, 5])
    check("plan 台账∪start 合取", plan_batch(6, 2, {2, 5}, None) == [3, 4, 6])
    a = plan_batch(6, 1, set(), random.Random(7))
    b = plan_batch(6, 1, set(), random.Random(7))
    check("随机序=同种子可复现", a == b)
    check("随机序=未完成拍集合的排列", sorted(a) == [1, 2, 3, 4, 5, 6])
    check("随机序=真洗牌(非恒等)", a != [1, 2, 3, 4, 5, 6])
    mixed = plan_batch(6, 1, {2}, random.Random(7))
    check("随机序只作用于剩余集合", sorted(mixed) == [1, 3, 4, 5, 6] and 2 not in mixed)
    for bad_args in ((0, 1, set(), None), (5, 0, set(), None)):
        try:
            plan_batch(*bad_args)
            check(f"plan 非法参数硬错 {bad_args}", False)
        except ValueError:
            check(f"plan 非法参数硬错 {bad_args}", True)

    # 9) 台账:解析/跳号/prompt_id 记账
    ledger_lines = [
        '{"event":"plan","total":3,"shots":[1,2,3]}',
        '{"event":"submit","shot":1,"prompt_id":"p1","value":11}',
        '{"event":"done","shot":1,"prompt_id":"p1","fingerprint":"abc"}',
        '{"event":"submit","shot":2,"prompt_id":"p2","value":22}',
        '{"event":"error","shot":2,"prompt_id":"p2","detail":"boom"}',
        "坏行不是 JSON",
        '{"event":"submit","shot":3,"prompt_id":"p3","value":33}',
        '{"event":"done","shot":2,"prompt_id":"p2","fingerprint":"def"}',
        '{"event":"no-shot","prompt_id":"p9"}',
    ]
    latest, own_ids, bad = parse_ledger(ledger_lines)
    check("台账 prompt_id 记账(精确停队底册)", own_ids == {"p1", "p2", "p3", "p9"})
    check("台账同拍最后事件为准(重试成功)", latest[2].get("fingerprint") == "def")
    check("台账跳号=done 集", completed_shots(latest) == {1, 2})
    check("台账坏行如实报告", bad == ["line 6: 非 JSON"])
    check("台账无 shot 事件不进拍表", set(latest) == {1, 2, 3})

    # 10) 精确停队集合:只删自己的
    snap = {
        "queue_running": [[10, "p2"], [11, "other1"]],
        "queue_pending": [[12, "p3"], [13, "other2"], [14, "p4"]],
    }
    check("own_pending=自持∩pending", own_pending({"p2", "p3", "p4", "p9"}, snap) == ["p3", "p4"])
    check("own_running=自持∩running", own_running({"p2", "p3"}, snap) == ["p2"])
    check("空自持集=零删除(绝不清全队)", own_pending(set(), snap) == [])
    check("queue_ids 取 [1] 位 prompt_id", queue_ids(snap, "queue_pending") == ["p3", "other2", "p4"])
    check("空快照稳健", own_pending({"p1"}, {}) == [] and queue_ids({}, "queue_running") == [])

    # 11) 每拍独立前缀(防覆盖)
    check("前缀逐拍唯一+定宽", unique_prefix("batch", 1) == "batch_0001" and unique_prefix("batch", 1234) == "batch_1234")
    check("前缀非法字符收编", unique_prefix("我的 批量/α", 3) == "__0003")
    check("空前缀基名兜底", unique_prefix("", 7) == "batch_0007")
    check("前缀互不相同", len({unique_prefix("b", s) for s in range(1, 6)}) == 5)

    # 12) 产物指纹
    out = {
        "9": {"images": [{"filename": "b_0002_.png", "subfolder": "", "type": "temp"},
                         {"filename": "a.png", "subfolder": "x", "type": "output"}]},
        "7": {"gifs": [{"filename": "v.webp", "subfolder": "", "type": "output"}]},
    }
    d1, files = output_fingerprint(out)
    d2, _ = output_fingerprint(deep_clone(out))
    check("指纹稳定且文件清单排序", d1 == d2 and len(files) == 3
          and [f["filename"] for f in files] == ["a.png", "b_0002_.png", "v.webp"])
    check("空产物也有定长指纹", output_fingerprint({})[1] == [] and len(output_fingerprint({})[0]) == 16)
    check("非 dict 分支稳健", output_fingerprint({"9": None})[1] == [])

    # 13) CLI 值类型收编
    check("coerce 按现值类型", coerce_like(5, "42") == 42 and isinstance(coerce_like(5, "42"), int)
          and coerce_like(1.5, "0.7") == 0.7 and coerce_like(True, "true") is True
          and coerce_like(True, "0") is False and coerce_like("s", "xyz") == "xyz"
          and coerce_like(5, "nan") == "nan")

    # 14) 汇点判定(闭包入口)
    check("resolve_output_nodes 缺省汇点", resolve_output_nodes(g, None) == ["4", "5"])
    check("resolve_output_nodes 显式优先", resolve_output_nodes(g, ["4"]) == ["4"])

    # 15) 进度行真相源正则
    check("进度行匹配", bool(PROGRESS_LINE_RE.search("Prompt executed in 12.34 seconds")))
    check("非进度行不匹配", not PROGRESS_LINE_RE.search("got prompt") and not PROGRESS_LINE_RE.search("Prompt executed"))

    # 16) 防误配置预检纯逻辑(写入目标三型误配置+闭包内悬空连线)
    check("目标预检=合法 var 目标放行", field_target_error(prompt, "2", "seed", "var") is None)
    check("目标预检=合法 prefix 目标放行", field_target_error(prompt, "9", "filename_prefix", "prefix") is None)
    miss = field_target_error(prompt, "2", "无此槽", "var")
    check("目标预检=槽不存在报错", miss is not None and "无输入槽" in miss and "--var-field" in miss)
    cut = field_target_error(prompt, "77", "seed", "var")
    check("目标预检=节点不在闭包报错", cut is not None and "不在闭包内" in cut and "--var-node" in cut)
    link_hit = field_target_error(prompt, "9", "images", "prefix")
    check("目标预检=连线槽报错(防覆盖连线)",
          link_hit is not None and "连线槽" in link_hit and "node 2" in link_hit)
    check("悬空连线=干净图零报",
          dangling_links_in_closure(prompt) == [] and dangling_links_in_closure(closure_prune(g, ["4"])) == [])
    g_dangling = {"2": {"class_type": "B", "inputs": {"a": ["1", 0]}},
                  "4": {"class_type": "C", "inputs": {"b": ["2", 0]}}}
    d_line = dangling_links_in_closure(g_dangling)
    check("悬空连线=源不在闭包图内如实报",
          len(d_line) == 1 and "node=2" in d_line[0] and "slot=a" in d_line[0] and "node=1" in d_line[0])
    p_missing_src = {k: v for k, v in prompt.items() if k != "6"}  # 模拟源节点转换失败未进 API 图
    d_real = dangling_links_in_closure(closure_prune(p_missing_src, ["9"]))
    check("悬空连线=闭包产物实况(硬伤闭包过滤漏报的补扫)",
          len(d_real) == 1 and "node=2" in d_real[0] and "latent_image" in d_real[0])

    # 17) 预检⑥决策核心:超时×pending 判决(重置封顶=永压 pending 不无限续等)
    check("预检⑥=超时×pending→重置时钟续等", pending_timeout_action(True, 0) == "reset")
    check("预检⑥=超时×非pending→判僵", pending_timeout_action(False, 0) == "zombie")
    check("预检⑥=封顶前最后一次豁免仍续等", pending_timeout_action(True, MAX_PENDING_RESETS - 1) == "reset")
    check("预检⑥=豁免耗尽(永压 pending)→判僵", pending_timeout_action(True, MAX_PENDING_RESETS) == "zombie")

    print(f"\nself-test: {len(failures)} failed" if failures else "\nself-test: ALL PASS")
    return 1 if failures else 0


# ───────────────────────── 入口 ─────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="batch_queue.py",
        description="批量队列治理四协议:断点续跑+间隔节流+随机序+精确停队(引擎口从 manifest 现算)",
    )
    p.add_argument("--self-test", action="store_true", help="纯逻辑自检(零 IO 零引擎)后退出")
    sub = p.add_subparsers(dest="cmd")

    run = sub.add_parser("run", help="批量循环(四协议)")
    run.add_argument("--workflow", required=True, help="UI 工作流 JSON 路径(只读)")
    run.add_argument("--var-node", required=True, help="拍变量节点 id(如 seed 所在 KSampler)")
    run.add_argument("--var-field", required=True, help="拍变量输入槽名(如 seed)")
    run.add_argument("--var-values", nargs="+", required=True, help="逐拍取值(拍数=值数;类型按槽位现值收编)")
    run.add_argument("--prefix-node", help="防覆盖前缀节点 id(指到 SaveImage 才改前缀)")
    run.add_argument("--prefix-field", default="filename_prefix", help="前缀槽名(默认 filename_prefix)")
    run.add_argument("--prefix-base", default="batch", help="前缀基名(每拍 <base>_<拍号:04d>)")
    run.add_argument("--output-nodes", nargs="+", help="闭包裁剪产物节点(缺省=图内汇点)")
    run.add_argument("--start", type=int, default=1, help="断点续跑:从第 N 号起(1 基,原序口径)")
    run.add_argument("--random", action="store_true", help="随机序(作用于未完成拍集合)")
    run.add_argument("--seed", type=int, default=None, help="随机种子(配 --random 可复现)")
    run.add_argument("--interval", type=float, default=2.0, help="间隔节流:相邻提交间隔秒(协议2)")
    run.add_argument("--queue-ahead", type=int, default=1, help="在飞拍数上限(1=串行逐拍等完)")
    run.add_argument("--poll-interval", type=float, default=2.0, help="完成轮询间隔秒")
    run.add_argument("--shot-timeout", type=float, default=1800.0, help="单拍超时秒(超时走僵尸单判决)")
    run.add_argument("--auto-interrupt", action="store_true", help="僵尸单自动定向打断(默认只报告)")
    run.add_argument("--ledger", help="台账 ndjson 路径(缺省=<工作流名>.ndjson 于当前目录)")
    run.set_defaults(func=cmd_run)

    stop = sub.add_parser("stop", help="精确停队:只删自家 pending(可配定向 interrupt),绝不清全队")
    stop.add_argument("--ledger", required=True, help="台账 ndjson(prompt_id 底册)")
    stop.add_argument("--interrupt-running", action="store_true", help="连带定向打断自家 running(带 prompt_id 的 /interrupt)")
    stop.set_defaults(func=cmd_stop)

    st = sub.add_parser("status", help="队列快照:自家/他方分账+引擎日志进度行")
    st.add_argument("--ledger", help="台账 ndjson(给了才分自家/他方)")
    st.set_defaults(func=cmd_status)
    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "self_test", False):
        return self_test()
    if not getattr(args, "cmd", None):
        parser.print_help()
        return 2
    try:
        return args.func(args)
    except RuntimeError as exc:
        print(f"[batch-queue] {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
