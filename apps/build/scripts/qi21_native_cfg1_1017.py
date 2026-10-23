#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21_native_cfg1_1017.py — 1017 原生出图档 cfg 4→1 随刀(ComfyUI 工作流 JSON 手术)

役目(1017):
  1) t2i/i2i 两件工作流的加速子图「道劫·加速子图」内 [7010] 原生出图·KSampler
     cfg 位 4→1(术前断言现值=4;i2i 侧已是 1 则跳过该件并打印)。
     同一刀同时改 widget 双存储:widgets_values[3](列表形)与 widgets_values_named.cfg
     (字典形,新前端读此形,只改一处会留自相矛盾残值)。
  2) 全文档扫 Note/MarkdownNote([402]/[7016] 等)里「cfg4/cfg=4」字样,
     随刀为「cfg1(负向不参与采样)」口径(新文案不含 cfg4/cfg=4 字面,保幂等残检=0)。
  3) 契约测试 test_qwen21_workflow_contract.py 与 fire 脚本 qi21_t2i_workflow_fire.py
     是否钉死原生档 cfg=4——只检查只报告,一个字节不动(锚归下一手)。

fail-closed:任何术前锚/格式锚/回读终验不符 → exit 1,主件零写(tmp 即清)。
幂等:两件均已在目标态(cfg=1 且全文档无 cfg4/cfg=4 残留)→ exit 3。
退出码:0=本轮有改刀;1=断言失败(fail-closed);3=无事可做(已=1)。

布局零变:纯 widget 改值+Note 文本。格式锚=原文件与
  json.dumps(doc, ensure_ascii=False, indent=2) 逐字节一致(改前断言,不一致即拒刀);
  改后深度 diff 终验:全树差集必须恰好等于本轮记账改点(多一处少一处都 exit 1)。
备份:写前 <目标>.json.bak-cfg1-1017(copy2);.bak-* 不入库循 0 先例。

用法:python3 apps/build/scripts/qi21_native_cfg1_1017.py   (仓库根为 CWD 或任意 CWD 均可)
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]  # apps/build/scripts/<本件> → 仓库根

T2I = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
I2I = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
CONTRACT_TEST = REPO / "apps/backend/comfyui/tests/test_qwen21_workflow_contract.py"
FIRE_SCRIPT = REPO / "apps/build/scripts/qi21_t2i_workflow_fire.py"

TAG = "[cfg1-1017]"
BACKUP_SUFFIX = ".bak-cfg1-1017"
TMP_SUFFIX = ".tmp-cfg1-1017"

ACCEL_SUBGRAPH_NAME = "道劫·加速子图"
KS_ID = 7010
CFG_IDX = 3  # KSampler widgets_values 列表形 cfg 槽位
CFG_OLD, CFG_NEW = 4, 1

# [7010] KSampler widget 术前锚(None=cfg 槽,另论);非 cfg 位两件都必须逐位相等。
KS_WV_TEMPLATE = [0, "fixed", 40, None, "euler", "simple", 1]
KS_WVN_TEMPLATE = {
    "seed": 0, "control_after_generate": "fixed", "steps": 40, "cfg": None,
    "sampler_name": "euler", "scheduler": "simple", "denoise": 1,
}

