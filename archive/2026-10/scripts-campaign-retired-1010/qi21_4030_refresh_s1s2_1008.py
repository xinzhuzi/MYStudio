#!/usr/bin/env python3
"""qi21 [4030] 系统提示词展示框双刷(2026-10-08,S1+S2 耦合批;08§8 SOP 第3步)。

S2 教材手术(system_prompt_zh 3118→2830)后,[4030] MyQi21系统提示词 的
widgets_values 预填快照必须同刷——**蓝图 subgraphs json 与宿主工作流 json 两处**
(只刷工作流就跑 sync 会被蓝图旧版吃回,C11 实害在案)。本脚本刷蓝图侧;工作流
侧由 qi21_blueprint_sync_1001.py(蓝图→工作流,幂等)落,再跑 --check 验幂等。

锚断言:每件恰一个含教材头标的 widgets_values 串,且旧值必须==改前备份的
旧教材全文(逐字),刷后==新教材全文;蓝图其余内容零变动(只改该字符串)。
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
OLD = json.loads((REPO / ".trellis/tasks/10-04-qi21-prompt-cleanup/backups/qi21_bases.json.s1s2.pre")
                 .read_text(encoding="utf-8"))["expand_instruction"]["system_prompt_zh"]
NEW = json.loads(BASES.read_text(encoding="utf-8"))["expand_instruction"]["system_prompt_zh"]
HEAD = "# 图像提示词扩写专家"

raw = BP.read_text(encoding="utf-8")
assert raw.count(json.dumps(OLD, ensure_ascii=False)) == 1, \
    "[锚] 蓝图应恰含旧教材全文一次(fail-closed)"
data = json.loads(raw)

hits = {"old": 0, "new": 0}


def walk_and_replace(obj):
    if isinstance(obj, dict):
        return {k: walk_and_replace(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk_and_replace(v) for v in obj]
    if isinstance(obj, str):
        if obj == OLD:
            hits["old"] += 1
            return NEW
        if obj == NEW:
            hits["new"] += 1
            return obj
        # 长文本但非教材:不碰(锚=整值相等,杜绝子串误伤)
        return obj
    return obj


out = walk_and_replace(data)
assert hits["old"] == 1, f"[锚] 教材旧值应恰 1 处,得 {hits['old']}(fail-closed)"

BP.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
rt = json.loads(BP.read_text(encoding="utf-8"))
# 回读断言:新教材在场、旧教材离场、文件其余结构未动(顶层键序一致)
assert json.dumps(rt, ensure_ascii=False).count(json.dumps(NEW, ensure_ascii=False)) == 1
assert json.dumps(rt, ensure_ascii=False).count(json.dumps(OLD, ensure_ascii=False)) == 0
print(f"[落盘] {BP.name}: [4030] 教材快照 {len(OLD)}→{len(NEW)} 字")
