#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 冲突清理 P1 预填快照同步(任务 10-18-daojie-conflict-p1-canon · D4 授权)。

复用 qi21_base_swap_tool 的 Tool 口径(备份+changes.json 台账+sha256),只替换
预填工作流/子图中的**提示词字符串叶子**(json 标量整串替换,含前后引号——不会
命中长文内部片段),不碰任何连线/参数/拓扑。

镜像对象(D4 四件):
  apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json
  apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json
  apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json
  apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json

PAIRS = 本役真源改动清单(旧值→新值;旧值=1018 冲突清理前在档值)。四件预填
只镜像与真源逐字一致的字符串叶子:型级字段(purpose/positive/negative/
color_recipe)在四件中**无逐字镜像**(型数据运行时热读 qi21_bases.json),故
本脚本对它们的换血量预期为零——零变更本身即核验结论(证明四件不含本役任何
旧叶子残留)。底座正/负向为逐字镜像,MIRROR_COUNTS 逐件钉数。

用法:
  python3 apps/build/scripts/qi21_conflict_snapshot_sync.py --dry-run   # 只报数,零写入
  python3 apps/build/scripts/qi21_conflict_snapshot_sync.py --apply     # 换血(带拓扑守卫)
  python3 apps/build/scripts/qi21_conflict_snapshot_sync.py --verify; echo $?  # 终验,0=通过
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from qi21_base_swap_tool import ROOT, SOURCE, Tool  # noqa: E402

CAMPAIGN = "qi21-conflict-p1-1018"

TARGETS = [
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json",
    "apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    "apps/backend/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json",
]

# 底座正/负向逐字镜像份数(2026-10-18 实测;i2i 不携带风格负向=设计如此)
MIRROR_COUNTS = {
    "qi21-道劫-t2i.json": {"positive": 2, "negative": 2},
    "qwen21-道劫-t2i-api.json": {"positive": 1, "negative": 1},
    "qi21-提示词类型优化子图.json": {"positive": 2, "negative": 2},
    "qi21-提示词类型优化子图-i2i.json": {"positive": 2, "negative": 0},
}

# ── 本役真源改动清单(与 test_qi21_conflict_p1_1018.py / implement Step 4–6 一致)──

_RENWU_NEG_OLD = ("模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，透明头皮，"
                  "女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴，"
                  "UI 界面，logo，均匀锐化背景，背景高频线描，投影，地面投影")
_RENWU_NEG_NEW = ("模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，透明头皮，"
                  "UI 界面，logo，均匀锐化背景，背景高频线描，投影，地面投影")
_MV_NEG_OLD = ("模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，透明头皮，"
               "女性高跟鞋，细高跟，尖头女鞋，精巧女舞鞋，细带玛丽珍鞋，男性超大号通用工靴，异装鞋靴，"
               "透视，视角歪斜，俯仰机位，各面比例漂移，UI 界面，logo")
_MV_NEG_NEW = ("模糊，水印，多手指，文字错误，密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，透明头皮，"
               "透视，视角歪斜，俯仰机位，各面比例漂移，UI 界面，logo")

