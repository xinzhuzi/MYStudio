#!/usr/bin/env python3
"""qi21 工作流/蓝图文字快照刷新(10-09-qi21-prompt-layer-conflict Phase 5.1/5.2,D8)。

只刷两类 widget 值,对齐 qi21_bases.json 现值(契约测试同口径):
  - [4011] MyQi21PromptAssembly.widgets_values[1] 锁层A全文 = art_style_base.positive_text
    (i2i 工作流子图 / i2i 蓝图子图 / img2img 工作流顶层;运行时逐字使用)
  - [4032] MyQi21美术风格底座 五值展示快照 = 四字段 strip + 四段协议文
    (t2i 蓝图子图 / t2i 工作流子图;output() 热读 JSON,快照只供面板展示与蓝图↔宿主互锁)
守卫:30 分钟 mtime 静默门;原文按 JSON 编码串精确 splice(命中数须等于计划槽数);
写前 cp 备份 backups/snapshots/;写后整文解析 == 改前解析仅替换白名单槽(其余逐值不变)。
默认 dry-run,--apply 落盘并写 research/snapshots.json。

用法:python3 apps/build/scripts/qi21_layer_conflict_snapshots.py [--apply]
"""
import argparse
import copy
import json
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2].parent
TASK = REPO / ".trellis/tasks/10-09-qi21-prompt-layer-conflict"
SOURCE = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
SG_DIR = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs"
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
SG_PREFIX = "[6] 文本提示词类型优化子图"
QUIET_S = 30 * 60
STYLE_FIELDS = ("positive_style_text", "positive_ground_text", "rgba_text", "negative_text")
STYLE_NAMES = ("风格工艺件", "底色背景件", "透明承载件", "负向词表")
ASM, BASE = ("MyQi21PromptAssembly", 4011), ("MyQi21美术风格底座", 4032)
# (标签, 文件, 节点位置 top|subgraph, 节点(类型,id), 槽→值键)
TARGETS = (
    ("i2i-wf", WF_DIR / "2_图生图/qi21-道劫-i2i.json", "subgraph", ASM, {1: "lock_a"}),
    ("i2i-bp", SG_DIR / "qi21-提示词类型优化子图-i2i.json", "subgraph", ASM, {1: "lock_a"}),
    ("img2img-wf", WF_DIR / "2_图生图/qi21-道劫-img2img.json", "top", ASM, {1: "lock_a"}),
    ("t2i-bp", SG_DIR / "qi21-提示词类型优化子图.json", "subgraph", BASE, {i: f"base{i}" for i in range(5)}),
    ("t2i-wf", WF_DIR / "1_文生图/qi21-道劫-t2i.json", "subgraph", BASE, {i: f"base{i}" for i in range(5)}),
)


def truth_values() -> dict:
    a = json.loads(SOURCE.read_text(encoding="utf-8"))["art_style_base"]
    vals = [a[f].strip() for f in STYLE_FIELDS]
    protocol = "\n".join(f"【{n}】{v}" for n, v in zip(STYLE_NAMES, vals))
    return {"lock_a": a["positive_text"], **{f"base{i}": v for i, v in enumerate([*vals, protocol])}}


def locate(doc: dict, where: str, node_key: tuple) -> dict:
    if where == "top":
        nodes = doc["nodes"]
    else:
        sgs = [s for s in doc["definitions"]["subgraphs"] if s.get("name", "").startswith(SG_PREFIX)]
        if len(sgs) != 1:
            raise SystemExit(f"子图定义命中 {len(sgs)} 份(须 1)")
        nodes = sgs[0]["nodes"]
    hits = [n for n in nodes if n.get("id") == node_key[1]]
    if len(hits) != 1 or hits[0].get("type") != node_key[0]:
        raise SystemExit(f"节点 {node_key} 定位失败:命中 {[(n.get('id'), n.get('type')) for n in hits]}")
    return hits[0]


def plan_one(label, path, where, node_key, slots, truth) -> dict:
    age = time.time() - path.stat().st_mtime
    if age < QUIET_S:
        raise SystemExit(f"{label} mtime 距今 {int(age)}s < {QUIET_S}s 静默门,他方可能在写,停")
    raw = path.read_text(encoding="utf-8")
    before = json.loads(raw)
    after = copy.deepcopy(before)
    node = locate(after, where, node_key)
    edits = []
    for slot, key in slots.items():
        old, new = node["widgets_values"][slot], truth[key]
        if old != new:
            edits.append((slot, old, new))
            node["widgets_values"][slot] = new
    text = raw
    for old in {e[1] for e in edits}:
        enc_old = json.dumps(old, ensure_ascii=False)
        enc_new = json.dumps(next(e[2] for e in edits if e[1] == old), ensure_ascii=False)
        want = sum(1 for e in edits if e[1] == old)
        if len({e[2] for e in edits if e[1] == old}) != 1 or text.count(enc_old) != want:
            raise SystemExit(f"{label} 旧值编码串命中 {text.count(enc_old)} 处(须 {want}),拒绝 splice")
        text = text.replace(enc_old, enc_new)
    if json.loads(text) != after:
        raise SystemExit(f"{label} splice 后解析 ≠ 白名单期望,拒写")
    return {"label": label, "path": path, "raw": raw, "text": text,
            "slots": [{"slot": s, "len_before": len(o), "len_after": len(n)} for s, o, n in edits]}


def apply_one(p: dict) -> str:
    bdir = TASK / "backups" / "snapshots"
    bdir.mkdir(parents=True, exist_ok=True)
    backup = bdir / f"{p['label']}.json"
    if backup.exists() and backup.read_text(encoding="utf-8") != p["raw"]:
        raise SystemExit(f"{backup.name} 已存在且不同,拒绝覆盖备份")
    if p["path"].read_text(encoding="utf-8") != p["raw"]:
        raise SystemExit(f"{p['label']} 计划后被改,停")
    shutil.copy2(p["path"], backup)
    p["path"].write_text(p["text"], encoding="utf-8")
    if p["path"].read_text(encoding="utf-8") != p["text"]:
        raise SystemExit(f"{p['label']} 回读不一致")
    return str(backup.relative_to(REPO))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    truth = truth_values()
    plans = [plan_one(*t, truth) for t in TARGETS]
    rows = []
    for p in plans:
        row = {"label": p["label"], "file": str(p["path"].relative_to(REPO)), "slots": p["slots"]}
        if args.apply and p["slots"]:
            row["backup"] = apply_one(p)
        rows.append(row)
    report = {"applied": args.apply, "source": str(SOURCE.relative_to(REPO)), "targets": rows}
    if args.apply:
        (TASK / "research" / "snapshots.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
