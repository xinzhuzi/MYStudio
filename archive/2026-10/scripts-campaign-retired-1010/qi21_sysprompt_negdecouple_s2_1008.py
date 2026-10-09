#!/usr/bin/env python3
"""qi21 S2 教材收敛手术(2026-10-08,Trellis 10-04-qi21-prompt-cleanup S1+S2 耦合批)。

1008 用户裁定=方案②(不删宪法原文八步框架,08§11「永不删改」)三改 + 两死子键清理:
  ①删「扩写模式」死枝(ChinesePE 1005 ㉛ 产线作废后工作流/子图零引用=休眠件口径:
    删+台账记回补条件「未来复用且喂手写短句须回补扩写指引」);
  ②「300-800字」硬线降软参考(保留透明豁免 200 字下限语义);
  ③「负面词生成」职责与教材内负面清单输入引用彻底移除(1008 终裁:模型输入侧
    已无负面清单,教材不得引用不存在的输入;S1 同批移除 py 侧 [负面词清单] 块);
  ④输出契约收敛单键 {"rewritten_prompt": ...}:删 negative_prompt 要求(终裁)与
    wh_ratio 要求([4018] 端口已退役死文)——模型返回多余键则忽略;
  ⑤expand_instruction 两负向死子键 negative_format_patch/negative_guidance 清理
    (唯一消费方=ChinesePE 退化英文补丁路,isinstance 缺位守卫=删除零炸,休眠件在案)。

全部 splice 带旧串锚断言(count==1,fail-closed);术后语义自检(在场/离场标记
+十律对撞查:豁免语义保留/锚点保留/八步框架八步俱全)+整文件 round-trip。
"""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
TARGET = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"

data = json.loads(TARGET.read_text(encoding="utf-8"))
ei = data["expand_instruction"]
sp = ei["system_prompt_zh"]
before_len = len(sp)


def splice(old: str, new: str, tag: str) -> None:
    global sp
    n = sp.count(old)
    assert n == 1, f"[{tag}] 旧串应恰出现 1 次,得 {n} 次(fail-closed)"
    sp = sp.replace(old, new)
    print(f"[ok] {tag}")


# ── 开篇导语:删宽高比建议(wh_ratio 死文) ────────────────────────────────────
splice(
    "你将用户的图像需求扩写为一段完整的中文画面描述长文，以及画面宽高比建议。",
    "你将用户的图像需求扩写为一段完整的中文画面描述长文。",
    "intro wh_ratio removal",
)

# ── 第二步:删 wh_ratio 填写指令(画幅采用语义保留=运行约束仍生效) ──────────
splice(
    "上下文给了[画幅]宽×高就直接采用，wh_ratio 填它的最简整数比（如 1024×1536 → 2:3），"
    "不要自行改选；没给[画幅]才根据内容选：横构图默认 16:9，竖构图默认 2:3，正方形默认 1:1。",
    "上下文给了[画幅]宽×高就直接采用，画面描述按此纵横比组织，不要自行改选；"
    "没给[画幅]才根据内容定画幅方向：横构图默认 16:9，竖构图默认 2:3，正方形默认 1:1。",
    "step2 wh_ratio removal",
)

# ── 第八步:300-800 硬线降软参考(透明 200 字下限豁免保留) ────────────────────
splice(
    "描述必须是一段连贯的中文长文（300-800字），像一个观察者在描述他看到的完成画面。"
    "（透明开时字数下限放宽至200字。）",
    "描述必须是一段连贯的中文长文，像一个观察者在描述他看到的完成画面；"
    "篇幅以300-800字为软参考，画面信息完整优先于凑字数。（透明开时字数下限放宽至200字。）",
    "step8 soften 300-800",
)

# ── 负面清单生成节整删(职责与输入引用彻底移除) ──────────────────────────────
splice(
    "## 负面清单生成\n\n"
    "根据用户输入中的负面词，生成一份精炼的中文负面提示词清单。清单内容：\n"
    "- 直接使用用户提供的负面词(逐条全数并入,一条不丢)\n"
    "- 补充与画面风格明显冲突的通用负面词（如模糊、水印等）;上下文[负面词清单]已合并的条目逐条全数并入\n\n",
    "",
    "negative-list section removal",
)

