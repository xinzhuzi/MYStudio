#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""my21fast-1025 前置锁:cfg=1 全量断言探针(三形 links)+ 全量备份(定谳5)。

施工节点·第1轮 序1 探针。两类职责:

一、cfg=1 前置锁(定谳5)——扫描六件,递归含全部 definitions.subgraphs:
    ① t2i 画布   workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json
    ② i2i 画布   workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json
    ③ edit 画布  workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json
    ④ t2i api 件 workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json
    ⑤ i2i api 件 workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json
    ⑥ 调色板镜像 my_nodes/subgraphs/qi21-提示词类型优化子图-edit.json
      (「调色板镜像」识别锚=计划书「镜像件子图 links=list(实测 26 条)」:
      全仓唯一 26 条 subgraph links 的镜像件;该子图嵌 色卡/调色 文本 blob
      得名,与 edit 画布内同名子图 26 条互为镜像。识别依据写入本头,如误
      识别由下方逐件 links 计数输出即可复核。)
  三形并存都解析,按宿主分派(前轮亲验):
    A 画布根层 links=list(旧式数组条目 [id,src,slot,dst,slot,"TYPE"])
    B 画布内子图 links=dict 形条目(容器 list,条目 {"id","origin_id",...})
    C 镜像件子图 links=list(dict 条目;⑥ 实测 26 条)
  断言:凡带 cfg 输入的 KSampler 族——KSampler wv[3]、KSamplerAdvanced
  wv[4]、api 件按 inputs.cfg 名取(含 widgets_values_named.cfg 双存储,循
  1017bpcfg1 先例双锚)——一律 cfg==1。任何违例非零退出并列违例坐标。
  同时断言全仓 workflows 树 + my_nodes/subgraphs 树零 CFGGuider 节点
  (2026-10-25 勘察基线:全树 0;树内另有 moss×2+fisher 三件 KSampler
  cfg≠1 属他域合法态,不在六件 cfg 锁范围,本探针不越界断言)。
  本探针在步骤8 实弹前重跑(定谳5 双跑)。

二、全量备份——把本轮全部将动文件逐字节快照进
  apps/output/bak/my21fast-1025/pre/(copy2 保字节保元数据;首跑建档,
  重跑不覆盖 pre 态——双跑时改后文件以 manifest sha 对比呈现漂移而非
  悄悄覆档)。清单含计划书点名件 test_qi21_reference_vae_cpu.py 与
  快照 fixture qi21_object_info_snapshot.json,及六件工作流本体;新增
  件(节点/单测/本探针)在 manifest 记 absent-at-pre/first-version 标记。

退出码:0=全绿;1=cfg/CFGGuider 违例;2=结构异常(件缺失/解析失败)。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / "apps/backend/comfyui/workflows"
SUBGRAPHS = ROOT / "apps/backend/comfyui/my_nodes/subgraphs"
BAK = ROOT / "apps/output/bak/my21fast-1025/pre"

# 六件(序1 计划书钦定;相对 ROOT)
SIX = [
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json",
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json",
    "apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-edit.json",
]

# 本轮将动文件(现存者逐字节快照;新增件在 NEW_FILES 记 absent 标记)
TOUCHED_EXISTING = SIX + [
    "apps/backend/comfyui/my_nodes/__init__.py",
    "apps/backend/comfyui/my_nodes/tests/test_my_nodes.py",
    "apps/backend/comfyui/tests/test_qi21_reference_vae_cpu.py",
    "apps/backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json",
    "apps/build/scripts/my21fast_preflight_cfg_lock.py",  # 本探针首版=pre 态
]
NEW_FILES = [
    "apps/backend/comfyui/my_nodes/nodes/my_qi21_fast_encode.py",
    "apps/backend/comfyui/my_nodes/tests/test_my_qi21_fast_encode.py",
]

KS_CFG_WV_INDEX = {"KSampler": 3, "KSamplerAdvanced": 4}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def links_form(links) -> str:
    """三形分派:A=根层数组条目,B=子图 dict 条目,C=镜像件 dict 条目。

    A 与 B/C 以条目形态分(容器均 list):首条目 list→A 形;首条目 dict→
    B/C 形(B/C 容器同形,差别只在宿主=画布内嵌 or 镜像件,由调用方标注)。
    """
    if links is None:
        return "absent"
    if not isinstance(links, list):
        return f"unexpected:{type(links).__name__}"
    if not links:
        return "empty-list"
    first = links[0]
    if isinstance(first, dict):
        return "list-dict"
    if isinstance(first, (list, tuple)):
        return "list-array"
    return f"unexpected-entry:{type(first).__name__}"


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except Exception as exc:  # noqa: BLE001 —— 违例坐标要附异常原因
        return None, f"{exc.__class__.__name__}: {exc}"