# Note 口径替换表:(旧锚, 新文, t2i 现量期望)。i2i 现量全 0(其 cfg 早已=1,Note 无 cfg4)。
# 新文一律不含「cfg4/cfg=4」字面,保证术后残检 r"cfg4|cfg=4"==0、重跑幂等。
# 记账口径:R1..R6 的旧锚各含一处 cfg4/cfg=4 字面 → t2i 术前残检总数=2+2+2+4+2+2=14;
# R7(「实值 40/4」值档)不含该字面,单独计数。
NOTE_RULES = [
    # R1 MarkdownNote[402] 标题行(×2 存储)
    ("负面线说明(cfg=4 负向真实生效,1004 用户令)",
     "负面线说明(cfg1 负向不参与采样,1017 随刀;1004 旧口径退役)", 2),
    # R2 MarkdownNote[402] 加粗要点(×2 存储)
    ("**cfg=4 下负面提示词真实参与采样**",
     "**cfg1 下负面提示词不参与采样(1017 随刀)**", 2),
    # R3 MarkdownNote[402] 档位清单行(×2 存储)
    ("·**cfg4**(1004 用户令,负向真实生效)",
     "·**cfg1**(1017 随刀,负向不参与采样;1004 旧口径退役)", 2),
    # R4 两处 Note 共句(402×2 存储 + 7016×2 存储 = 4)
    ("负向仅档1(原生出图 cfg4)生效",
     "负向仅档1(原生出图 cfg1)接线、负向不参与采样", 4),
    # R5 Note[7016] 三支路总起句(×2 存储;两存储文本已漂移,此句为共锚)
    ("②档1 原生出图 cfg4=",
     "②档1 原生出图 cfg1(负向不参与采样)=", 2),
    # R6 Note[7016] ③支路说明句(×2 存储;尾文两形各异,此句为共锚)
    ("cfg4=负向真实生效档",
     "cfg1、负向不参与采样(1017 随刀,旧「负向真实生效档」口径作废)", 2),
    # R7 Note[7016] widgets_values 形独有:1017 勘误链里的值档「实值 40/4」(named 形仍是旧 drift 文)
    ("实值 40/4))",
     "实值 40步,1017 cfg 改 1))", 1),
]
RESIDUAL_RE = re.compile(r"cfg4|cfg=4")
EXPECTED_RESIDUAL_T2I = 14  # = sum(r.expected for R1..R6)

# ── 第 3 项:外部钉锚只报不动(rg 口径 + 补充口径) ─────────────────────────
PIN_FILES = [
    ("契约测试", CONTRACT_TEST),
    ("fire脚本", FIRE_SCRIPT),
]
PIN_RG_PATTERN = re.compile(r"cfg.?4|, 4,")            # 问令钦定 rg 口径
PIN_JSON_PATTERN = re.compile(r'"cfg"\s*:\s*4(?![0-9])')  # 补充:rg 单字通配漏杀 "cfg": 4.0(实弹 fire:262);负 lookahead 排 40


class SurgeryError(RuntimeError):
    """fail-closed 断言失败:打印后 exit 1,主件零写。"""


def log(msg: str) -> None:
    print(f"{TAG} {msg}", flush=True)


def die(msg: str) -> "SurgeryError":
    return SurgeryError(msg)


# ── 定位与读档 ──────────────────────────────────────────────────────────────

def load_raw(path: Path) -> str:
    if not path.is_file():
        raise die(f"目标缺失: {path}")
    return path.read_text(encoding="utf-8")


def check_format_anchor(raw: str, label: str) -> None:
    """格式锚:原文件必须与 indent=2/ensure_ascii=False 序列化逐字节一致,否则拒刀。"""
    doc = json.loads(raw)
    if json.dumps(doc, ensure_ascii=False, indent=2) != raw:
        raise die(f"{label}: 格式锚不符(indent=2/ensure_ascii=False 不复现原字节),拒刀防整件重排")


def iter_node_paths(doc: dict):
    """产出 (path, node):path 形如 $.nodes[8] / $.definitions.subgraphs[1].nodes[5]。"""
    for i, n in enumerate(doc.get("nodes", []) or []):
        yield f"$.nodes[{i}]", n
    for si, sg in enumerate((doc.get("definitions") or {}).get("subgraphs") or []):
        for ni, n in enumerate(sg.get("nodes", []) or []):
            yield f"$.definitions.subgraphs[{si}].nodes[{ni}]", n