PAIRS: list[dict[str, str]] = [
    # 注:各 old= 留档行是历史旧值(D3 规则4 台账,改前原文逐字),按扫描器
    # 标注口径属历史区;new= 行才是现行口径。
    # R1(D1/D17/C10/C38)
    {"field": "_doc_types", "c": "C38",
     "old": "类型句(十档)——九型+自由的型底座数组",  # 历史旧值留档
     "new": "类型句(十一档)——十型+自由的型底座数组"},
    {"field": "_doc_types", "c": "C38",
     "old": "1015 设定卡入列九型→十型(十一档=十型+自由",  # 历史旧值留档
     "new": "1015 设定卡入列(型数由九扩十,十一档=十型+自由"},
    {"field": "types[人物].purpose", "c": "C10/D17",
     "old": "4:5 或 3:4 竖幅、半身至全身立绘。",
     "new": "3:4 竖幅、全身完整立绘。"},
    {"field": "types[人物多视图].purpose", "c": "C10/D1",
     "old": ("1:1 方形四视图设定图，1632×1632，两行两列：左上正面头肩特写（肩部以上）、右上正面全身、"  # 历史旧值留档
             "左下正九十度纯侧面全身、右下背面全身。三幅全身像同姿势、同服装、同尺度，脚底在各自格内的"
             "位置一致；头肩特写单独放大。主体句写同一角色身份、基础服化与五官锚点。默认透明底，单张直接"
             "生成四格；四格均为同一角色的指定视图。"),
     "new": ("16:9 横幅 1824×1024 设定图：左侧一张较大的完整头肩特写，右侧同一角色正面、正九十度侧面、"
             "背面全身三视图并排等宽排列。三幅全身像同姿势、同服装、同尺度；头肩特写单独放大。主体句写"
             "同一角色身份、基础服化与五官锚点。默认透明底，单张直接生成；各视图均为同一角色的指定视图。")},
    {"field": "types[概念气氛图].purpose", "c": "C10",
     "old": "16:9/21:9 自由构图。",
     "new": "16:9 自由构图。"},
    # R2(D5/C11)
    {"field": "color_lexicon.roles.note", "c": "C11",
     "old": "ink(线色)依据主体明文配色与材质保持细稳墨线，颜色服从来源事实",
     "new": "ink(线色)依据主体明文配色与材质从色卡选取协调彩线，颜色服从来源事实"},
    # R3(C12)
    {"field": "types[人物].positive_text", "c": "C12",
     "old": "云雾烟霭以淡色罩染层层推开、渐次转淡叠出深远，通幅有雾气流动，而色面边界仍清晰分明；",
     "new": "云雾烟霭以淡色罩染分层，层间边界清晰；"},
    {"field": "types[美宣].positive_text", "c": "C12",
     "old": "云雾亦画为成片平整色面；",
     "new": "云雾以淡色罩染分层，层间边界清晰；"},
    # R4(D6/C13)
    {"field": "types[场景].color_recipe.base", "c": "C13",
     "old": "宣纸白", "new": "随场景时段"},
    {"field": "types[分镜剧情图].color_recipe.base", "c": "C13",
     "old": "宣纸白", "new": "随场景时段"},
    {"field": "types[概念气氛图].color_recipe.base", "c": "C13",
     "old": "宣纸白", "new": "随场景时段"},
    {"field": "types[道具].color_recipe.base", "c": "C13",
     "old": "宣纸白", "new": "透明"},
    {"field": "types[人物多视图].color_recipe.base", "c": "C13",
     "old": "宣纸白", "new": "透明"},
    {"field": "types[高清人脸].color_recipe.base", "c": "C13",
     "old": "宣纸白", "new": "透明"},
    {"field": "types[表情差分].color_recipe.base", "c": "C13",
     "old": "宣纸白", "new": "透明"},
    {"field": "expand_instruction.system_prompt_zh", "c": "C13",
     "old": "一段总结性的构图描述：视觉重心、引导线、留白、节奏。",
     "new": "一段总结性的构图描述：视觉重心、引导线、留白或色面铺满（按类型句）、节奏。"},
    # R5(D8/C14)
    {"field": "types[人物].negative_text", "c": "C14", "old": _RENWU_NEG_OLD, "new": _RENWU_NEG_NEW},
    {"field": "types[美宣].negative_text", "c": "C14", "old": _RENWU_NEG_OLD, "new": _RENWU_NEG_NEW},
    {"field": "types[分镜剧情图].negative_text", "c": "C14", "old": _RENWU_NEG_OLD, "new": _RENWU_NEG_NEW},
    {"field": "types[人物多视图].negative_text", "c": "C14", "old": _MV_NEG_OLD, "new": _MV_NEG_NEW},
    {"field": "types[设定卡].negative_text", "c": "C14",
     "old": "正侧背机位重复，刀身弯曲，UI 界面", "new": "正侧背机位重复，UI 界面"},
    {"field": "types[概念气氛图].negative_text", "c": "C14",
     "old": "写实油画，厚涂，照片质感，3D渲染，人影，人脸，UI 界面",
     "new": "写实油画，厚涂，照片质感，3D渲染，UI 界面"},
    # R6(C15)
    {"field": "types[人物多视图].positive_text", "c": "C15",
     "old": "同一服装、同一光源，头身比约六至七头身，解剖比例准确；头肩特写单独放大，五官身份与全身像一致。",
     "new": ("同一服装、同一光源，比例服从年龄、体型与来源设定，解剖结构清晰；头肩特写单独放大，"
             "五官身份与全身像一致。")},
    {"field": "types[人物多视图].positive_text", "c": "C15",
     "old": "头发概括为清晰成组的发束，细线交代局部发丝，发量与发际线服从角色设定。\n持握物件的方式自然符合物件用途",
     "new": ("头发概括为清晰成组的发束，细线交代局部发丝，发量与发际线服从角色设定。"
             "面部采用动漫式概括五官，轮廓与眉眼线条清楚，以简洁分层的肤色色块交代转折，"
             "脸型与年龄感服从角色设定。\n持握物件的方式自然符合物件用途")},
]


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _leaf_paths(x, path=""):
    if isinstance(x, str):
        yield path, x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from _leaf_paths(v, f"{path}.{k}" if path else k)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from _leaf_paths(v, f"{path}[{i}]")


