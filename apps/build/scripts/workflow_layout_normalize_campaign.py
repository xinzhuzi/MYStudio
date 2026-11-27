#!/usr/bin/env python3
"""全库工作流布局归一批处理(11-26-workflow-layout-normalize Task 4;design §5/§6)。

判据与算法住 node-graph 技能的 tools/(layout_check / layout_normalize,零项目专名);
本脚本持有项目事实:两个根、排除清单、容差、报告路径、写盘格式、蓝图对照表。

CLI:
  --check(默认)            全库试算,出报告 JSON+MD,恒退出 0
  --apply                   写盘(fail-closed);完整性失败退出 1;
                            无解件、格式特殊件只进清单,不算失败
  --only <相对键>            可重复;只处理列出的件(--write-far-baseline 不受影响)
  --write-far-baseline      间距棘轮基线,恒处理全库;只增新件或调低,调高抛 ValueError
  --sync-blueprints         按 BLUEPRINT_HOSTS 同步 8 件蓝图;
                            任一件 pre_drift 或 strip_mismatch → 退出 1
  --allow-reformat <相对键>  格式特殊件经用户同意整件重排(现同意 1 件:
                            workflows/1_图片/SeeThrough/seethrough-layer-editor.json,
                            2026-11-27 裁决 A15;按缩进 2 展开写回,行尾与末尾换行照原文件)
  --ht N / --vt N           间距目标档覆盖(缺省 = Q4 裁决 横 320 / 纵 180)
  --strict                  守门容差全 0(缺省 = Q3 裁决:交叉每作用域
                            ≤ max(3, ⌈整治前 × 10%⌉),其余判据 0)
  --json                    报告 JSON 另打到标准输出

相对键 = 相对 apps/backend/comfyui/ 的 POSIX 路径,如
workflows/0_分镜/分镜工作流.json、my_nodes/subgraphs/qi21-道劫-加速子图.json。
"""
from __future__ import annotations

import copy
import datetime
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOLS = REPO / ".agents" / "skills" / "node-graph" / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import layout_check as lc  # noqa: E402  (技能工具,本地路径自举)
import layout_normalize as lnorm  # noqa: E402

# 整理层入口用模块级别名:批处理内部与契约测试(monkeypatch campaign.normalize)
# 走同一个全局名,行为可拦、可换。
normalize = lnorm.normalize

COMFYUI = REPO / "apps" / "backend" / "comfyui"
ROOTS = (REPO / "apps/backend/comfyui/workflows",
         REPO / "apps/backend/comfyui/my_nodes/subgraphs")

# 9 件不碰(官方件 5、原件 2、收据钉死件 2)——用户 2026-11-27 裁决 Q2;
# flux3-文生图.json 为 1127 回归补登记的普查漏件:其字节被 10-16-flux3-daojie-ten-types
# 收据 artifacts/source-hashes.json 钉着(test_flux3_daojie_workflow_contract),
# 与 flux3-道劫-t2i.json 同 A8 口径——重钉收据须用户另令,整治不得触碰。
EXCLUDE = {
    "workflows/1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_t2i.json",
    "workflows/1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_image_edit.json",
    "workflows/1_图片/QwenImage2.1/0_官方模板/image_qwen_image_2_1_background_removal.json",
    "workflows/1_图片/SenseNova/0_官方模板/image_sensenova_u16_t2i.json",
    "workflows/1_图片/SenseNova/0_官方模板/image_sensenova_u16_image_edit.json",
    "workflows/2_视频/H3视频/8_数字人/340-H3数字人V6-萝卜原件.json",
    "workflows/2_视频/H3视频/8_数字人/340-H3无限时长V6-萝卜原件.json",
    "workflows/1_图片/Flux.3/flux3-道劫-t2i.json",
    "workflows/1_图片/Flux.3/flux3-文生图.json",
}

REPORT_JSON = REPO / "apps/output/automation/workflow-layout-report.json"
REPORT_MD = REPO / "apps/output/automation/workflow-layout-report.md"
FAR_BASELINE = REPO / "apps/backend/comfyui/tests/fixtures/workflow_layout_far_baseline.json"

# 蓝图文件名 → (宿主文件相对 apps/backend/comfyui/ 的路径, 子图名);
# 子图名跨工作流重名,只能逐件对照(design §6 P6)。
BLUEPRINT_HOSTS = {
    "qi21-提示词类型优化子图.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "[6] 文本提示词类型优化子图"),
    "qi21-提示词类型优化子图-i2i.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json", "[6] 文本提示词类型优化子图"),
    "qi21-提示词类型优化子图-edit.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-edit.json", "[6] 文本提示词类型优化子图"),
    "qi21-道劫-加速子图.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "道劫·加速子图"),
    "qi21-道劫-加速子图-i2i.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json", "道劫·加速子图"),
    "qi21-道劫-加速子图-edit.json": ("workflows/1_图片/QwenImage2.1/2_图生图/qi21-edit.json", "道劫·加速子图"),
    "qi21-道劫-超分-SeedVR2.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "道劫·超分·SeedVR2"),
    "qi21-道劫-洗底-透明除渣.json": ("workflows/1_图片/QwenImage2.1/1_文生图/qi21-道劫-t2i.json", "道劫·④b·洗底·透明除渣"),
}

