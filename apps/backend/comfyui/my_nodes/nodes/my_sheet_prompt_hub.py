"""my_sheet_prompt_hub.py — 道劫设定卡·提示词枢纽(1113 用户令「固化提示词单点分发」)。

画布从「九处散装提示词」变「一处入口」:本节点输入=主体句+角名+**背景类型/格式两旋钮**,
运行时热读 qi21_bases.json#sheet_card_qwen 真源(v5:{背景} 占位+backgrounds 三型表
+formats 格式注册表)装配三层提示词,14 出链接分发到各 TextEncode 与合成器——
背景类型/格式同源直连合成器对应输入,提示词与画布底色/版式永不脱钩
(用户令「配合明白不能出错」)。格式下拉与合成器同走 sheet_card_formats
(真源 formats 注册表,缺真源回退内嵌冻结快照)。
数据位候选链对齐 my_qi21_base(dev 真源家→引擎家 daojie-data→装机固定位)。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_HERE = Path(__file__).resolve()

try:  # 包内正常导入(引擎/pytest rootdir 在 apps 下)
    from . import sheet_card_formats as _sf
except ImportError:  # spec_from_file_location 裸载兜底(与合成器同款 shim)
    import importlib.util as _ilu
    _sf_spec = _ilu.spec_from_file_location(
        "sheet_card_formats", _HERE.parent / "sheet_card_formats.py")
    _sf = _ilu.module_from_spec(_sf_spec)
    _sf_spec.loader.exec_module(_sf)


def _daojie_data(fn: str) -> Path:
    """道劫资产四层候选(同 my_qi21_base._daojie_data 正典;自包含防跨节点 import)。"""
    _env = os.environ.get("MYSTUDIO_DAOJIE_DATA")
    if _env:
        return Path(_env) / fn
    for _base in (
        _HERE.parents[4] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",
        _HERE.parents[4] / "daojie-data",  # 引擎家数据位(Mac/Win 同构)
        Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/"
             "art_skills/daojie_ink_guofeng/json"),
        Path.home() / "Applications" / "漫影工作室.app" / "Contents"
        / "Resources" / "studio-manuals" / "art_skills" / "daojie_ink_guofeng" / "json",
    ):
        _p = _base / fn
        if _p.is_file():
            return _p
    return _HERE.parent / fn


def _truth() -> dict:
    return json.loads(_daojie_data("qi21_bases.json").read_text(encoding="utf-8"))


def _field(subject: str, key: str, default: str) -> str:
    for part in subject.replace("\n", "").split("|"):
        if part.startswith(key + ":"):
            return part.split(":", 1)[1].strip()
    return default


# Skill-5.4 §十 canon:角色档案字段=专业设定集标配信息栏(短字段行,程序绘)
# (键, 显示名):能力字段以「技能」名上卡(§十③ 物品名称=技能名)
ARCHIVE_FIELDS = (("姓名", "姓名"), ("性别", "性别"), ("年龄", "年龄"),
                  ("身份", "身份"), ("武器", "武器"), ("能力", "技能"))
ARCHIVE_VALUE_MAX = 12          # 长值(武器全名/能力句)取首段截 12 字,全量仍在格图与主体句


def _lead(val: str) -> str:
    """值取到首个半角逗号/破折号再截 ARCHIVE_VALUE_MAX 字(档案行原实现即此规则;{weapon_name} 同用,行为保持)。"""
    for sep in (",", "——"):
        val = val.split(sep)[0]
    return val[:ARCHIVE_VALUE_MAX]


def archive_line(subject: str, name: str) -> str:
    """主体句→底部档案行(逐字段取真源值,值至首个中英逗号/破折号,禁手搓)。"""
    parts = []
    for key, label in ARCHIVE_FIELDS:
        val = _field(subject, key, "")
        if not val:
            if key != "姓名":
                continue
            val = name or "沈孤鸿"
        parts.append(f"{label}:{_lead(val)}")
    return " · ".join(parts)


def design_note(subject: str) -> str:
    """主体句「设计说明:」字段→底带第二行(Skill-5.4 §十④ 2-4 短行;缺位=空)。"""
    return _field(subject, "设计说明", "")


def weapon_category(subject: str, q: dict) -> str:
    """武器类别=主体句「武器类别:」字段,缺省=真源默认类(1123 Phase 6)。

    未登记的类别=作者级错误,立即上抛并点名合法值——静默回落到默认类会重新产出
    带鞘剑卡(独孤剑尘实录),比报错更糟。
    """
    w = q["weapon"]
    default = w.get("default_category", "剑")
    field = w.get("category_field", "武器类别")
    cat = _field(subject, field, "").strip() or default
    legal = [default] + [c for c in w.get("templates", {}) if c != default]
    if cat not in legal:
        raise ValueError(f"主体句「{field}」字段值 {cat!r} 不在册(合法:{'/'.join(legal)})")
    return cat


def assemble(subject: str, name: str, bg: str) -> dict:
    """装配全卡提示词(纯函数,单测/枢纽共一条路;{背景} 按 truth.backgrounds 填)。"""
    bases = _truth()
    q = bases["sheet_card_qwen"]
    # 数值比较(1114:字符串比较 'v10'>='v4'=False 会误红;升两位数版本无感)
    assert int(q["format_version"].lstrip("v")) >= 4 and bg in q["backgrounds"], \
        f"真源 v4 缺位或背景型 {bg!r} 不在册"
    phrase = q["backgrounds"][bg]["phrase"]
    style = bases["art_style_base"]["positive_text"]
    style_neg = bases["art_style_base"].get("negative_text", "")
    fill = lambda s: s.replace("{背景}", phrase)  # noqa: E731
    t_item = next(t["positive_text"] for t in bases["types"]
                  if t["zh"] == q["weapon"].get("type", "道具"))
    name = name or _field(subject, "姓名", "沈孤鸿")
    # 1123 Phase 6(用户令「按照你的建议,要解决这个问题」):武器格/特效格模板按武器类别
    # 切换;未声明类别=默认类,走 v6 原模板(逐字节不变)
    base = weapon_category(subject, q)                 # 主体句声明的类别(剑/通用)
    default = q["weapon"].get("default_category", "剑")
    weapon = _field(subject, "武器", "长剑")
    ability = _field(subject, "能力", "剑气")
    declared = bool(_field(subject, "能力", ""))
    weapon_name = _lead(weapon)
    weapon_tmpl = (q["weapon"]["positive_template"] if base == default
                   else q["weapon"]["templates"][base])
    if base == default:
        category, effect_tmpl = base, q["effect"]["positive_template"]
    elif declared:
        category, effect_tmpl = base, q["effect"]["templates"][base]
    else:
        # 无「能力:」字段=细化类别(设定板写法技能:能力未提供时能力区留空并标注
        # 「能力未设定」,不编造能力):合成器按 labels.blank_cells 留空;此处只出纯底板
        # 文字且不拼美术风格底座(1123 实弹:拼了底板句+风格底座=模型自己造一个人物)
        category = q["weapon"].get("category_without_ability", {}).get(base, base)
        no_ability = q["effect"].get("templates_no_ability", {})
        if category not in no_ability:
            raise ValueError(f"真源 effect.templates_no_ability 缺类别 {category!r}"
                             "(weapon.category_without_ability 所指须在册)")
        effect_tmpl = no_ability[category]
    if base != default:
        labels = q.get("formats", {}).get("全卡", {}).get("labels", {})
        if category not in labels.get("variants", {}):
            raise ValueError(f"真源 formats.全卡.labels.variants 缺类别 {category!r}(角标变体须在册)")
        if not declared and "fx_1" not in labels.get("blank_cells", {}).get(category, []):
            raise ValueError(f"真源 formats.全卡.labels.blank_cells 缺类别 {category!r} 的 fx_1"
                             "(能力未设定=特效格须留空)")
    effect_text = (effect_tmpl if (base != default and not declared)
                   else "\n".join([effect_tmpl.format(ability=ability, weapon_name=weapon_name), style]))
    # 非默认类别武器格不拼道具型句(真源 weapon.templates_append_type=false,1123 实弹定谳:
    # 道具型句的「器物正面正交视角完整入画」让模型给器物配托盒/框轨;默认类仍三层不变)
    append_type = base == default or q["weapon"].get("templates_append_type", True)
    weapon_layers = [weapon_tmpl.format(name=name, weapon=weapon, weapon_name=weapon_name)]
    if append_type:
        weapon_layers.append(t_item)
    out = {
        "master": "\n".join([subject, fill(q["master"]["positive_text"]), style]),
        "master_i2i": fill(q["edit_instructions"]["master_i2i"]),
        "weapon": "\n".join([*weapon_layers, style]),
        "effect": effect_text,
        "neg_gen": ",".join(p for p in (style_neg, q["master"]["negative_text"]) if p),
        "neg_edit": ",".join(p for p in (style_neg, q["edit_negative"]) if p),
        "bg": bg,
        "武器类别": category,
    }
    for k in ("side", "back", "face", "head", "wrist", "waist"):
        out[k] = fill(q["edit_instructions"][k])
    # 非默认类别:side/back 指令的「佩剑挂载」按真源 view_mount 换成类别感知措辞(1123:原四字令模型把
    # 参考图上正确的油布剑包改成「缠布柄+裸鞘的佩剑」);默认类不替换,指令逐字不变
    if base != default:
        vm = q.get("view_mount") or {}
        mount_default, mount_by = vm.get("default", "佩剑挂载"), vm.get("by_category", {})
        if base not in mount_by:
            raise ValueError(f"真源 view_mount.by_category 缺类别 {base!r}(side/back 指令的背负物措辞须在册)")
        for k in ("side", "back"):
            if mount_default in out[k]:
                out[k] = out[k].replace(mount_default, mount_by[base])
    for k in EXP_TAGS:                          # 1114 Skill-5.4 §六 表情参考行
        out[k] = fill(q["edit_instructions"][k])
    # v6 底部信息带:档案行+设计说明行(两行合成一个 STRING 出,程序绘)
    out["档案"] = "\n".join(t for t in (archive_line(subject, name),
                                       design_note(subject)) if t)
    return out


EXP_TAGS = ("exp_happy", "exp_angry", "exp_sad", "exp_surprise", "exp_shy")
OUT_ORDER = ("master", "master_i2i", "weapon", "effect",
             "side", "back", "face", "head", "wrist", "waist",
             *EXP_TAGS,
             "neg_gen", "neg_edit", "bg", "格式", "档案",
             "武器类别")   # 1123 Phase 6:恒追加在尾(既有 20 槽位序不动,直连合成器「武器类别」)


class MySheetPromptHub:
    """道劫·设定卡提示词枢纽(单点固化→14 出分发;背景类型/格式单源旋钮)。"""

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
                           "设计说明:孤鸿出岫,剑修远尘;月白黛青取鸿羽掠空之色;"
                           "一剑收鞘,锋藏不露|"
                           "其余:无灵兽,无伤痕旧损")
        return {"required": {
            "主体句": ("STRING", {"default": subject_default, "multiline": True}),
            "角名": ("STRING", {"default": "沈孤鸿", "multiline": False}),
            "背景类型": (list(q["backgrounds"]), {"default": next(iter(q["backgrounds"]))}),
        }, "optional": {
            # optional 裁定(1114):required 会使旧法构造的 API 直调 prompt JSON
            # 缺『格式』字段即 validate 红;缺省全卡=画布存量件无感。
            "格式": (_sf.formats_list(), {"default": "全卡"}),
        }}

    RETURN_TYPES = ("STRING",) * 21
    RETURN_NAMES = ("正向·master", "指令·master图生图", "正向·武器", "正向·特效",
                    "指令·侧视图", "指令·背视图", "指令·面部", "指令·头部",
                    "指令·腕部", "指令·腰部",
                    "指令·开心", "指令·生气", "指令·悲伤", "指令·惊讶", "指令·害羞",
                    "负面·生成", "负面·编辑", "背景类型",
                    "格式", "档案", "武器类别")
    FUNCTION = "hub"
    CATEGORY = "道劫/设定卡"

    def hub(self, 主体句, 角名, 背景类型, 格式="全卡"):
        out = assemble(主体句, 角名, 背景类型)
        out["格式"] = 格式  # 单源旋钮直连合成器『格式』输入(缺省透传,prompts 恒 base)
        return tuple(out[k] for k in OUT_ORDER)


NODE_CLASS_MAPPINGS = {"MySheetPromptHub": MySheetPromptHub}
