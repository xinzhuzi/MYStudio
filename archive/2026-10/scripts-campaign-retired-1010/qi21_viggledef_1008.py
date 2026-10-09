#!/usr/bin/env python3
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""qi21-道劫-t2i 默认加速档改 viggle(1008 用户新令)——工作流 JSON 手术脚本。

用户令(2026-10-08):qi21-道劫-t2i.json 的 [7] 加速子图默认改用 viggle 路线。
范围=本件工作流实例(面板出厂态),**不动 py 侧 DEFAULT_MODE**(全局出厂
首项仍=「0 · Fun-Acc 4步」,1002 ⑱ 令继续管 i2i 与新实例出生缺省)。

恰 9 命中(=raw 中「0 · Fun-Acc 4步」出现总数,改前实测):
  实例值 5 处:宿主[7] widgets_values/widgets_values_named「速度档位」、
  子图定义级 widgets 出生缺省快照、选择件[7015] widgets_values/widgets_values_named.mode
  → 全改「2 · viggle」;
  Note[402] 文案 4 处(widgets_values[0] 与 widgets_values_named.text 双槽镜像
  各含 2 段默认档表述)→ 按新默认改写,保留「全局出厂首项=Fun-Acc 4步」表述。

fail-closed:改前逐项断言现状、改后逐项断言新态+深 diff 恰 7 路径+结构
不变量(节点/连线/子图数),任一不满足即零写入退出非零。
契约测试锚随源迁(test_qwen21_workflow_contract.py 六处)由同批手工编辑完成,
不在本脚本范围。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BACKUP_DIR = REPO / "apps/build/scripts/backups/qi21_viggledef_1008"

OLD_MODE = "0 · Fun-Acc 4步"
NEW_MODE = "2 · viggle"
SG_NAME = "道劫·加速子图"
NOTE_ID = 402
HOST_ID = 7
SEL_ID = 7015

# Note[402] 默认档表述段(双槽镜像各一份;恰 1 命中/槽)
SEGMENTS = [
    # 段1:加速区节标题
    ("### 加速区·加速子图([7] 双击进入;默认=Fun-Acc 4步=1002 用户新令(推翻 0929 拉齐重放);横向三支路三横线)",
     "### 加速区·加速子图([7] 双击进入;本件默认=「2 · viggle」=1008 用户新令(推翻本件 1002 Fun-Acc 令,全局出厂首项不动);横向三支路三横线)"),
    # 段2:选择件 combo 说明
    ("combo 三选一**首项=默认=「0 · Fun-Acc 4步」**(1002 用户新令,推翻 0929 拉齐重放;直出40步居二/viggle 居三)",
     "combo 三选一**首项=「0 · Fun-Acc 4步」=全局出厂默认;本件默认=「2 · viggle」**(1008 用户新令:道劫本件默认改 viggle 路线;直出40步居二/viggle 居三)"),
    # 段3:宿主面板控件说明
    ("速度档位=combo 三选一(默认=「0 · Fun-Acc 4步」,随时可切)",
     "速度档位=combo 三选一(本件默认=「2 · viggle」,随时可切;全局出厂首项=「0 · Fun-Acc 4步」)"),
    # 段4:懒执行举例(默认态反例支路清单随档改:viggle 支路=[7011]+[7012],反例=直出[7010]+FunAcc[7013])
    ("如默认 Fun-Acc 4步时 [7010]/[7012]/[7011] 全不在执行图",
     "如本件默认「2 · viggle」时 [7010]/[7013] 全不在执行图"),
]


def die(msg: str) -> None:
    print(f"FAIL {msg}", file=sys.stderr)
    sys.exit(1)


def find_host(d: dict) -> dict:
    hosts = [n for n in d["nodes"] if n["id"] == HOST_ID]
    assert len(hosts) == 1, f"宿主 [{HOST_ID}] 应恰 1"
    return hosts[0]


def find_sg(d: dict) -> dict:
    sgs = [s for s in d["definitions"]["subgraphs"] if s["name"] == SG_NAME]
    assert len(sgs) == 1, f"子图「{SG_NAME}」应恰 1"
    return sgs[0]