# 本役运行期参数(--ht/--vt 可覆盖);缺省 = layout_normalize.PARAMS(Q4 裁决值)。
ACTIVE_PARAMS = dict(lnorm.PARAMS)


# --- 圈定范围 -----------------------------------------------------------------------

def _is_gui_doc(doc) -> bool:
    return isinstance(doc, dict) and isinstance(doc.get("nodes"), list) and bool(doc["nodes"])


def _scan_gui_all() -> list[tuple[str, Path]]:
    """两个根下全部 GUI 件(带非空 nodes 列表),含 EXCLUDE,按相对键排序。"""
    out = []
    for root in ROOTS:
        for p in sorted(root.rglob("*.json")):
            rel = p.relative_to(COMFYUI).as_posix()
            try:
                doc = json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:
                raise RuntimeError(
                    f"JSON 解析失败(布局批处理拒绝在解析不了的库上跑): {rel}: {e}") from e
            if _is_gui_doc(doc):
                out.append((rel, p))
    return out


def iter_gui_files() -> list[tuple[str, Path]]:
    """整治范围 = 全部 GUI 件 − EXCLUDE,按相对键排序;键相对 apps/backend/comfyui/。"""
    return [(rel, p) for rel, p in _scan_gui_all() if rel not in EXCLUDE]


# --- 原格式写回 ---------------------------------------------------------------------

def dump_like(text: str, doc: dict) -> str:
    """按原文本的格式序列化 doc:缩进(多行件取第 2 行前导空格数)、单行件紧凑、
    CRLF、末尾换行。还原不了的件由「格式还原对拍」拦下,不在此硬保证。"""
    crlf = "\r\n" in text
    body = text.replace("\r\n", "\n")
    nonempty = [l for l in body.split("\n") if l.strip()]
    if len(nonempty) <= 1:
        out = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    else:
        second = nonempty[1]
        indent = len(second) - len(second.lstrip(" "))
        out = json.dumps(doc, ensure_ascii=False, indent=indent)
    if text.endswith("\n"):
        out += "\n"
    if crlf:
        out = out.replace("\n", "\r\n")
    return out


def _restores_exactly(raw: bytes) -> bool:
    """格式还原对拍:同一套规则把原文件读入再写出,须与原字节逐字节相等。"""
    text = raw.decode("utf-8")
    try:
        return dump_like(text, json.loads(text)).encode("utf-8") == raw
    except Exception:
        return False


def _reformat_text(text: str, doc: dict) -> str:
    """--allow-reformat 用:按缩进 2 把内联数组展开写回,行尾与末尾换行照原文件
    (裁决 A15;只动空白,解析后内容只差布局字段)。"""
    out = json.dumps(doc, ensure_ascii=False, indent=2)
    if text.endswith("\n"):
        out += "\n"
    if "\r\n" in text:
        out = out.replace("\n", "\r\n")
    return out


# --- 守门容差 -----------------------------------------------------------------------

def cross_tol(before: dict) -> dict:
    """Q3 裁决:交叉每作用域 ≤ max(3, ⌈整治前 × 10%⌉);其余判据 0(不在表里即 0)。"""
    return {"crossings": max(3, math.ceil(float(before.get("crossings", 0)) * 0.1))}


# 运行期容差(main 按 --strict 设置;模块被 import 时 = Q3 裁决缺省)。
_ACTIVE_TOL = cross_tol


def _tol_fn(tol):
    """把 cross_tol 式的 (before)->dict 容差适配成 normalize 的
    (作用域名, 整治前 counts)->dict;None = 严格。"""
    if tol is None:
        return None
    if callable(tol):
        return lambda scope, before: tol(before) or {}
    return tol


# --- 整图缩放 -----------------------------------------------------------------------

def _main_bbox(doc) -> tuple[float, float] | None:
    """主图节点可视盒与组框并集包围盒 (W, H);无主图节点返回 None。"""
    xs0, ys0, xs1, ys1 = [], [], [], []
    for n in doc.get("nodes") or []:
        x0, y0, x1, y1 = lc._occl_box(n)
        xs0.append(x0); ys0.append(y0); xs1.append(x1); ys1.append(y1)
    for g in doc.get("groups") or []:
        b = g.get("bounding")
        if b and len(b) == 4:
            xs0.append(float(b[0])); ys0.append(float(b[1]))
            xs1.append(float(b[0]) + float(b[2])); ys1.append(float(b[1]) + float(b[3]))
    if not xs0:
        return None
    return max(xs1) - min(xs0), max(ys1) - min(ys0)


