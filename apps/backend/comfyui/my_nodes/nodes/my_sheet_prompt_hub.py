"""my_sheet_prompt_hub.py — 道劫设定卡·提示词枢纽(1113 用户令「固化提示词单点分发」)。

画布从「九处散装提示词」变「一处入口」:本节点输入=主体句+角名+**背景类型唯一旋钮**,
运行时热读 qi21_bases.json#sheet_card_qwen 真源(v4:{背景} 占位+backgrounds 三型表)
装配三层提示词,13 出链接分发到各 TextEncode 与合成器——背景类型同源直连合成器
「背景」输入,提示词与画布底色永不脱钩(用户令「配合明白不能出错」)。
数据位候选链对齐 my_qi21_base(dev 真源家→引擎家 daojie-data→装机固定位)。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_HERE = Path(__file__).resolve()
_TRUTH_CANDIDATES = (
    _HERE.parents[4] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",
    Path(os.environ.get("MYSTUDIO_COMFYUI_HOME",
                        Path.home() / "Library/Application Support/漫影工作室/comfyui"))
    / "daojie-data",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/"
         "art_skills/daojie_ink_guofeng/json"),
)


def _truth() -> dict:
    for cand in _TRUTH_CANDIDATES:
        p = cand / "qi21_bases.json"
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    raise RuntimeError("qi21_bases.json 真源缺位(候选链:" +
                       "|".join(str(c) for c in _TRUTH_CANDIDATES) + ")")


def _field(subject: str, key: str, default: str) -> str:
    for part in subject.replace("\n", "").split("|"):
        if part.startswith(key + ":"):
            return part.split(":", 1)[1].strip()
    return default


def assemble(subject: str, name: str, bg: str) -> dict:
    """装配全卡提示词(纯函数,单测/枢纽共一条路;{背景} 按 truth.backgrounds 填)。"""
    bases = _truth()
    q = bases["sheet_card_qwen"]
    assert q["format_version"] >= "v4" and bg in q["backgrounds"], \
        f"真源 v4 缺位或背景型 {bg!r} 不在册"
    phrase = q["backgrounds"][bg]["phrase"]
    style = bases["art_style_base"]["positive_text"]
    style_neg = bases["art_style_base"].get("negative_text", "")
    fill = lambda s: s.replace("{背景}", phrase)  # noqa: E731
    t_item = next(t["positive_text"] for t in bases["types"]
                  if t["zh"] == q["weapon"].get("type", "道具"))
    name = name or _field(subject, "姓名", "沈孤鸿")
    out = {
        "master": "\n".join([subject, fill(q["master"]["positive_text"]), style]),
        "master_i2i": fill(q["edit_instructions"]["master_i2i"]),
        "weapon": "\n".join([q["weapon"]["positive_template"].format(
            name=name, weapon=_field(subject, "武器", "长剑")), t_item, style]),
        "effect": "\n".join([q["effect"]["positive_template"].format(
            ability=_field(subject, "能力", "剑气")), style]),
        "neg_gen": ",".join(p for p in (style_neg, q["master"]["negative_text"]) if p),
        "neg_edit": ",".join(p for p in (style_neg, q["edit_negative"]) if p),
        "bg": bg,
    }
    for k in ("side", "back", "face", "head", "wrist", "waist"):
        out[k] = fill(q["edit_instructions"][k])
    return out


OUT_ORDER = ("master", "master_i2i", "weapon", "effect",
             "side", "back", "face", "head", "wrist", "waist",
             "neg_gen", "neg_edit", "bg")


class MySheetPromptHub:
    """道劫·设定卡提示词枢纽(单点固化→13 出分发;背景类型唯一旋钮)。"""

    @classmethod
    def INPUT_TYPES(cls):
        q = _truth()["sheet_card_qwen"]
        subject_default = ("姓名:沈孤鸿|性别:男|年龄:二十二岁|身份:剑修|"
                           "能力:孤鸿剑气——剑锋凝出一线青白剑气,形如鸿羽掠空,自剑尖延展约三尺|"
                           "脸型:清峻,丹凤眼深褐瞳,眉斜飞入鬓|发型:黑发高束马尾,墨青发带,颊侧两缕碎发|"
                           "服装:月白窄袖长袍衣缘银线暗纹,内黛青束袖劲装,墨色宽腰封缀素银方扣,"
                           "黛青束口裤,玄色短靴靴口银边|配色:主色月白,辅色黛青,点睛银|"
                           "衣料:主衣料细密缎面,腰封厚织锦,绑绳素麻绳|配饰:墨青发带,腰封素银方扣,剑穗青白丝线|"
                           "武器:长剑,玄色木胎鲛皮鞘,鞘口衔银,剑柄缠墨色丝绦,剑穗青白丝线,收鞘态|"
                           "其余:无灵兽,无伤痕旧损")
        return {"required": {
            "主体句": ("STRING", {"default": subject_default, "multiline": True}),
            "角名": ("STRING", {"default": "沈孤鸿", "multiline": False}),
            "背景类型": (list(q["backgrounds"]), {"default": "素白宣纸"}),
        }}

    RETURN_TYPES = ("STRING",) * 13
    RETURN_NAMES = ("正向·master", "指令·master图生图", "正向·武器", "正向·特效",
                    "指令·侧视图", "指令·背视图", "指令·面部", "指令·头部",
                    "指令·腕部", "指令·腰部", "负面·生成", "负面·编辑", "背景类型")
    FUNCTION = "hub"
    CATEGORY = "道劫/设定卡"

    def hub(self, 主体句, 角名, 背景类型):
        out = assemble(主体句, 角名, 背景类型)
        return tuple(out[k] for k in OUT_ORDER)


NODE_CLASS_MAPPINGS = {"MySheetPromptHub": MySheetPromptHub}