def iter_hosts(doc, file_tag: str):
    """产出 (坐标, nodes 序列, node_form) 与 (坐标, links, links_form, host_kind)。

    覆盖:画布根层 nodes + definitions.subgraphs 逐子图 nodes(递归子图
    定义内的嵌套 subgraphs 一并全展开)+ api 件双形(旧 prompt 形
    {id:{class_type,inputs}} 与新 graph 包装 {schemaVersion,graph:{...}})。
    """
    if not isinstance(doc, dict):
        return
    # ── 画布根层 ──
    if isinstance(doc.get("nodes"), list):
        yield ("root", doc["nodes"], "canvas")
        yield ("root.links", doc.get("links"), "canvas-root")
    # ── definitions.subgraphs 全展开(含嵌套)──
    stack = list(enumerate((doc.get("definitions") or {}).get("subgraphs") or []))
    while stack:
        coord, sg = stack.pop(0)
        where = f"sg[{coord}]"
        if not isinstance(sg, dict):
            continue
        yield (where, sg.get("nodes") or [], "canvas")
        yield (f"{where}.links", sg.get("links"), "subgraph")
        for j, nested in enumerate((sg.get("definitions") or {}).get("subgraphs") or []):
            stack.append((f"{coord}>{j}", nested))
    # ── api 件:新 graph 包装或旧 prompt 形 ──
    graph = doc.get("graph") if isinstance(doc.get("graph"), dict) else None
    cand = graph if graph is not None else doc
    if isinstance(cand, dict) and "nodes" not in cand:
        entries = [(nid, nd) for nid, nd in cand.items() if isinstance(nd, dict)]
        if any("class_type" in nd for _n, nd in entries):
            yield ("api", entries, "api")


def node_type_of(node, form: str) -> str:
    if form == "api":
        return str(node[1].get("class_type", "")) if isinstance(node, tuple) else ""
    return str(node.get("type", ""))


def collect_cfg_entries(path: Path, violations: list, census: dict):
    """六件逐件扫描:cfg 值清单 + 三形 links 解析计数 + 违例收集。"""
    tag = path.relative_to(ROOT).as_posix()
    doc, err = load(path)
    if doc is None:
        violations.append(f"[结构] {tag} 解析失败: {err}")
        return
    ks_rows = []
    for where, payload, form in iter_hosts(doc, tag):
        if form in ("canvas-root", "subgraph"):
            census["links"][form][links_form(payload)] = census["links"][form].get(links_form(payload), 0) + 1
            census["links_count"][f"{tag}#{where}"] = {
                "form": links_form(payload), "n": len(payload) if isinstance(payload, list) else None}
            continue
        iterable = payload
        for item in (iterable if isinstance(iterable, list) else []):
            if form == "api":
                nid, nd = item
                ident = f"{tag}#api[{nid}]"
                ctype = str(nd.get("class_type", ""))
                if ctype == "CFGGuider":
                    violations.append(f"[CFGGuider] {ident}")
                if ctype in KS_CFG_WV_INDEX or "cfg" in (nd.get("inputs") or {}):
                    cfg = (nd.get("inputs") or {}).get("cfg")
                    ks_rows.append((ident, ctype, cfg))
                    if cfg != 1:
                        violations.append(f"[cfg≠1] {ident} {ctype} inputs.cfg={cfg!r}")
            else:
                if not isinstance(item, dict):
                    continue
                ntype = str(item.get("type", ""))
                ident = f"{tag}#{where}[{item.get('id')}]"
                if ntype == "CFGGuider":
                    violations.append(f"[CFGGuider] {ident}")
                named = item.get("widgets_values_named")
                named_cfg = named.get("cfg") if isinstance(named, dict) else None
                if ntype in KS_CFG_WV_INDEX:
                    wv = item.get("widgets_values") or []
                    idx = KS_CFG_WV_INDEX[ntype]
                    cfg = wv[idx] if len(wv) > idx else None
                    ks_rows.append((ident, ntype, cfg))
                    if cfg != 1:
                        violations.append(f"[cfg≠1] {ident} {ntype} wv[{idx}]={cfg!r} wv={wv!r}")
                    if isinstance(named, dict) and "cfg" in named and named_cfg != 1:
                        violations.append(f"[cfg≠1] {ident} {ntype} named.cfg={named_cfg!r}(双存储漂移)")
                elif isinstance(named, dict) and "cfg" in named:
                    # 非 KSampler 族但带 cfg widget:同锁(凡带 cfg 输入)
                    ks_rows.append((ident, ntype, named_cfg))
                    if named_cfg != 1:
                        violations.append(f"[cfg≠1] {ident} {ntype} named.cfg={named_cfg!r}")
    census["ksamplers"].extend(ks_rows)


def tree_cfgguider_zero(violations: list) -> int:
    """全仓 workflows 树 + my_nodes/subgraphs 树零 CFGGuider;返回扫描件数。"""
    scanned = 0
    for base in (WORKFLOWS, SUBGRAPHS):
        for path in sorted(base.rglob("*.json")):
            scanned += 1
            doc, err = load(path)
            if doc is None:
                violations.append(f"[结构] {path.relative_to(ROOT).as_posix()} 解析失败: {err}")
                continue
            for where, payload, form in iter_hosts(doc, ""):
                if form in ("canvas-root", "subgraph"):
                    continue
                for item in (payload if isinstance(payload, list) else []):
                    if form == "api":
                        if str(item[1].get("class_type", "")) == "CFGGuider":
                            violations.append(
                                f"[CFGGuider] {path.relative_to(ROOT).as_posix()}#api[{item[0]}]")
                    elif isinstance(item, dict) and str(item.get("type", "")) == "CFGGuider":
                        violations.append(
                            f"[CFGGuider] {path.relative_to(ROOT).as_posix()}#{where}[{item.get('id')}]")
    return scanned