def _string_only_diff(before, after, path=""):
    """递归 diff:返回 [(path, old, new)];要求除字符串叶子外结构全同。"""
    if type(before) is not type(after):
        return [(path or "<root>", before, after)]
    if isinstance(before, dict):
        if list(before.keys()) != list(after.keys()):
            return [(path or "<root>", f"keys={list(before.keys())}", f"keys={list(after.keys())}")]
        out = []
        for k in before:
            out += _string_only_diff(before[k], after[k], f"{path}.{k}" if path else k)
        return out
    if isinstance(before, list):
        if len(before) != len(after):
            return [(path or "<root>", f"len={len(before)}", f"len={len(after)}")]
        out = []
        for i, (b, a) in enumerate(zip(before, after)):
            out += _string_only_diff(b, a, f"{path}[{i}]")
        return out
    return [] if before == after else [(path or "<root>", before, after)]


def _source_field(root: dict, field: str) -> str:
    """按字段路径取真源对应字符串容器(field-scoped,避免同词他处误判)。"""
    if field == "_doc_types":
        return root["_doc_types"]
    if field == "color_lexicon.roles.note":
        return root["color_lexicon"]["roles"]["note"]
    if field == "expand_instruction.system_prompt_zh":
        return root["expand_instruction"]["system_prompt_zh"]
    head, tail = field.split("]", 1)  # "types[人物" + ".purpose"
    zh = head[len("types["):]
    entry = next(e for e in root["types"] if e["zh"] == zh)
    node = entry
    for part in tail.strip(".").split("."):
        node = node[part]
    return node


def _source_state() -> str:
    """真源状态:'old'(各字段含旧值) / 'new'(各字段含新值且无旧值) / 'mixed'。

    field-scoped:如「宣纸白」在人物/美宣 recipe 合法存续,不能按全文判定残留。
    """
    root = json.loads(SOURCE.read_text(encoding="utf-8"))
    pairs_by_field: dict[str, list[dict]] = {}
    for p in PAIRS:
        pairs_by_field.setdefault(p["field"], []).append(p)
    old_ok = all(p["old"] in _source_field(root, f) for f, ps in pairs_by_field.items() for p in ps)
    new_ok = all(p["new"] in _source_field(root, f) for f, ps in pairs_by_field.items() for p in ps)
    gone = all(p["old"] not in _source_field(root, f) for f, ps in pairs_by_field.items() for p in ps)
    if new_ok and gone:
        return "new"
    if old_ok and not new_ok:
        return "old"
    return "mixed"


def dry_run() -> int:
    state = _source_state()
    print(f"[sync] 真源状态={state}(old=未改/new=已按本役清单改毕/mixed=部分)")
    total = 0
    for rel in TARGETS:
        text = (ROOT / rel).read_text(encoding="utf-8")
        rows = []
        for p in PAIRS:
            n = text.count(json.dumps(p["old"], ensure_ascii=False))
            if n:
                rows.append(f"{p['field']}[{p['c']}]×{n}")
                total += n
        print(f"[sync] {Path(rel).name}: " + ("; ".join(rows) if rows else "零变更"))
    print(f"[sync] dry-run 合计旧叶子命中={total}(0=四件不含本役旧值,无需镜像)")
    return 0


def apply() -> int:
    state = _source_state()
    if state != "new":
        print(f"[sync] 拒续:真源状态={state}(应先完成 implement Step 4–6 真源改写再镜像)", file=sys.stderr)
        return 2
    tool = Tool({"out_dir": CAMPAIGN, "positive_new": "", "positive_old": ""})
    tool.out.mkdir(parents=True, exist_ok=True)
    total = 0
    for rel in TARGETS:
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        new_text, rows = text, []
        for p in PAIRS:
            old_s = json.dumps(p["old"], ensure_ascii=False)
            new_s = json.dumps(p["new"], ensure_ascii=False)
            n = text.count(old_s)
            if n:
                # 逐串换血:整标量(含引号)替换,不触碰长文内部片段
                new_text = new_text.replace(old_s, new_s)
                rows.append({"field": p["field"], "c": p["c"], "count": n})
                total += n
        if rows:
            before_obj = json.loads(text)
            after_obj = json.loads(new_text)
            delta = _string_only_diff(before_obj, after_obj)
            bad = [d for d in delta if not (isinstance(d[1], str) and isinstance(d[2], str))]
            assert not bad, f"{path.name}: 非字符串叶子变动(连线/参数被触碰): {bad[:3]}"
            tool.ledger_write(path, new_text.encode("utf-8"),
                              "P1 冲突清理:字符串叶子镜像(拓扑/参数零变动)")
        print(f"[sync] {path.name}: 换血 {sum(r['count'] for r in rows)} 处"
              + (f" -> {rows}" if rows else ""))
    (tool.out / "mirror-rows.json").write_text(json.dumps(total and rows or [], ensure_ascii=False, indent=2) + "\n",
                                               encoding="utf-8")
    print(f"[sync] apply 合计={total}")
    return 0