def _zoom_of(doc) -> float | None:
    """整图缩放 = min(1600 / W, 900 / H),越小越要眯眼(design §5.1)。"""
    bbox = _main_bbox(doc)
    if bbox is None:
        return None
    w, h = bbox
    if w <= 0 or h <= 0:
        return None
    return round(min(1600.0 / w, 900.0 / h), 4)


# --- 逐件处理 -----------------------------------------------------------------------

def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _trial(doc: dict):
    """试算一次 normalize(当前运行参数 + 当前容差);走模块级 normalize 别名。"""
    return normalize(doc, params=ACTIVE_PARAMS, tol=_tol_fn(_ACTIVE_TOL))


# --allow-reformat 运行期白名单(main 填充;import 时为空)。
_ALLOW_REFORMAT: frozenset = frozenset()


def apply_one(path: Path, tol=cross_tol, _trial=None) -> dict:
    """写盘一件,fail-closed 链(design §5.3 顺序):
    normalize 无解 → unresolved;结构对拍不等 → strip_mismatch;幂等不成立 →
    not_idempotent;与原件相等 → unchanged 不碰;原格式还原不了且未获准重排 →
    format_special;获准 → 按缩进 2 重排写入(reason=reformatted);正常写入
    reason=None。完整性失败(读写异常)直接抛,由调用方计为失败。
    _trial=(文档, 报告) 可传入调用方已算好的试算结果(确定性相同,省一遍求解);
    缺省时内部现算 —— 契约测试 monkeypatch normalize 的路径。"""
    global _ACTIVE_TOL
    saved_tol = _ACTIVE_TOL
    _ACTIVE_TOL = tol
    try:
        raw = path.read_bytes()
        before_sha = _sha256(raw)
        old = json.loads(raw.decode("utf-8"))
        if _trial is None:
            doc, report = _trial_call(old)
        else:
            doc, report = _trial
        if doc is None:
            return {"written": False, "reason": "unresolved", "report": report,
                    "before_sha256": before_sha, "after_sha256": before_sha}
        if not lnorm.structurally_equal(old, doc):
            return {"written": False, "reason": "strip_mismatch", "report": report,
                    "before_sha256": before_sha, "after_sha256": before_sha}
        doc2, _rep2 = _trial_call(doc)
        if doc2 != doc:
            return {"written": False, "reason": "not_idempotent", "report": report,
                    "before_sha256": before_sha, "after_sha256": before_sha}
        if doc == old:
            return {"written": False, "reason": "unchanged", "report": report,
                    "before_sha256": before_sha, "after_sha256": before_sha}
        text = raw.decode("utf-8")
        try:
            rel = path.relative_to(COMFYUI).as_posix()
        except ValueError:
            rel = None
        if _restores_exactly(raw):
            new_text = dump_like(text, doc)
            reason = None
        elif rel is not None and rel in _ALLOW_REFORMAT:
            new_text = _reformat_text(text, doc)
            reason = "reformatted"
        else:
            return {"written": False, "reason": "format_special", "report": report,
                    "before_sha256": before_sha, "after_sha256": before_sha}
        new_bytes = new_text.encode("utf-8")
        path.write_bytes(new_bytes)
        reread = json.loads(path.read_bytes().decode("utf-8"))
        if reread != doc:
            path.write_bytes(raw)                 # 读回不等:恢复原文件再炸
            raise RuntimeError(f"写盘读回不等(完整性失败): {path}")
        return {"written": True, "reason": reason, "report": report,
                "before_sha256": before_sha, "after_sha256": _sha256(new_bytes)}
    finally:
        _ACTIVE_TOL = saved_tol


def _trial_call(doc):
    """apply_one 内部的试算入口(独立小函数,便于 _trial 参数缺省时统一走别名)。"""
    return _trial(doc)


def merge_far_baseline(old: dict, new: dict) -> dict:
    """间距棘轮:新值调低则更新、新件则加入、调高抛 ValueError(只降不升)。
    不改 old;返回合并结果。两次合并同一份 new 结果逐键相同。"""
    if not isinstance(old, dict) or not isinstance(old.get("files"), dict):
        raise ValueError(f"间距棘轮基线损坏(缺 files 字典): {type(old).__name__}")
    out = copy.deepcopy(old)
    for rel, entry in ((new or {}).get("files") or {}).items():
        new_scopes = (entry or {}).get("scopes") or {}
        cur = out["files"].get(rel)
        if cur is None:
            out["files"][rel] = copy.deepcopy(entry)
            continue
        cur_scopes = cur.setdefault("scopes", {})
        for scope, v in new_scopes.items():
            if scope in cur_scopes and int(v) > int(cur_scopes[scope]):
                raise ValueError(
                    f"间距棘轮只降不升: {rel} [{scope}] {cur_scopes[scope]} -> {v}")
            cur_scopes[scope] = int(v)
    return out