def locate_ksampler(doc: dict, label: str) -> tuple[str, dict]:
    """定位唯一的道劫·加速子图内 [7010] KSampler,返回其 JSON 路径与节点。"""
    sgs = [sg for sg in (doc.get("definitions") or {}).get("subgraphs") or []
           if sg.get("name") == ACCEL_SUBGRAPH_NAME]
    if len(sgs) != 1:
        raise die(f"{label}: 加速子图「{ACCEL_SUBGRAPH_NAME}」应恰有 1 个,实得 {len(sgs)}")
    hits = [(p, n) for p, n in iter_node_paths(doc)
            if n.get("id") == KS_ID]
    if len(hits) != 1:
        raise die(f"{label}: 节点 [{KS_ID}] 应全文档恰有 1 个,实得 {len(hits)}")
    path, node = hits[0]
    if not path.startswith(f"$.definitions.subgraphs["):
        raise die(f"{label}: [{KS_ID}] 不在子图内: {path}")
    if node.get("type") != "KSampler":
        raise die(f"{label}: [{KS_ID}] type 应 KSampler,实得 {node.get('type')!r}")
    if "原生出图" not in (node.get("title") or ""):
        raise die(f"{label}: [{KS_ID}] title 应含「原生出图」,实得 {node.get('title')!r}")
    return path, node


def read_cfg_pair(node: dict) -> tuple[object, object]:
    wv = node.get("widgets_values")
    wvn = node.get("widgets_values_named")
    if not isinstance(wv, list) or len(wv) != len(KS_WV_TEMPLATE):
        raise die(f"[{KS_ID}] widgets_values 形不符: {wv!r}")
    if not isinstance(wvn, dict) or set(wvn.keys()) != set(KS_WVN_TEMPLATE.keys()):
        raise die(f"[{KS_ID}] widgets_values_named 键集不符: {wvn!r}")
    for i, want in enumerate(KS_WV_TEMPLATE):
        if want is not None and wv[i] != want:
            raise die(f"[{KS_ID}] widgets_values[{i}] 应 {want!r},实得 {wv[i]!r}(术前锚失位)")
    for k, want in KS_WVN_TEMPLATE.items():
        if want is not None and wvn[k] != want:
            raise die(f"[{KS_ID}] widgets_values_named.{k} 应 {want!r},实得 {wvn[k]!r}(术前锚失位)")
    if wv[CFG_IDX] != wvn["cfg"]:
        raise die(f"[{KS_ID}] cfg 双存储自相矛盾: list={wv[CFG_IDX]!r} named={wvn['cfg']!r}")
    if wv[CFG_IDX] not in (CFG_OLD, CFG_NEW):
        raise die(f"[{KS_ID}] cfg 现值 {wv[CFG_IDX]!r} 不在 {{{CFG_OLD}, {CFG_NEW}}},不在本役射程")
    return wv[CFG_IDX], wvn["cfg"]


# ── Note 存储 ───────────────────────────────────────────────────────────────

class NoteStore:
    """记名存储:持有 (node, getter, setter, path),避免闭包晚绑定坑。"""

    def __init__(self, node: dict, getter, setter, path: str):
        self.node, self.getter, self.setter, self.path = node, getter, setter, path

    def text(self) -> str:
        return self.getter(self.node)

    def set(self, v: str) -> None:
        self.setter(self.node, v)


def collect_note_stores(doc: dict) -> list[NoteStore]:
    stores = []
    for p, n in iter_node_paths(doc):
        if n.get("type") not in ("Note", "MarkdownNote"):
            continue
        wv = n.get("widgets_values")
        if isinstance(wv, str):
            stores.append(NoteStore(n, lambda nn: nn["widgets_values"],
                                    lambda nn, v: nn.__setitem__("widgets_values", v),
                                    f"{p}.widgets_values"))
        elif isinstance(wv, list) and wv and isinstance(wv[0], str):
            stores.append(NoteStore(n, lambda nn: nn["widgets_values"][0],
                                    lambda nn, v: nn["widgets_values"].__setitem__(0, v),
                                    f"{p}.widgets_values[0]"))
        wvn = n.get("widgets_values_named")
        if isinstance(wvn, dict) and isinstance(wvn.get("text"), str):
            stores.append(NoteStore(n, lambda nn: nn["widgets_values_named"]["text"],
                                    lambda nn, v: nn["widgets_values_named"].__setitem__("text", v),
                                    f"{p}.widgets_values_named.text"))
    return stores


