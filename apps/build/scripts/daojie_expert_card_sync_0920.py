#!/usr/bin/env python3
"""专家模式副本 [66] 速查卡同步 09-20(幂等)。

问题:K2-文生图-道劫-专家模式.json 是切栈时刻(22:58)快照,其 [66] 卡还是旧版
九型画幅表,没有配方矩阵——照卡操作会看到终审前的口径。
同步:专家卡 = 主文件卡全文(配方矩阵,随数据热更新)+ 专属「分组开关」段
(从专家旧卡提取,含 [88] rgthree 用法;主卡无此段,系专家模式专属)。
主卡由 daojie_nineform_card_0919.py 从数据面生成(三方零差异),本脚本只读它。
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[3] / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
MAIN = HERE / "K2-文生图-道劫.json"
EXPERT = HERE / "K2-文生图-道劫-专家模式.json"
MARK = "## 专家模式专属(本副本)"


def card(wf: Path):
    doc = json.loads(wf.read_text(encoding="utf-8"))
    node = next(n for n in doc["nodes"] if n["id"] == 66)
    return doc, node


doc_m, node_m = card(MAIN)
doc_e, node_e = card(EXPERT)
main_text = node_m["widgets_values"][0]
old_expert = node_e["widgets_values"][0]

# 从专家旧卡提取「分组开关」段(至下一个二级标题或文末)
lines = old_expert.splitlines()
block: list[str] = []
capture = False
for ln in lines:
    if ln.startswith("## 分组开关"):
        capture = True
    elif capture and ln.startswith("## "):
        capture = False
    if capture:
        block.append(ln)
group_sec = "\n".join(block).strip()
assert group_sec.startswith("## 分组开关"), "专家卡分组段提取失败"

new_text = (
    main_text.rstrip()
    + f"\n\n{MARK}\n\n"
    + group_sec
    + "\n\n- 本副本=专家模式:逐件链手动细调 + 分组开关;按型自动装组走 [85](热调数据即时生效,与主文件同源);日常出图请用主文件 K2-文生图-道劫.json(栈节点 [90])。\n"
)

if node_e["widgets_values"][0] != new_text:
    node_e["widgets_values"][0] = new_text
    EXPERT.write_text(json.dumps(doc_e, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"专家卡已同步(矩阵 {len(main_text)} 字 + 专属段 {len(group_sec)} 字)")
else:
    print("专家卡已是最新(幂等跳过)")