# ── 输出格式:单键契约 ───────────────────────────────────────────────────────
splice(
    '{"rewritten_prompt": "<中文描述长文>", "negative_prompt": "<中文负面清单>", '
    '"wh_ratio": "<给定画幅的最简比如3:2;未给画幅才自选>"}',
    '{"rewritten_prompt": "<中文描述长文>"}',
    "output contract single key",
)

# ── 全文润炼补充:删扩写模式死枝(休眠件口径,回补条件入台账) ──────────────────
splice(
    "## 全文润炼补充(输入形态分派)\n",
    "## 全文润炼补充\n",
    "runline header de-dispatch",
)
splice(
    "\n- 输入是**手写短句**(用户亲笔)时=**扩写模式**:按八步工作法扩写,但锚点权重最高,"
    "实体逐字保留(唯环境实体在透明开时按上文删除)。",
    "",
    "expand-mode dead branch removal",
)

# ── 两负向死子键清理 ─────────────────────────────────────────────────────────
assert "negative_format_patch" in ei and "negative_guidance" in ei, \
    "死子键应恰在场待清(fail-closed)"
del ei["negative_format_patch"]
del ei["negative_guidance"]
print("[ok] dead subkeys removal")

# ── 语义自检(在场/离场 + 十律对撞查) ────────────────────────────────────────
MUST_ABSENT = ("负面清单生成", "[负面词清单]", "negative_prompt", "wh_ratio",
               "扩写模式", "输入形态分派", "300-800字），", "负面提示词清单")
MUST_PRESENT = ("# 图像提示词扩写专家", "## 裁决序", "## 核心规则", "## 八步工作法",
                "## 输出格式", "## 色卡选题", "## 透明模式", "## 全文润炼补充",
                "### 第一步", "### 第二步", "### 第三步", "### 第四步",
                "### 第五步", "### 第六步", "### 第七步", "### 第八步",
                '"rewritten_prompt"', "300-800字为软参考", "放宽至200字",
                "透明底立绘素材", "大气透视",  # 撞词豁免组前提:教材仍载该合法术语
                "润炼模式", "色词逐字禁换", "部件锚点零丢失", '只管"新增"的色彩描述')
for mark in MUST_ABSENT:
    assert mark not in sp, f"[语义自检] 应离场标记残留:{mark}"
for mark in MUST_PRESENT:
    assert mark in sp, f"[语义自检] 应在场标记缺失:{mark}"
# 教材内「负面」字样残余清点(终裁:教材不载负向职责)
assert "负面" not in sp, f"[语义自检] 教材仍含「负面」字样:{[l for l in sp.splitlines() if '负面' in l]}"

ei["system_prompt_zh"] = sp

# ── 落盘(round-trip + 字段保护:除 expand_instruction 外顶层零变动) ─────────
backup = json.loads((REPO / ".trellis/tasks/10-04-qi21-prompt-cleanup/backups"
                     / "qi21_bases.json.s1s2.pre").read_text(encoding="utf-8"))
assert set(backup.keys()) == set(data.keys()), "顶层键集不得变动"
for k in data:
    if k != "expand_instruction":
        assert backup[k] == data[k], f"字段保护违例:顶层 {k} 被改动"
assert set(backup["expand_instruction"].keys()) - {"negative_format_patch", "negative_guidance"} \
    == set(data["expand_instruction"].keys()), "expand_instruction 除两死子键外键集不得变动"
TARGET.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
rt = json.loads(TARGET.read_text(encoding="utf-8"))
assert rt["expand_instruction"]["system_prompt_zh"] == sp, "round-trip 校验失败"
print(f"[落盘] {TARGET}")
print(f"[账] system_prompt_zh {before_len} → {len(sp)} 字;"
      f"expand_instruction 子键 {sorted(backup['expand_instruction'])} → {sorted(ei)}")
