#!/usr/bin/env python3
"""LoRA 栈数据面加「设定板」预设档(09-19 角色设定表收编 R2/R4)。

语义(任务书口径):预设「设定板」= [164] charsheet LoRA(独立恒挂,不在栈内)
+ 人物组(逐槽逐权重复制「人物」预设)——设定板流 K2-角色设定-道劫.json [90]
preset 钉「设定板」,不随底座型漂移(防误选场景型掉 asianmix/liujin)。

幂等:已存在且逐值相等=跳过;存在但值漂移=报错退出(人工裁决,不静默改写)。
同步测试面:test_my_daojie_lora_stack.py 两条一比一断言放行「九型+设定板」
并由 test_charsheet_preset_equals 人物组钉死(脚本只管数据面)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

STACK = (Path(__file__).resolve().parents[2] / "backend/engines/comfyui/my_nodes"
         / "nodes/daojie_lora_stack.json")  # apps/backend/...
PRESET = "设定板"
SRC = "人物"


def main() -> int:
    slots = json.loads(STACK.read_text(encoding="utf-8"))
    changed = False
    for s in slots:
        presets = s["presets"]
        if PRESET in presets:
            if presets[PRESET] != presets[SRC]:
                print(f"✗ 槽「{s['key']}」已有 {PRESET} 且与 {SRC} 组不一致,"
                      f"人工裁决:{presets[PRESET]} vs {presets[SRC]}")
                return 1
            continue
        presets[PRESET] = json.loads(json.dumps(presets[SRC]))  # 追加在尾(序=插入序)
        changed = True
    if not changed:
        print(f"幂等:14 槽均已带 {PRESET} 档(= {SRC} 组),零改动")
        return 0
    STACK.write_text(json.dumps(slots, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")
    lit = [(s["key"], s["presets"][PRESET]["weight"]) for s in slots
           if s["presets"][PRESET]["on"]]
    print(f"✓ {len(slots)} 槽追加 {PRESET} 档(= {SRC} 组);点亮:"
          + ", ".join(f"{k}×{w:g}" for k, w in lit))
    return 0


if __name__ == "__main__":
    sys.exit(main())