def count_fragment(stores: list[NoteStore], fragment: str) -> int:
    return sum(s.text().count(fragment) for s in stores)


# ── 深度 diff 终验 ──────────────────────────────────────────────────────────

def collect_diffs(a, b, path="$", out=None):
    """递归收集 a/b 全部差异叶路径(含键缺失/长度不一致的容器整体)。"""
    if out is None:
        out = []
    if type(a) is not type(b):
        out.append(path)
        return out
    if isinstance(a, dict):
        for k in set(a) | set(b):
            if k not in a or k not in b:
                out.append(f"{path}.{k}")
            else:
                collect_diffs(a[k], b[k], f"{path}.{k}", out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(path)
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                collect_diffs(x, y, f"{path}[{i}]", out)
    else:
        if a != b:
            out.append(path)
    return out


# ── 主刀 ────────────────────────────────────────────────────────────────────

def operate_work_file(path: Path, label: str, note_counts_expected: dict[int, int] | None) -> bool:
    """对单件工作流执刀。返回 True=本轮有改写;False=已在目标态(跳过/无改)。

    note_counts_expected:非 None 时(=t2i)锚计数必须逐条相等才许动 Note;
                          None 时(=i2i)要求锚计数全 0(其 cfg 早已=1,应无 cfg4 文案)。
    """
    raw = load_raw(path)
    check_format_anchor(raw, label)
    doc = json.loads(raw)
    pristine = json.loads(raw)  # 终验基线(不被本轮突变污染)

    ks_path, ks_node = locate_ksampler(doc, label)
    cfg_list, cfg_named = read_cfg_pair(ks_node)
    stores = collect_note_stores(doc)
    counts = {idx: count_fragment(stores, old) for idx, (old, _, _) in enumerate(NOTE_RULES)}
    residual = len(RESIDUAL_RE.findall(raw))

    widget_todo = cfg_list == CFG_OLD
    notes_todo = any(c > 0 for c in counts.values())

    if not widget_todo and not notes_todo:
        if residual != 0:
            raise die(f"{label}: cfg 已={CFG_NEW} 且锚表全 0,但残检 cfg4/cfg=4={residual}≠0"
                      f"(锚表外新出 cfg4 文案,超出本役记账,人工核)")
        log(f"{label}: [{KS_ID}] cfg 双存储已={CFG_NEW}(list+named)且无 cfg4/cfg=4 残留 → 该件无事可做")
        return False

    mutated: list[str] = []  # 记账改点(深度 diff 终验白名单)

    # —— 1) widget 双存储 cfg 4→1 ——
    if widget_todo:
        assert ks_node["widgets_values"][CFG_IDX] == CFG_OLD and \
               ks_node["widgets_values_named"]["cfg"] == CFG_OLD
        ks_node["widgets_values"][CFG_IDX] = CFG_NEW
        ks_node["widgets_values_named"]["cfg"] = CFG_NEW
        mutated += [f"{ks_path}.widgets_values[{CFG_IDX}]", f"{ks_path}.widgets_values_named.cfg"]
        log(f"{label}: [{KS_ID}] cfg {CFG_OLD}→{CFG_NEW}(widgets_values[{CFG_IDX}] + widgets_values_named.cfg 双存储)")
    else:
        log(f"{label}: [{KS_ID}] cfg 双存储已={CFG_NEW} → widget 位跳过")

    # —— 2) Note 口径随刀 ——
    if notes_todo:
        if note_counts_expected is None:
            raise die(f"{label}: 非记账主件却现 Note 锚 {counts}(i2i 应全 0,状态越账,拒刀)")
        for idx, (old, new, _want) in enumerate(NOTE_RULES):
            if counts[idx] != note_counts_expected[idx]:
                raise die(f"{label}: Note 锚 R{idx + 1} 计数 {counts[idx]} ≠ 期望 {note_counts_expected[idx]}"
                          f"(锚失位/文本再漂移,拒刀): {old!r}")
        for store in stores:
            text = store.text()
            new_text = text
            for old, new, _want in NOTE_RULES:
                new_text = new_text.replace(old, new)
            if new_text != text:
                store.set(new_text)
                mutated.append(store.path)
        applied = {idx: count_fragment(stores, new) for idx, (_o, new, _w) in enumerate(NOTE_RULES)}
        for idx, (old, new, want) in enumerate(NOTE_RULES):
            if applied[idx] != want:
                raise die(f"{label}: 术后新文计数 R{idx + 1}={applied[idx]} ≠ {want}: {new!r}")
        log(f"{label}: Note 口径 7 刀全中(R1..R7 计数 "
            + "/".join(str(note_counts_expected[i]) for i in range(len(NOTE_RULES))) + ")")

    # —— 残检一致性(术前):锚表字面总数必须等于全文档残检,防锚外 cfg4 藏身处 ——
    anchor_literal_total = sum(counts[i] for i in range(6))  # R1..R6 含 cfg4/cfg=4 字面;R7 不含
    if widget_todo:
        anchor_literal_total += 0  # widget 数值位("cfg": 4)不匹配 r"cfg4|cfg=4",不计
    if residual != anchor_literal_total:
        raise die(f"{label}: 术前残检 {residual} ≠ 锚表字面总数 {anchor_literal_total}"
                  f"(存在锚表外 cfg4/cfg=4 文案,超出记账,拒刀)")

    # —— 序列化 + tmp 全量终验(主件仍零写;写 tmp 亦在 try 内,失败即清) ——
    new_raw = json.dumps(doc, ensure_ascii=False, indent=2)
    tmp = path.with_name(path.name + TMP_SUFFIX)

    try:
        tmp.write_text(new_raw, encoding="utf-8")
        # 终验 1:回读 tmp,格式锚自洽
        reread = tmp.read_text(encoding="utf-8")
        if reread != new_raw:
            raise die(f"{label}: tmp 回读字节不等(磁盘异象)")
        tmp_doc = json.loads(reread)
        if json.dumps(tmp_doc, ensure_ascii=False, indent=2) != reread:
            raise die(f"{label}: 术后格式锚不符(整件被重排)")
        # 终验 2:深度 diff——差集必须恰好等于记账改点
        diffs = collect_diffs(pristine, tmp_doc)
        if sorted(diffs) != sorted(mutated):
            raise die(f"{label}: 深度 diff 终验不符\n  实得差集: {sorted(diffs)}\n  记账改点: {sorted(mutated)}")
        # 终验 3:cfg 双存储=1
        _, ks_after = locate_ksampler(tmp_doc, label + "/tmp")
        c_l, c_n = read_cfg_pair(ks_after)
        if (c_l, c_n) != (CFG_NEW, CFG_NEW):
            raise die(f"{label}: 术后 cfg=({c_l!r},{c_n!r}) ≠ ({CFG_NEW},{CFG_NEW})")
        # 终验 4:全文档 cfg4/cfg=4 残检=0
        if len(RESIDUAL_RE.findall(reread)) != 0:
            raise die(f"{label}: 术后残检 cfg4/cfg=4 ≠ 0")
        # 终验 5:布局零变——除记账改点外 nodes/links/groups 全同已由终验 2 保证,
        #         此处加验节点数与 last_node_id/last_link_id 不变(双保险)
        for key in ("last_node_id", "last_link_id"):
            if pristine.get(key) != tmp_doc.get(key):
                raise die(f"{label}: {key} 漂移 {pristine.get(key)!r}→{tmp_doc.get(key)!r}")
        if len(pristine.get("nodes", [])) != len(tmp_doc.get("nodes", [])):
            raise die(f"{label}: 主管区节点数漂移")
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    # —— 备份 + 原子落盘 ——
    bak = path.with_name(path.name + BACKUP_SUFFIX)
    shutil.copy2(path, bak)
    os.replace(tmp, path)

    # —— 回读主件终验(真回读) ——
    final_raw = path.read_text(encoding="utf-8")
    if final_raw != new_raw:
        raise die(f"{label}: 主件回读与 tmp 终验文本不等(落盘中断;备份在 {bak.name})")
    final_doc = json.loads(final_raw)
    _, ks_final = locate_ksampler(final_doc, label + "/final")
    c_l, c_n = read_cfg_pair(ks_final)
    if (c_l, c_n) != (CFG_NEW, CFG_NEW):
        raise die(f"{label}: 主件回读 cfg≠{CFG_NEW}(备份在 {bak.name})")
    if len(RESIDUAL_RE.findall(final_raw)) != 0:
        raise die(f"{label}: 主件回读残检 cfg4/cfg=4 ≠ 0(备份在 {bak.name})")
    log(f"{label}: 落盘+回读终验过(备份 {bak.name};差集恰=记账 {len(mutated)} 改点)")
    return True


# ── 第 3 项:外部钉锚只报不动 ───────────────────────────────────────────────

def report_external_pins() -> None:
    log("── 第3项 外部 cfg=4 钉锚检查(只报告不动,锚归下一手)──")
    for label, path in PIN_FILES:
        if not path.is_file():
            log(f"  {label}: 文件缺失 {path}")
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        rg_hits: list[tuple[int, str]] = []
        json_hits: list[tuple[int, str]] = []
        for no, line in enumerate(lines, 1):
            if PIN_RG_PATTERN.search(line):
                rg_hits.append((no, line))
            if PIN_JSON_PATTERN.search(line):
                json_hits.append((no, line))
        log(f"  {label} {path.relative_to(REPO)}:")
        log(f"    rg 'cfg.?4|, 4,' 命中 {len(rg_hits)} 行;补充口径 r'\"cfg\": 4' 命中 {len(json_hits)} 行"
            f"(rg 单字通配漏杀 JSON 形,补此口径)")
        for no, line in rg_hits:
            log(f"      {no}: {line.strip()[:160]}")
        for no, line in json_hits:
            log(f"      [json口径] {no}: {line.strip()[:160]}")
        text = "\n".join(lines)
        if label == "契约测试":
            pins = []
            if re.search(r"ks_cfgs\s*=\s*\(\s*4\s*,", text):
                pins.append("ks_cfgs=(4, 1)(≈L3457)")
            if re.search(r"want_cfgs\s*=.*\[1,\s*4\]", text) or re.search(r"want_cfgs\s*=\s*\(\[4\]", text):
                pins.append("want_cfgs 含 4(≈L2073)")
            if re.search(r"「?原生出图 cfg4」?", text) or '"cfg4"' in text or '"原生出图 cfg4"' in text:
                pins.append("Note 钉 token「原生出图 cfg4」/「cfg4」(≈L3508/L4149)")
            verdict = "是 → " + ";".join(pins) if pins else "否"
        else:
            verdict = "是 → fire 原生支路硬编 \"cfg\": 4.0(≈L262)" if json_hits else "否"
        log(f"    ▶ 钉死原生档 cfg=4:{verdict}(本轮不动,锚归下一手)")


# ── 入口 ────────────────────────────────────────────────────────────────────

def main() -> int:
    log("1017 原生出图档 cfg 4→1 随刀开工(t2i 主刀;i2i 已=1 则跳过)")
    changed = False
    try:
        # t2i:主刀件(Note 七锚计数必须逐条相符)
        expected = {idx: want for idx, (_o, _n, want) in enumerate(NOTE_RULES)}
        if operate_work_file(T2I, "t2i", expected):
            changed = True
        # i2i:cfg 已=1 → 跳过该件(仍过锚/残检;若现 cfg4 文案则越账拒刀)
        if operate_work_file(I2I, "i2i", None):
            changed = True
        report_external_pins()
    except SurgeryError as e:
        log(f"[FAIL] {e}")
        log("fail-closed:主件未落盘即拒;已落盘则回读终验拒(留 .bak 可回滚)")
        return 1
    if changed:
        log("收刀:本轮有改写,exit 0")
        return 0
    log("幂等:两件均已在目标态(cfg=1 且无 cfg4/cfg=4 残留),无事可做,exit 3")
    return 3


if __name__ == "__main__":
    sys.exit(main())