def main() -> None:
    raw = WF.read_text(encoding="utf-8")
    d = json.loads(raw)

    # ── 改前断言(现状逐项)──
    if raw.count(OLD_MODE) != 9:
        die(f"raw「{OLD_MODE}」应恰 9 处,得 {raw.count(OLD_MODE)}(另会话已动?先勘环境再手术)")
    host = find_host(d)
    assert host.get("title") == "[7] 加速子图", f"宿主 title 漂移:{host.get('title')!r}"
    assert host["widgets_values"] == [OLD_MODE, 0], f"宿主 widgets_values:{host['widgets_values']!r}"
    assert host.get("widgets_values_named") == {"速度档位": OLD_MODE, "seed": 0}, \
        f"宿主 named:{host.get('widgets_values_named')!r}"
    sg = find_sg(d)
    assert sg["widgets"] == [OLD_MODE, 0], f"子图定义级 widgets:{sg['widgets']!r}"
    sels = [n for n in sg["nodes"] if n["id"] == SEL_ID]
    assert len(sels) == 1 and sels[0]["type"] == "MyQi21SpeedSelect", "选择件 [7015] 定位失败"
    sel = sels[0]
    assert sel["widgets_values"] == [OLD_MODE], f"选择件 widgets_values:{sel['widgets_values']!r}"
    assert sel.get("widgets_values_named") == {"mode": OLD_MODE}, f"选择件 named:{sel.get('widgets_values_named')!r}"
    notes = [n for n in d["nodes"] if n["id"] == NOTE_ID]
    assert len(notes) == 1 and notes[0]["type"] == "MarkdownNote", "Note [402] 定位失败"
    note = notes[0]
    t_list = note["widgets_values"][0]
    t_named = note["widgets_values_named"]["text"]
    assert t_list == t_named, "Note 双槽镜像不一致(先按 ERRORS.md 双槽判例勘环境)"
    for old, _new in SEGMENTS:
        if t_list.count(old) != 1:
            die(f"Note 段落应恰 1 命中,得 {t_list.count(old)}:{old[:40]}…")

    n_nodes, n_links, n_sgs = len(d["nodes"]), len(d["links"]), len(d["definitions"]["subgraphs"])

    # ── 备份 ──
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    bak = BACKUP_DIR / "qi21-道劫-t2i.json.pre"
    if bak.exists():
        if bak.read_bytes() != WF.read_bytes():
            die(f"改前副本已存在且与现源不同(防覆盖真实历史):{bak}")
    else:
        shutil.copy2(WF, bak)

    # ── 手术 ──
    host["widgets_values"] = [NEW_MODE, 0]
    host["widgets_values_named"] = {"速度档位": NEW_MODE, "seed": 0}
    sg["widgets"] = [NEW_MODE, 0]
    sel["widgets_values"] = [NEW_MODE]
    sel["widgets_values_named"] = {"mode": NEW_MODE}
    for old, new in SEGMENTS:
        t_list = t_list.replace(old, new)
    note["widgets_values"][0] = t_list
    note["widgets_values_named"]["text"] = t_list

    # ── 改后断言(新态+结构不变量+深 diff 恰 7 路径)──
    out = json.dumps(d, ensure_ascii=False, indent=2)
    assert out.count(OLD_MODE) == 4, f"旧串应恰剩 Note 4 处(全局出厂首项表述),得 {out.count(OLD_MODE)}"
    assert out.count(NEW_MODE) == 13, f"新串应恰 13 处(实例 5+Note 4 段×双槽 8),得 {out.count(NEW_MODE)}"
    assert len(d["nodes"]) == n_nodes and len(d["links"]) == n_links \
        and len(d["definitions"]["subgraphs"]) == n_sgs, "结构不变量破(节点/连线/子图数)"

    old_d = json.loads(raw)
    diff_paths: list[str] = []

    def walk(a, b, path: str) -> None:
        if type(a) is not type(b):
            diff_paths.append(path)
        elif isinstance(a, dict):
            for k in set(a) | set(b):
                if k not in a or k not in b:
                    diff_paths.append(f"{path}.{k}")
                else:
                    walk(a[k], b[k], f"{path}.{k}")
        elif isinstance(a, list):
            if len(a) != len(b):
                diff_paths.append(f"{path}[len]")
            else:
                for i, (x, y) in enumerate(zip(a, b)):
                    walk(x, y, f"{path}[{i}]")
        elif a != b:
            diff_paths.append(path)

    walk(old_d, d, "$")
    h_i = next(i for i, n in enumerate(d['nodes']) if n['id'] == HOST_ID)
    t_i = next(i for i, n in enumerate(d['nodes']) if n['id'] == NOTE_ID)
    s_i = next(i for i, s in enumerate(d['definitions']['subgraphs']) if s['name'] == SG_NAME)
    x_i = next(i for i, n in enumerate(sg['nodes']) if n['id'] == SEL_ID)
    want = {
        f"$.nodes[{h_i}].widgets_values[0]",
        f"$.nodes[{h_i}].widgets_values_named.速度档位",
        f"$.nodes[{t_i}].widgets_values[0]",
        f"$.nodes[{t_i}].widgets_values_named.text",
        f"$.definitions.subgraphs[{s_i}].widgets[0]",
        f"$.definitions.subgraphs[{s_i}].nodes[{x_i}].widgets_values[0]",
        f"$.definitions.subgraphs[{s_i}].nodes[{x_i}].widgets_values_named.mode",
    }
    if set(diff_paths) != want or len(diff_paths) != len(want):
        die(f"深 diff 应恰 {len(want)} 路径,得 {len(diff_paths)}:{sorted(diff_paths)}")

    # ── 写回(indent=2 无尾换行=原格式逐字节复现,最小 diff)──
    WF.write_text(out, encoding="utf-8")
    print(f"PASS 手术完成:实例 5 处+Note 段落 4 处(双槽镜像)→ {NEW_MODE}")
    print(f"     改前副本:{bak}")
    print(f"     深 diff 恰 {len(want)} 路径;旧串剩 4(全局出厂首项表述)、新串 13")


if __name__ == "__main__":
    main()
