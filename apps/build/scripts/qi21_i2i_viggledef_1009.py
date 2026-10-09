#!/usr/bin/env python3
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""qi21-道劫-i2i 默认加速档改 viggle(1009 用户新令)——工作流 JSON 手术脚本。

用户令(2026-10-09):qi21-道劫-i2i.json 的 [7] 加速子图默认改用 viggle 路线。
配方=照抄 t2i 先例 qi21_viggledef_1008.py(仅本件实例,py 侧 DEFAULT_MODE
出厂首项仍=「0 · Fun-Acc 4步」不动,新实例出生缺省不变)。

与 t2i 件的三点差异(勘环境坐实,脚本按此适配):
  ① 命中 7 处非 9:实例 4 处(宿主[7] widgets_values/widgets_values_named
     「速度档位」、子图定义级 widgets、选择件[7015] widgets_values——
     i2i 选择件无 widgets_values_named);
  ② Note[402] 单槽(i2i 无 widgets_values_named 槽,t2i 是双槽镜像),
     默认档表述 3 段(面板控件说明/Fun-Acc 支路「主加速档」claim/默认档沿革);
  ③ 写回格式同源(indent=2 无尾换行,roundtrip 逐字节恒等已勘)。

fail-closed:改前逐项断言现状、改后逐项断言新态+深 diff 恰 5 路径+结构
不变量(节点/连线/子图数),任一不满足即零写入退出非零。
契约测试锚随源迁(test_qwen21_workflow_contract.py:DEFAULT_MODE_OF/I2I
tokens/4351 调用点 default_mode)由同批手工编辑完成,不在本脚本范围。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BACKUP_DIR = REPO / "apps/build/scripts/backups/qi21_i2i_viggledef_1009"

OLD_MODE = "0 · Fun-Acc 4步"
NEW_MODE = "2 · viggle"
SG_NAME = "道劫·加速子图"
NOTE_ID = 402
HOST_ID = 7
SEL_ID = 7015

# Note[402] 默认档表述段(单槽;恰 1 命中/段)
SEGMENTS = [
    # 段1:宿主面板控件说明(token 随迁 I2I_PARALLEL_NOTE_TOKENS:拆「全局出厂首项」
    # 与「本件默认」两截,与 qi21 件 1008 先例同款口径)
    ("「速度档位」combo(首项=默认=「0 · Fun-Acc 4步」=1002 用户新令(推翻 0929 拉齐重放;直出40步居二))",
     "「速度档位」combo(首项=「0 · Fun-Acc 4步」=全局出厂默认;本件默认=「2 · viggle」=1009 用户新令(推翻本件 1002 Fun-Acc 令;直出40步居二))"),
    # 段2:Fun-Acc 支路「主加速档」claim 随默认档易主而撤
    ("Fun-Acc 支路([7013],子图行1,主加速档=combo 首项「0 · Fun-Acc 4步」)",
     "Fun-Acc 支路([7013],子图行1,combo 首项「0 · Fun-Acc 4步」=全局出厂首项)"),
    # 段3:默认档沿革续写 1009 令
    ("Fun-Acc 回 combo 首项「0 · Fun-Acc 4步」=现行默认**(直出40步居二,viggle 居三)",
     "Fun-Acc 回 combo 首项「0 · Fun-Acc 4步」**→**1009 用户新令:i2i 本件默认改「2 · viggle」(全局出厂首项不动)**(直出40步居二,viggle 居三)"),
]


def die(msg: str) -> None:
    print(f"FAIL {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    raw = WF.read_text(encoding="utf-8")
    d = json.loads(raw)

    # ── 改前断言(现状逐项)──
    if raw.count(OLD_MODE) != 7:
        die(f"raw「{OLD_MODE}」应恰 7 处,得 {raw.count(OLD_MODE)}(另会话已动?先勘环境再手术)")
    hosts = [n for n in d["nodes"] if n["id"] == HOST_ID]
    assert len(hosts) == 1, f"宿主 [{HOST_ID}] 应恰 1"
    host = hosts[0]
    assert host.get("title") == "[7] 加速子图", f"宿主 title 漂移:{host.get('title')!r}"
    assert host["widgets_values"] == [OLD_MODE, 0], f"宿主 widgets_values:{host['widgets_values']!r}"
    assert host.get("widgets_values_named") == {"速度档位": OLD_MODE, "seed": 0}, \
        f"宿主 named:{host.get('widgets_values_named')!r}"
    sgs = [s for s in d["definitions"]["subgraphs"] if s["name"] == SG_NAME]
    assert len(sgs) == 1, f"子图「{SG_NAME}」应恰 1"
    sg = sgs[0]
    assert sg["widgets"] == [OLD_MODE, 0], f"子图定义级 widgets:{sg['widgets']!r}"
    sels = [n for n in sg["nodes"] if n["id"] == SEL_ID]
    assert len(sels) == 1 and sels[0]["type"] == "MyQi21SpeedSelect", "选择件 [7015] 定位失败"
    sel = sels[0]
    assert sel["widgets_values"] == [OLD_MODE], f"选择件 widgets_values:{sel['widgets_values']!r}"
    assert not sel.get("widgets_values_named"), \
        f"i2i 选择件应无 named 槽(t2i 有/本件无,勘环境已定):{sel.get('widgets_values_named')!r}"
    notes = [n for n in d["nodes"] if n["id"] == NOTE_ID]
    assert len(notes) == 1 and notes[0]["type"] == "MarkdownNote", "Note [402] 定位失败"
    note = notes[0]
    assert "widgets_values_named" not in note, "i2i Note 应单槽(勘环境已定,双槽即漂移)"
    t = note["widgets_values"][0]
    for old, _new in SEGMENTS:
        if t.count(old) != 1:
            die(f"Note 段落应恰 1 命中,得 {t.count(old)}:{old[:40]}…")

    n_nodes, n_links, n_sgs = len(d["nodes"]), len(d["links"]), len(d["definitions"]["subgraphs"])

    # ── 备份 ──
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    bak = BACKUP_DIR / "qi21-道劫-i2i.json.pre"
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
    for old, new in SEGMENTS:
        t = t.replace(old, new)
    note["widgets_values"][0] = t

    # ── 改后断言(新态+结构不变量+深 diff 恰 5 路径)──
    out = json.dumps(d, ensure_ascii=False, indent=2)
    assert out.count(OLD_MODE) == 3, f"旧串应恰剩 Note 3 处(全局出厂首项表述),得 {out.count(OLD_MODE)}"
    assert out.count(NEW_MODE) == 8, f"新串应恰 8 处(实例 4+Note 4),得 {out.count(NEW_MODE)}"
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
                diff_paths.append(path + "[len]")
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
        f"$.definitions.subgraphs[{s_i}].widgets[0]",
        f"$.definitions.subgraphs[{s_i}].nodes[{x_i}].widgets_values[0]",
    }
    if set(diff_paths) != want or len(diff_paths) != len(want):
        die(f"深 diff 应恰 {len(want)} 路径,得 {len(diff_paths)}:{sorted(diff_paths)}")

    # ── 写回(indent=2 无尾换行=原格式逐字节复现,最小 diff)──
    WF.write_text(out, encoding="utf-8")
    print(f"PASS 手术完成:实例 4 处+Note 段落 3 处(单槽)→ {NEW_MODE}")
    print(f"     改前副本:{bak}")
    print(f"     深 diff 恰 {len(want)} 路径;旧串剩 3(全局出厂首项表述)、新串 8")


if __name__ == "__main__":
    main()