def snapshot() -> dict:
    """逐字节快照 TOUCHED_EXISTING → BAK;首跑建档,重跑不覆盖(定谳5 双跑安全)。"""
    BAK.mkdir(parents=True, exist_ok=True)
    manifest_path = BAK / "manifest.json"
    manifest = {"snapshots": [], "absent_at_pre": [], "self": __file__ and Path(__file__).name}
    for rel in TOUCHED_EXISTING:
        src = ROOT / rel
        flat = rel.replace("/", "__")
        dst = BAK / flat
        entry = {"src": rel, "snapshot": flat,
                 "pre_sha256": sha256(src) if src.is_file() else None}
        if not src.is_file():
            entry["status"] = "missing-at-pre"
        elif dst.is_file():
            entry["status"] = "kept-existing-pre(first-run-wins)"
        else:
            shutil.copy2(src, dst)
            entry["status"] = "snapshotted"
            entry["snapshot_sha256"] = sha256(dst)
        manifest["snapshots"].append(entry)
    for rel in NEW_FILES:
        src = ROOT / rel
        manifest["absent_at_pre"].append(
            {"src": rel, "existed_at_pre": src.is_file()})
    prior = {}
    if manifest_path.is_file():
        try:
            prior = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 —— 旧档坏不拦新档,对比档独立呈现
            prior = {}
    if prior.get("snapshots"):
        # 双跑:pre 档保持首跑(status 亦保首跑);本轮态记 rerun_status,
        # 源漂移以 current_sha256 附加在合并档条目上呈现(绝不覆 pre 档)。
        merged = {e["src"]: e for e in prior["snapshots"]}
        for e in manifest["snapshots"]:
            cur = ROOT / e["src"]
            cur_sha = sha256(cur) if cur.is_file() else None
            target = merged.setdefault(e["src"], e)
            target["current_sha256"] = cur_sha
            target["rerun_status"] = e["status"]
            target["drifted_since_pre"] = (
                target.get("pre_sha256") is not None and cur_sha != target["pre_sha256"])
        manifest["snapshots"] = [merged[k] for k in sorted(merged)]
        manifest["rerun"] = True
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    violations: list = []
    census = {"ksamplers": [], "links": {"canvas-root": {}, "subgraph": {}}, "links_count": {}}

    print("== 序1 cfg=1 前置锁(六件,三形 links) ==")
    for rel in SIX:
        path = ROOT / rel
        if not path.is_file():
            violations.append(f"[结构] 六件缺失: {rel}")
            continue
        collect_cfg_entries(path, violations, census)

    print("-- 逐 KSampler cfg 值清单(须全=1) --")
    for ident, ntype, cfg in census["ksamplers"]:
        print(f"  {ident} {ntype} cfg={cfg!r}")
    if not census["ksamplers"]:
        print("  (六件内无 KSampler 族带 cfg 节点)")

    print("-- 三形 links 解析计数 --")
    for host_kind in ("canvas-root", "subgraph"):
        for form, n in sorted(census["links"][host_kind].items()):
            print(f"  {host_kind} links {form}: {n} 处")
    for key in sorted(census["links_count"]):
        info = census["links_count"][key]
        print(f"  {key} → {info['form']} n={info['n']}")

    print("-- 全树 CFGGuider 断言 --")
    scanned = tree_cfgguider_zero(violations)
    guider_hits = [v for v in violations if v.startswith("[CFGGuider]")]
    print(f"  workflows 树+subgraphs 树扫描 {scanned} 件,CFGGuider 计数 {len(guider_hits)}(须 0)")

    print("== 全量备份(定谳5) ==")
    manifest = snapshot()
    for e in manifest["snapshots"]:
        rerun_note = f"(重跑态:{e.get('rerun_status', '?')})" if manifest.get("rerun") else ""
        print(f"  [{e['status']}]{rerun_note} {e['src']}")
    for e in manifest["absent_at_pre"]:
        print(f"  [absent-at-pre existed={e['existed_at_pre']}] {e['src']}")
    drifted = [e["src"] for e in manifest["snapshots"] if e.get("drifted_since_pre")]
    if drifted:
        print(f"  注意:重跑态,以下源已偏离 pre 档(不覆盖,对比呈现): {drifted}")

    if violations:
        print(f"\n违例 {len(violations)} 条:")
        for v in violations:
            print(f"  {v}")
        return 1
    print("\nGREEN:六件 cfg 锁全=1,三形 links 全解析,全树 CFGGuider=0,快照建档完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
