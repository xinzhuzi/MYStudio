#!/usr/bin/env python3
"""qi21-道劫-i2i [402] 用法速查「提示词起草」段升级手术(1015)

用户令「相关工作流里面的说明也要更新」:把 [402] 笔记的提示词起草段从
「唤取技能+见05库」升级为「以 09-图生图指令写作规范.md 为准」(1015 立,
官方I2I宪法×道劫纪律合并)。

事实基础(1015 实查):
- [402] MarkdownNote 在文件里双序列化:nodes[].widgets_values[0] 与
  widgets_values_named.text 两份(长度差在段外,起草段两份逐字同)。
- 契约测试仅锚 I2I_NOTE_ID=402 常量定义,不锚笔记内容(改文不触锚)。

fail-closed 范式(对齐 qi21_i2i_grouptitle_shorten_1015.py 先例):
- 术前判态:'### 提示词起草' 恰 2 处、两段逐字同、09 篇标记未在 → 才动笔
- 断言不满足 exit 2 零写入;已术后(标记已在)exit 3 幂等拦停
- .bak-1015note 备份留档不入 commit
- 术后验证:JSON 可解析/节点数不变/[402] 仍在/新标记恰 2 处
"""
import json
import shutil
import sys
from pathlib import Path

WF = Path("apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
BAK = WF.with_suffix(".json.bak-1015note")

OLD_HEAD = "### 提示词起草"
OLD_TAIL = "\\n\\n### 维护警示"
NEW_MARKER = "09-图生图指令写作规范"

NEW_SEG = (
    "### 提示词起草(1015 起以 09 篇为准)\\n\\n"
    "**i2i 指令(本件 [400] 槽)的起草/自检以 docs/prompts/Qwen-Image-2.1/09-图生图指令写作规范.md 为准**"
    "(1015 立:官方 I2I 宪法×道劫纪律合并)——五段模板(操作+保真开场→变化项写实→保真段逐类点名"
    "+取景锁→去除项锚图实存物→「本次编辑仅针对X这一项」防泄漏收束句+「其余未提及之处保持原样」);"
    "段序两式并存(保真先行/变化先行均合法,操作段与保真段两段在场为硬约束);"
    "N≥2 必 <imageN> 标签、N=1 禁标签;身份指图不描字;全角标点;词典色名+浓度括注;"
    "底座内容禁双写(头身比·全身入画归②层);cfg=1 禁写负向;"
    "发放前必跑 daojie_subject_overlap.py --base <型> 预检。"
    "已装技能 **qwen-image-2-1-prompter**(官方 PE 宪法封装)为官方底本;"
    "道劫主体句纪律(只写主体与画面,不重复风格词/全角标点/质量词禁入)"
    "见 docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md。"
)


def main() -> int:
    raw = WF.read_text(encoding="utf-8")

    if NEW_MARKER in raw:
        print("exit 3:已术后(09 篇标记已在),幂等拦停")
        return 3

    segs = []
    pos = 0
    while True:
        i = raw.find(OLD_HEAD, pos)
        if i < 0:
            break
        j = raw.find(OLD_TAIL, i)
        if j < 0:
            print("exit 2:锚异常(起草段后无维护警示段),零写入")
            return 2
        segs.append(raw[i:j])
        pos = j
    if len(segs) != 2:
        print(f"exit 2:'### 提示词起草' 预期 2 处(双序列化),实得 {len(segs)} 处,零写入")
        return 2
    if segs[0] != segs[1]:
        print("exit 2:两份起草段不逐字同, refuses 盲替,零写入")
        return 2

    shutil.copy2(WF, BAK)
    new_raw = raw.replace(segs[0], NEW_SEG)
    assert new_raw.count(NEW_MARKER) == 2, "替换后标记数异常"

    d = json.loads(new_raw)
    old_count = len(json.loads(raw)["nodes"])
    assert len(d["nodes"]) == old_count, "节点数漂移"
    assert any(n.get("id") == 402 for n in d["nodes"]), "[402] 丢失"

    WF.write_text(new_raw, encoding="utf-8")
    print(f"OK: [402] 起草段两份(widgets_values+widgets_values_named)已升级;"
          f"节点数 {old_count} 不变;备份 {BAK.name}")
    print("旧段(留档):", segs[0][:120], "…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