# --- 蓝图同步 -----------------------------------------------------------------------

def _scrub(x):
    if isinstance(x, dict):
        return {k: _scrub(v) for k, v in x.items() if k not in _BP_IGNORE_KEYS}
    if isinstance(x, list):
        return [_scrub(v) for v in x]
    return x


# 蓝图前置断言忽略键(design §6:除 id、state、last_link_id 外 canonical 全等;
# 蓝图独有键如 category 属同步规则「原值保留」的一侧,不构成漂移)。
_BP_IGNORE_KEYS = ("id", "state", "last_link_id")


def _canon(x) -> str:
    return json.dumps(x, ensure_ascii=False, sort_keys=True)


def _pre_drift_ok(bp_def: dict, head_def: dict) -> bool:
    """前置断言:蓝图现行定义与已提交版本宿主的同名定义「结构全等」——
    先剔布局字段(strip_layout,R6 白名单:蓝图经 --apply 整治后 pos/bounding
    与 HEAD 宿主必然不同,不算漂移),再除 id、state、last_link_id 做
    canonical 全等(宿主键全集逐键比;蓝图独有键容忍)。
    1127 回归修正:groups 键走合并豁免(structurally_equal)——整治按设计动作
    并组(§6 步骤 9)后,蓝图定义与 HEAD 宿主的组数合法地不同,严格比对会误报
    pre_drift,把蓝图同步整个卡死。"""
    wrap = lambda d: {"definitions": {"subgraphs": [d]}}
    sb = lnorm.strip_layout(wrap(bp_def))["definitions"]["subgraphs"][0]
    sh = lnorm.strip_layout(wrap(head_def))["definitions"]["subgraphs"][0]
    hb, hh = _scrub(sb), _scrub(sh)
    for k, hv in hh.items():
        if k not in hb:
            return False
        if k == "groups":
            # 合并豁免的方向:HEAD 宿主为「旧」,蓝图整治后为「新」(并组只收缩)。
            if not lnorm.structurally_equal({"groups": hv}, {"groups": hb[k]}):
                return False
        elif _canon(hb[k]) != _canon(hv):
            return False
    return True


def _subgraph_def(doc: dict, name: str):
    cands = [s for s in ((doc.get("definitions") or {}).get("subgraphs") or [])
             if s.get("name") == name]
    if len(cands) != 1:
        raise RuntimeError(f"同名子图定义应恰 1 个,实得 {len(cands)}: {name}")
    return cands[0]


def _git_show_head(repo_rel: str) -> str:
    r = subprocess.run(["git", "show", f"HEAD:{repo_rel}"], cwd=str(REPO),
                       capture_output=True, text=True, check=True)
    return r.stdout


def sync_blueprints() -> list[dict]:
    """按 BLUEPRINT_HOSTS 同步蓝图(design §6 P6);返回逐件
    {"blueprint", "written", "reason"};reason 取 None | unchanged | pre_drift | strip_mismatch。
    规则:前置断言(蓝图现行定义 ≈ 已提交版本宿主同名定义,除 id/state/last_link_id)
    → 换成工作树宿主定义深拷贝(id 用蓝图原来的,蓝图独有键原值保留,
    不新增宿主没有的键)→ 结构对拍(strip_layout)→ 新旧深度相等不写 →
    否则按原格式写回;重复执行结果为「无变化」。"""
    results = []
    bp_dir = COMFYUI / "my_nodes" / "subgraphs"
    for bp_name, (host_rel, sg_name) in BLUEPRINT_HOSTS.items():
        entry = {"blueprint": bp_name, "written": False, "reason": None}
        results.append(entry)
        bp_path = bp_dir / bp_name
        bp_raw = bp_path.read_bytes()
        bp_doc = json.loads(bp_raw.decode("utf-8"))
        bp_defs = (bp_doc.get("definitions") or {}).get("subgraphs") or []
        if len(bp_defs) != 1:
            entry["reason"] = "strip_mismatch"
            print(f"ERROR: {bp_name}: 蓝图应有恰 1 个子图定义,实得 {len(bp_defs)}",
                  file=sys.stderr)
            continue
        bp_def = bp_defs[0]
        head_doc = json.loads(_git_show_head(f"apps/backend/comfyui/{host_rel}"))
        try:
            head_def = _subgraph_def(head_doc, sg_name)
        except RuntimeError as e:
            entry["reason"] = "pre_drift"
            print(f"ERROR: {bp_name}: 已提交版本宿主里找不到同名定义 {sg_name}: {e}",
                  file=sys.stderr)
            continue
        if not _pre_drift_ok(bp_def, head_def):
            entry["reason"] = "pre_drift"
            continue
        host_doc = json.loads((COMFYUI / host_rel).read_text(encoding="utf-8"))
        host_def = _subgraph_def(host_doc, sg_name)
        new_def = copy.deepcopy(host_def)
        if "id" in bp_def:
            new_def["id"] = bp_def["id"]          # id 用蓝图原来的
        for k, v in bp_def.items():
            if k not in host_def:                 # 蓝图独有键原值保留
                new_def[k] = copy.deepcopy(v)
        old_wrap = {"definitions": {"subgraphs": [bp_def]}}
        new_wrap = {"definitions": {"subgraphs": [new_def]}}
        if not lnorm.structurally_equal(old_wrap, new_wrap):
            entry["reason"] = "strip_mismatch"
            continue
        if new_def == bp_def:
            entry["reason"] = "unchanged"
            continue
        new_doc = copy.deepcopy(bp_doc)
        new_doc["definitions"]["subgraphs"][0] = new_def
        bp_path.write_bytes(dump_like(bp_raw.decode("utf-8"), new_doc).encode("utf-8"))
        entry["written"] = True
    return results


