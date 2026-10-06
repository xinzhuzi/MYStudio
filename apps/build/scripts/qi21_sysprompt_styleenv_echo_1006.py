#!/usr/bin/env python3
"""1006 红6复测后 v4 两加注(风格底座背景句归透明豁免/指令回声禁令)+规则5扩场景元素。

复测定谳:道具✓美宣✓(v3修生效);表情差分=断言过严(九格=底座自家词);
真余:①高清人脸把美术风格底座的"背景是…山水基底"并进透明稿(润炼逐字vs透明删环境
的结构冲突,裁决序有序但没点名风格底座);②多视图照抄指令原句("光照仅写落在主体
身上的效果""背景被完全透明化");③场景鎏金匾额单点丢(规则5部件例没覆盖场景元素)。
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"

EDITS = [
    ("5. **部件锚点零丢失**：原文提及的每个部件（剑鞘/剑格/剑穗/腰带/发簪等）必须在终稿中出现，一个不漏——透明开时同样生效。",
     "5. **部件锚点零丢失**：原文提及的每个部件与场景元素（剑鞘/剑格/剑穗/腰带/发簪/山门/灯笼/匾额等）必须在终稿中出现，一个不漏——透明开时同样生效。"),
    ("透明删除同理:删了就删了,终稿不写「已移除」「仅写」等执行说明。",
     "透明删除同理:删了就删了,终稿不写「已移除」「仅写」等执行说明,也不把本指令的原文句子抄进终稿。"),
    ("- **部件保全**:删环境≠删部件。",
     "- **风格底座的背景句跳过**:美术风格底座中描写背景/远景的句子(如「背景是…山水基底」「远景以淡墨晕染」)透明开时不并入终稿,只取其画法/线条/工艺句。\n- **部件保全**:删环境≠删部件。"),
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