def distribute() -> int:
    """真源磁盘镜像同步(装机 Resources/release/MA/IP/引擎数据位)。

    背景:test_prompt_source_single_truth 钉「装机固定位与真源家逐字节一致」;
    D14 把打包推迟到父任务收尾,故本阶段沿用 1018 各役惯例先落盘同步
    (复用 qi21_base_swap_tool.Tool.distribute:备份+台账;missing 目标如实记)。
    只分发本役改动的 json/qi21_bases.json(manual 件),工作流四件零改动不分发。
    """
    state = _source_state()
    if state != "new":
        print(f"[sync] 拒续:真源状态={state}(先完成真源改写再分发)", file=sys.stderr)
        return 2
    cfg = {
        "campaign": CAMPAIGN,
        "out_dir": CAMPAIGN,
        "positive_new": json.loads(SOURCE.read_text(encoding="utf-8"))["art_style_base"]["positive_text"],
        "positive_old": "",
        "manual_files_distribute": ["json/qi21_bases.json"],
        "wf_counts": {},
    }
    tool = Tool(cfg)
    tool.out.mkdir(parents=True, exist_ok=True)
    tool.distribute()
    return 0


def verify() -> int:
    problems: list[str] = []
    # 1) 真源已改毕(逐字段容器:新值在、旧值无;field-scoped 防同词他处误判)
    src_root = json.loads(SOURCE.read_text(encoding="utf-8"))
    for p in PAIRS:
        holder = _source_field(src_root, p["field"])
        if p["new"] not in holder:
            problems.append(f"真源缺新值: {p['field']}[{p['c']}]")
        if p["old"] in holder:
            problems.append(f"真源残留旧值: {p['field']}[{p['c']}]")
    # 2) 四件:旧值残留=0 + JSON 可解析
    for rel in TARGETS:
        path = ROOT / rel
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            problems.append(f"{path.name}: JSON 解析失败 {exc}")
            continue
        text = path.read_text(encoding="utf-8")
        for p in PAIRS:
            if json.dumps(p["old"], ensure_ascii=False) in text:
                problems.append(f"{path.name}: 残留旧叶子 {p['field']}[{p['c']}]")
        # 3) 底座正/负向逐字镜像份数
        pos = src_root["art_style_base"]["positive_text"]
        neg = src_root["art_style_base"]["negative_text"]
        want = MIRROR_COUNTS[path.name]
        got_p = text.count(json.dumps(pos, ensure_ascii=False))
        got_n = text.count(json.dumps(neg, ensure_ascii=False))
        if (got_p, got_n) != (want["positive"], want["negative"]):
            problems.append(f"{path.name}: 底座镜像份数 ({got_p},{got_n}) != 期望 "
                            f"({want['positive']},{want['negative']})")
        del data
    # 4) 台账 sha256 与现盘一致(有写入时)
    ledger = ROOT / "apps/output/automation" / CAMPAIGN / "changes.json"
    if ledger.exists():
        for row in json.loads(ledger.read_text(encoding="utf-8")):
            if _sha(Path(row["path"]).read_bytes()) != row["after"]:
                problems.append(f"台账 sha 漂移: {row['path']}")
    print(json.dumps({"ok": not problems, "problems": problems}, ensure_ascii=False, indent=1))
    return 0 if not problems else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="P1 预填快照同步(D4 授权:只换字符串叶子)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="只报旧叶子命中数,零写入")
    group.add_argument("--apply", action="store_true", help="换血并写台账(带拓扑守卫)")
    group.add_argument("--distribute", action="store_true",
                       help="真源磁盘镜像同步(装机/release/MA/IP/引擎数据;复用 Tool.distribute)")
    group.add_argument("--verify", action="store_true", help="终验:旧值残留0+镜像份数+台账sha")
    args = parser.parse_args(argv)
    if args.dry_run:
        return dry_run()
    if args.apply:
        return apply()
    if args.distribute:
        return distribute()
    return verify()


if __name__ == "__main__":
    sys.exit(main())