# --- 报告 ---------------------------------------------------------------------------

_LIST_TITLES = {
    "groups_only": "只修组框未压缩",
    "merged": "并组过",
    "unresolved": "无解未写",
    "format_special": "格式特殊未写",
    "still_tiny": "整治后整图缩放仍偏小",
}

_METRIC_KEYS = ("group_overlap", "node_out_of_group", "edge_tight", "spacing_far")


def _sum_metric(files_report: dict, key: str, which: str) -> int:
    return sum(int(sc[which].get(key, 0))
               for entry in files_report.values()
               for sc in entry["scopes"].values())


def _build_report(mode: str, gui_total: int, in_scope: int, entries: dict,
                  params: dict) -> dict:
    """entries[rel] = {"old", "trial", "report", "written", "reason",
    "before_sha256", "after_sha256", "restorable", "scopes"(整治前已按原件口径覆写)}"""
    files = {}
    for rel, e in sorted(entries.items()):
        rep = e["report"] or {"scopes": {}}
        trial = e["trial"]
        bb = _main_bbox(e["old"])
        ab = _main_bbox(trial) if trial is not None else bb
        entry = {
            "written": bool(e["written"]),
            "reason": e["reason"],
            "before_sha256": e["before_sha256"],
            "after_sha256": e["after_sha256"],
            "area_before": round(bb[0] * bb[1]) if bb else None,
            "area_after": round(ab[0] * ab[1]) if ab else None,
            "zoom_before": _zoom_of(e["old"]),
            "zoom_after": _zoom_of(trial) if trial is not None else _zoom_of(e["old"]),
            "scopes": e.get("scopes") or {
                nm: {"rung": v["rung"], "before": v["before"],
                     "after": v["after"], "merges": v["merges"],
                     "unresolvable": v["unresolvable"]}
                for nm, v in rep["scopes"].items()},
        }
        files[rel] = entry

    unresolved = sorted(rel for rel, e in entries.items() if _is_unresolved(e))
    merged = sorted(rel for rel, e in entries.items()
                    if e["report"] is not None
                    and any(v["merges"] for v in e["report"]["scopes"].values()))
    # 并组是役内历史事件,不是当前状态:终检 --check 时已写盘的并组件已是
    # 不动点、本轮试算 merges=0,只记本轮会把役内并组史洗掉(1127 检查员发现:
    # 11 件并组写盘件从「并组过」清单消失,只剩 5 件未写盘无解件,R2「并组
    # 逐件写进报告」失真)。处置 = 与上一份报告的 merged 取并集,重跑/终检
    # 不失忆;役结束后要清零这份历史 = 删报告文件重出。
    try:
        _prev = json.loads(REPORT_JSON.read_text(encoding="utf-8"))
        _prev_merged = _prev.get("lists", {}).get("merged") or []
    except Exception:
        _prev_merged = []
    merged = sorted(set(merged)
                    | {p for p in _prev_merged if isinstance(p, str)})
    groups_only = sorted(rel for rel, e in entries.items()
                         if e["report"] is not None and e["report"]["scopes"]
                         and all(v["rung"] == "inf"
                                 for v in e["report"]["scopes"].values())
                         and e["trial"] is not None)
    fmt_entries = []
    for rel, e in sorted(entries.items()):
        if e["restorable"]:
            continue
        if e["written"] and e["reason"] == "reformatted":
            disposition = "已按裁决重排写入"
        else:
            disposition = "未写"
        fmt_entries.append({"file": rel, "disposition": disposition})
    still_tiny = sorted(rel for rel, e in entries.items()
                        if files[rel]["zoom_after"] is not None
                        and files[rel]["zoom_after"] < 0.25
                        and e["trial"] is not None)

    if mode == "apply":
        # 已建立不动点的件:写入成功(幂等已验)或本就无需改动;
        # 其余(无解 / 结构对拍 / 幂等 / 格式特殊 / 异常)的盘上状态不是不动点。
        non_fixed = sum(1 for e in entries.values()
                        if not e["written"] and e["reason"] != "unchanged")
    else:
        non_fixed = sum(1 for e in entries.values()
                        if e["trial"] is None or e["trial"] != e["old"])

    summary = {
        "gui_total": gui_total,
        "in_scope": in_scope,
        "overlap_before": _sum_metric(files, "group_overlap", "before"),
        "overlap_after": _sum_metric(files, "group_overlap", "after"),
        "out_before": _sum_metric(files, "node_out_of_group", "before"),
        "out_after": _sum_metric(files, "node_out_of_group", "after"),
        "tight_before": _sum_metric(files, "edge_tight", "before"),
        "tight_after": _sum_metric(files, "edge_tight", "after"),
        "far_before": _sum_metric(files, "spacing_far", "before"),
        "far_after": _sum_metric(files, "spacing_far", "after"),
        "non_fixed_point": non_fixed,
        "written": sum(1 for e in entries.values() if e["written"]),
    }
    return {
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "params": params,
        "summary": summary,
        "files": files,
        "lists": {"groups_only": groups_only, "merged": merged,
                  "unresolved": unresolved,
                  "format_special": fmt_entries,
                  "still_tiny": still_tiny},
    }


