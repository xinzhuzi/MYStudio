#!/usr/bin/env python3
"""1006 十型实弹后三修(模式串扰/元叙述/负向丢条目),3870→~4000。

十型全量实弹(9B)揭的三件真问题,全部加注修复,零删除零压缩:
1) 关分支:原文环境元素照常保留+禁透明措辞泄漏(修云海被删/透明底措辞串扰)
2) 核心规则3:透明删除不留"已移除"式元叙述(修道具案)
3) 负面清单:用户负面逐条全数并入(修剑穗断裂丢失案)
splice 保 42 色库块;改后同步工作流+蓝图两处展示框(蓝图同步方向坑在档)。
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"

EDITS = [
    # 1) 关模式串扰:环境保留+禁透明措辞
    ("- **关=常规成图**:正常描述环境、背景、氛围、光照。",
     "- **关=常规成图**:正常描述环境、背景、氛围、光照——原文环境元素(云海/山门石阶等)照常保留不删,不使用「透明底立绘素材」等透明措辞。"),
    # 2) 元叙述禁令(挂在规则3禁令复述旁边,同一家族)
    ("3. **禁令处理**：用户输入中的禁止条款（如\"禁止密集褶网\"）是你的工作纪律，默默遵守，不要在描述中复述。",
     "3. **禁令处理**：用户输入中的禁止条款（如\"禁止密集褶网\"）是你的工作纪律，默默遵守，不要在描述中复述。透明删除同理:删了就删了,终稿不写「已移除」「仅写」等执行说明。"),
    # 3) 负向逐条不丢
    ("- 直接使用用户提供的负面词",
     "- 直接使用用户提供的负面词(逐条全数并入,一条不丢)"),
]


def main() -> None:
    data = json.loads(BASES.read_text(encoding="utf-8"))
    sp = data["expand_instruction"]["system_prompt_zh"]
    for old, new in EDITS:
        assert sp.count(old) == 1, f"锚不唯一或缺席: {old[:30]}"
        sp = sp.replace(old, new)
    data["expand_instruction"]["system_prompt_zh"] = sp
    BASES.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")
    n = 0
    for fp in (WF, BP):
        d = json.loads(fp.read_text(encoding="utf-8"))
        for sg in d.get("definitions", {}).get("subgraphs", []):
            if "提示词类型优化" not in sg.get("name", ""):
                continue
            for node in sg["nodes"]:
                if node.get("type") == "MyQi21系统提示词":
                    node["widgets_values"] = [sp]
                    n += 1
        fp.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    print(f"真源: -> {len(sp)} 字符;工作流+蓝图展示框 {n} 处")


if __name__ == "__main__":
    sys.exit(main())