def _is_unresolved(e: dict) -> bool:
    """无解 = normalize 试算无文档可落(报告里各作用域 unresolvable)。
    仅有 report=None(完整性异常)不算无解 —— 那是另立口径的硬失败。"""
    rep = e["report"]
    if e["trial"] is not None or rep is None or not rep["scopes"]:
        return False
    return any(v["unresolvable"] for v in rep["scopes"].values())


def _report_md(rep: dict) -> str:
    s = rep["summary"]
    lines = ["# 全库工作流布局归一报告", "",
             f"- 生成时间:{rep['generatedAt']}",
             f"- 参数:{json.dumps(rep['params'], ensure_ascii=False)}",
             f"- GUI 件总数 {s['gui_total']},整治范围 {s['in_scope']};本次写入 {s['written']} 件",
             f"- 分组互遮 {s['overlap_before']} → {s['overlap_after']};"
             f"出组框 {s['out_before']} → {s['out_after']};"
             f"贴边 {s['tight_before']} → {s['tight_after']};"
             f"间距过远 {s['far_before']} → {s['far_after']};"
             f"非不动点 {s['non_fixed_point']}", ""]
    for key in ("groups_only", "merged", "unresolved", "format_special", "still_tiny"):
        lines.append(f"## {_LIST_TITLES[key]}")
        items = rep["lists"][key]
        if not items:
            lines.append("- (无)")
        for it in items:
            if isinstance(it, dict):
                lines.append(f"- {it['file']}({it['disposition']})")
            else:
                e = rep["files"][it]
                rungs = ",".join(f"{nm}:{v['rung']}" for nm, v in e["scopes"].items())
                tail = (f";缩放 {e['zoom_before']} → {e['zoom_after']}"
                        if e.get("zoom_after") is not None else "")
                lines.append(f"- {it}(档位 {rungs}{tail})")
        lines.append("")
    return "\n".join(lines)


# --- 间距棘轮基线 -------------------------------------------------------------------

def _baseline_payload(entries: dict) -> dict:
    """整治后逐件逐作用域 spacing_far;未上盘的件(无解/格式特殊/对拍拒写)取
    整治前——基线必须反映盘上真值,否则棘轮会被顶红(1127 回归修正)。
    未上盘件的一律取 before_full(盘上原件的全判据检查,覆盖全部作用域),
    不取 normalize 报告的 before——normalize 在首个无解作用域即整件返回,报告
    截断,其后的作用域会整段漏登(1127 晚实测:无解件的子图作用域缺席基线,
    机器门按上限 0 断红)。已上盘件(写入成功/本就不改)报告完整,取 after。"""
    files = {}
    for rel, e in sorted(entries.items()):
        on_disk_is_trial = e["trial"] is not None and (
            e.get("written") or e.get("reason") == "unchanged")
        scopes = {}
        if on_disk_is_trial:
            for nm, v in (e["report"]["scopes"] if e["report"] else {}).items():
                scopes[nm] = int(v["after"].get("spacing_far", 0))
        else:
            for nm, cnt in (e.get("before_full") or {}).items():
                scopes[nm] = int(cnt.get("spacing_far", 0))
        files[rel] = {"scopes": scopes}
    return {"files": files}


def write_far_baseline(entries: dict) -> dict:
    """把基线合并进 FAR_BASELINE(只增新件或调低,调高抛 ValueError)并写盘。
    返回写盘后的完整基线。"""
    derived = _baseline_payload(entries)
    if FAR_BASELINE.exists():
        old = json.loads(FAR_BASELINE.read_text(encoding="utf-8"))
    else:
        old = {"files": {}}
    merged = merge_far_baseline(old, derived)
    FAR_BASELINE.parent.mkdir(parents=True, exist_ok=True)
    FAR_BASELINE.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
    return merged


# --- 主流程 -------------------------------------------------------------------------

def main(argv=None) -> int:
    global _ACTIVE_TOL, _ALLOW_REFORMAT
    import argparse
    ap = argparse.ArgumentParser(
        description="全库工作流布局归一批处理(默认 --check 只读试算)")
    ap.add_argument("--check", action="store_true", help="只读试算 + 报告(默认)")
    ap.add_argument("--apply", action="store_true", help="写盘(fail-closed)")
    ap.add_argument("--only", action="append", default=[], metavar="相对键",
                    help="只处理列出的件(可重复;--write-far-baseline 不受影响)")
    ap.add_argument("--write-far-baseline", action="store_true",
                    help="写间距棘轮基线(恒全库;只降不升)")
    ap.add_argument("--sync-blueprints", action="store_true",
                    help="按 BLUEPRINT_HOSTS 同步蓝图(pre_drift/strip_mismatch → 退出 1)")
    ap.add_argument("--allow-reformat", action="append", default=[], metavar="相对键",
                    help="格式特殊件经用户同意整件重排(可重复)")
    ap.add_argument("--ht", type=float, default=None, help="同排间距目标档(缺省 320)")
    ap.add_argument("--vt", type=float, default=None, help="同列间距目标档(缺省 180)")
    ap.add_argument("--strict", action="store_true", help="守门容差全 0")
    ap.add_argument("--json", action="store_true", help="报告 JSON 另打到标准输出")
    args = ap.parse_args(argv)

    if args.ht is not None:
        ACTIVE_PARAMS["H_T"] = float(args.ht)
    if args.vt is not None:
        ACTIVE_PARAMS["V_T"] = float(args.vt)
    _ACTIVE_TOL = None if args.strict else cross_tol
    _ALLOW_REFORMAT = frozenset(args.allow_reformat)

    if args.sync_blueprints:
        results = sync_blueprints()
        for r in results:
            print(f"{r['blueprint']}: written={r['written']} reason={r['reason']}")
        bad = [r for r in results if r["reason"] in ("pre_drift", "strip_mismatch")]
        return 1 if bad else 0

    scan_all = _scan_gui_all()
    paths = dict(scan_all)
    in_scope_keys = [rel for rel, _p in scan_all if rel not in EXCLUDE]
    if args.only:
        unknown = [k for k in args.only if k not in set(in_scope_keys)]
        if unknown:
            print("ERROR: --only 相对键不在整治范围内: " + "; ".join(unknown),
                  file=sys.stderr)
            return 2
        targets = list(dict.fromkeys(args.only))
    else:
        targets = in_scope_keys

    apply_mode = bool(args.apply)
    entries: dict = {}
    integrity_fail = 0
    for rel in sorted(targets):
        path = paths[rel]
        raw = path.read_bytes()
        old = json.loads(raw.decode("utf-8"))
        before_sha = _sha256(raw)
        restorable = _restores_exactly(raw)
        entry = {"old": old, "trial": None, "report": None,
                 "written": False, "reason": None,
                 "before_sha256": before_sha, "after_sha256": before_sha,
                 "restorable": restorable, "scopes": None}
        # 「整治前」口径 = 原件全判据(check_workflow)。normalize 报告的 before
        # 是其内部不动点迭代「末轮求解轮」的 before(第二轮起在已解文档上取数),
        # 不是原件口径 —— 报告与 AC5 对账一律以这里的覆写为准。
        orig_reps = lc.check_workflow(old, layout={"ht": ACTIVE_PARAMS["H_T"],
                                                   "vt": ACTIVE_PARAMS["V_T"]})
        before_override = {r["name"]: {**r["counts"], **(r.get("layout") or {})}
                           for r in orig_reps}
        # 盘上真值的完整作用域覆盖(check_workflow 不因无解早退);间距基线的
        # 未上盘件从这里取数(_baseline_payload)。
        entry["before_full"] = before_override
        if apply_mode:
            loop_doc, loop_rep = _trial(old)      # 与 apply_one 内部同参,确定性一致
            try:
                res = apply_one(path, tol=_ACTIVE_TOL, _trial=(loop_doc, loop_rep))
            except Exception as exc:
                integrity_fail += 1
                print(f"ERROR: {rel}: 完整性失败 {type(exc).__name__}: {exc}",
                      file=sys.stderr)
                res = {"written": False, "reason": None, "report": None}
            entry["written"] = bool(res.get("written"))
            entry["reason"] = res.get("reason")
            if res["report"] is not None:
                entry["report"] = res["report"]
                if res["written"]:
                    entry["trial"] = json.loads(path.read_bytes().decode("utf-8"))
                    entry["after_sha256"] = res["after_sha256"]
                elif res["reason"] == "unchanged":
                    entry["trial"] = old
                else:
                    entry["trial"] = loop_doc
        else:
            doc, report = _trial(old)
            entry["trial"] = doc
            entry["report"] = report
        if entry["report"] is not None:
            rep = entry["report"]
            entry["scopes"] = {
                nm: {"rung": v["rung"],
                     "before": before_override.get(nm, v["before"]),
                     "after": v["after"], "merges": v["merges"],
                     "unresolvable": v["unresolvable"]}
                for nm, v in rep["scopes"].items()}
        entries[rel] = entry
        if entry["report"] is None:
            print(f"{rel}: 完整性失败,无汇总数字")
            continue
        scopes = entry["scopes"]
        before = {k: sum(int(v["before"].get(k, 0)) for v in scopes.values())
                  for k in _METRIC_KEYS}
        after = {k: sum(int(v["after"].get(k, 0)) for v in scopes.values())
                 for k in _METRIC_KEYS}
        rungs = ",".join(f"{nm}:{v['rung']}" for nm, v in scopes.items())
        tag = entry["reason"] or ("written" if entry["written"] else "check")
        print(f"{rel}: 组遮 {before['group_overlap']}->{after['group_overlap']} "
              f"出框 {before['node_out_of_group']}->{after['node_out_of_group']} "
              f"贴边 {before['edge_tight']}->{after['edge_tight']} "
              f"远距 {before['spacing_far']}->{after['spacing_far']} "
              f"档位[{rungs}] {tag}")

    # --write-far-baseline:恒全库(不受 --only 影响),范围内其余件补算一遍
    if args.write_far_baseline:
        base_entries = dict(entries)
        for rel in in_scope_keys:
            if rel in base_entries:
                continue
            old = json.loads(paths[rel].read_bytes().decode("utf-8"))
            doc, report = _trial(old)
            reps = lc.check_workflow(old, layout={"ht": ACTIVE_PARAMS["H_T"],
                                                  "vt": ACTIVE_PARAMS["V_T"]},
                                     checks=("group_overlap",))
            base_entries[rel] = {"old": old, "trial": doc, "report": report,
                                 "written": False, "reason": None,
                                 "before_sha256": "", "after_sha256": "",
                                 "restorable": True,
                                 "before_full": {r["name"]: {**r["counts"],
                                                             **(r.get("layout") or {})}
                                                 for r in reps}}
        merged = write_far_baseline(base_entries)
        print(f"间距棘轮基线已写 {len(merged['files'])} 件: {FAR_BASELINE}")

    params = {"mode": "apply" if apply_mode else "check",
              "ht": ACTIVE_PARAMS["H_T"], "vt": ACTIVE_PARAMS["V_T"],
              "strict": args.strict, "only": list(args.only),
              "allow_reformat": list(args.allow_reformat)}
    report = _build_report("apply" if apply_mode else "check",
                           len(scan_all), len(in_scope_keys), entries, params)
    if args.only:
        # --only 是运维操作,不覆盖全库报告(报告的并组史/全库 summary 是役级
        # 台账;1127 晚:单件 apply 把全库报告洗成 1 件,且 _report_md 对上一
        # 份报告的并集键取值崩掉)。
        s = report["summary"]
        print(f"[--only] 单件运行,不写全库报告;本件写入 {s['written']} 件,"
              f"非不动点 {s['non_fixed_point']}")
    else:
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        REPORT_MD.write_text(_report_md(report), encoding="utf-8")
        s = report["summary"]
        print(f"GUI 件 {s['gui_total']},范围内 {s['in_scope']};"
              f"组遮 {s['overlap_before']}->{s['overlap_after']},"
              f"出框 {s['out_before']}->{s['out_after']},"
              f"贴边 {s['tight_before']}->{s['tight_after']},"
              f"远距 {s['far_before']}->{s['far_after']},"
              f"非不动点 {s['non_fixed_point']},写入 {s['written']}")
        print(f"报告:{REPORT_JSON}")
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    if apply_mode and integrity_fail:
        print(f"完整性失败 {integrity_fail} 件", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
