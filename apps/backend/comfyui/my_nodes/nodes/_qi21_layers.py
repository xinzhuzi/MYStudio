# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""装配层结构体单源(1108 根治役 S2:声明句字段化+层结构体化)。

道劫 t2i/i2i/edit 装配链(ApiPE direct/lean 路 + MyQi21PromptAssembly)的
层对象与层上变换唯一真源——字符串只在两端口进出:入口(节点 STRING 槽→
ingest 建层)、出口(render 序列化,进编码器前一刻)。1108 病根=中间变换
作用在自然语言字符串上靠标点猜结构(剥除器吞层两轮实弹事故);根治=型文
正文零中文透明声明(数据侧手术,qi21_decl_fieldize_1108.py)+剥除/合并/
包裹全部作用于层对象,层丢失=字段空=显式可见(渲染口警告/全空响亮拒)。

收编的漂移(两/三处各写各的→单源):
  · 设定卡条件预解析 _resolve_card_conditionals(ApiPE 与装配器手工逐句同步
    的两份复制);
  · 负面合并切分语义(my_styles._split_top_level_tokens 仅半角逗号+括号深度
    保护 vs ApiPE 内联 [,，\n] 全角+换行无深度保护)→统一=换行+全角逗号+
    顶层半角逗号(括号深度保护,权重组建制不拆),保序去重;
  · 型元数据逐字匹配(_type_is_transparent/_type_subject_first/rgba_positive
    查找三处循环)→lookup_type 一发。

剥除器(_qi21_rgba_text.strip_rgba_decl)保留为 legacy 数据副本兜底:
ingest_type_text 恒过 strip+存活断言——真源数据(1108 手术后)零声明=恒等,
正则匹配面归零;真源外旧份/手改混入声明时句级隔离+存活断言拦丢层。
加载纪律:本文件被节点模块以 `from ._qi21_layers import ...` 导入;直载
形态(单测 importlib 无包上下文)走下方 peer-load 腿,同 _qi21_rgba_text 家法。
"""
from __future__ import annotations

from pathlib import Path
import re
from typing import NamedTuple

# 剥除+存活断言单源(legacy 兜底;双路导入=直载形态家法)
try:
    from ._qi21_rgba_text import assert_strip_survival, strip_rgba_decl
except ImportError:  # pragma: no cover - 直载形态(单测)走此腿
    import importlib.util as _ilu
    _rgba_spec = _ilu.spec_from_file_location(
        "qi21_rgba_text_peer_load", Path(__file__).resolve().parent / "_qi21_rgba_text.py")
    _rgba_mod = _ilu.module_from_spec(_rgba_spec)
    _rgba_spec.loader.exec_module(_rgba_mod)
    strip_rgba_decl = _rgba_mod.strip_rgba_decl
    assert_strip_survival = _rgba_mod.assert_strip_survival

# lean 路全空兜底句(0927d 探针实弹定谳配方,原样迁入)
_LEAN_FALLBACK = ("A single game asset, clean flat cutout, centered, "
                  "isolated on a transparent background.")


class Qi21Layers(NamedTuple):
    """装配层结构体:三层正文+负面清单(1108 层结构体化)。

    style     美术风格底座(纯画法;空=裸测/降级/槽缺席,合法缺席白名单见 render)
    type_text 类型句正文(背景/照明/状态规则;1108 手术后真源零中文透明声明)
    subject   主体句(画面里画什么的人话描述)
    negatives 负面 token 序(merge_negative_tokens 合并去重后;序=型→底座→主体句)

    NamedTuple 而非 @dataclass(frozen=True):本仓 peer-load 家法(importlib
    module_from_spec 不注册 sys.modules)下,py3.12 dataclasses._is_type 查
    sys.modules.get(cls.__module__)=None 直接 AttributeError(引擎 venv 实弹);
    NamedTuple 同样不可变+值相等,零加载器耦合。
    """
    style: str = ""
    type_text: str = ""
    subject: str = ""
    negatives: tuple[str, ...] = ()


def ingest_type_text(base_text: str | None, context: str = "") -> str:
    """型文入口统一变换:legacy 声明句兜底剥除+存活断言(1108 后真源恒等)。

    真源数据(声明句字段化手术毕)正文零标记→strip 恒等;真源外旧副本/手改
    数据混入声明时,句级剥除只剔声明句,存活断言拦层丢失(响亮拒出图)。
    任何标点组合不再是层完整性的输入(变换不猜结构)。
    """
    src = base_text or ""
    out = strip_rgba_decl(src)
    assert_strip_survival(src, out, context=context or "型文入口")
    return out.strip()


def split_negative_tokens(text: str | None) -> tuple[str, ...]:
    """负面清单粒状切分:换行+全角逗号+顶层半角逗号(括号深度保护)。

    深度保护=权重组建制不拆((worst quality, low quality:1.4) 整 token 保留,
    my_styles._split_top_level_tokens 语义);全角逗号纳入切分=ApiPE 旧内联
    语义——两套漂移在此定谳合一(真源负面清单全角逗号=分隔符,粒状拆开后
    跨源去重才生效;旧装配器巨 token 形「模糊」双现随轮退役)。
    """
    tokens: list[str] = []
    for line in (text or "").split("\n"):
        buf: list[str] = []
        depth = 0
        for ch in line:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth = max(0, depth - 1)
            if ch in ",，" and depth == 0:
                tokens.append("".join(buf))
                buf = []
            else:
                buf.append(ch)
        tokens.append("".join(buf))
    return tuple(t.strip() for t in tokens if t.strip())


def merge_negative_tokens(*sources) -> tuple[str, ...]:
    """负面多源合并:依序粒状切分+整 token 相等去重(保守,不做子串/语义归并)。

    源序=型负面→美术风格底座负面→主体句负面(1005 案B ㊄ 三源序);输出侧
    以半角", "拼接(两装配位共用,同源同值)。
    """
    merged: list[str] = []
    seen: set[str] = set()
    for src in sources:
        for tok in split_negative_tokens(src):
            if tok not in seen:
                seen.add(tok)
                merged.append(tok)
    return tuple(merged)


def lookup_type(types_list, base_text: str | None) -> dict | None:
    """型文逐字匹配 types[](正/负文本匹配家法,零跨模块 import 的单源版)。

    匹配不到(自由型空串/外接自定义型文)=None,调用方按保守缺省处理。
    """
    needle = (base_text or "").strip()
    for t in types_list or []:
        if isinstance(t, dict) and (t.get("positive_text") or "").strip() == needle:
            return t
    return None


def type_flag(types_list, base_text: str | None, key: str) -> bool:
    """型旗读取(rgba_default/subject_first/lean_carry_type 等);匹配不到=False。"""
    entry = lookup_type(types_list, base_text)
    return bool(entry and entry.get(key) is True)


def resolve_card_conditionals(base_text: str, subj_text: str) -> str:
    """设定卡条件预解析(1017 官方对拍役;1108 收编单源,原两份手工同步复制退役)。

    型文=模板(条件句照存);终稿按主体句事实落定成确定描述。原句缺席=不换
    (fail-closed,模板日后改句退回模板句)。与旧实现逐句同版(行为零改)。
    """
    if not base_text or not subj_text:
        return base_text
    out = base_text
    m = re.search(r"名号「([^」]{1,12})」", subj_text)
    if m:
        out = out.replace(
            "标题栏中央放置角色名号，主体明确提供名号时逐字使用，未提供时标题栏留白仅存细线边饰；",
            f"标题栏中央逐字放置角色名号「{m.group(1)}」；", 1)
    if "劲装" in subj_text:
        out = out.replace(
            "服装袖型、衣长与裤裙形制服从主体，主体为劲装时呈束袖束腰上衣与分开的双腿裤装，武器长短和材质服从主体；",
            "服装呈束袖束腰上衣与分开的双腿裤装，武器长短和材质服从主体句；", 1)
    if ("收鞘" in subj_text) or ("收在鞘中" in subj_text):
        out = out.replace(
            "武器的收鞘、出鞘或残损状态服从主体事实；完整武器两端均入画，局部图与完整图对应同一件武器；来源为收鞘态时，完整图与所有局部图均保持收鞘态。各特写只呈现实际存在的部件；主体未提供武器、鞘或配饰装备时，对应槽位保留净空，格面留白。",
            "完整武器两端均入画，局部图与完整图对应同一件武器，完整图与所有局部图均保持收鞘态；各特写只呈现实际存在的部件。", 1)
    if not re.search(r"技能|术法|招式|功法|神通|绝学", subj_text):
        out = out.replace(
            "底部第四区为能力资料：主体明确提供技能或术法时，上格展示一幅该能力的独立效果，下格展示其关键形态或作用部位；主体未提供时，该区保留净空，仅标注“能力未设定”。来源明确带有灵兽时，另用独立附板展示完整兽形与兽类细节，附板独立排布；来源未带灵兽时，本板保持人物设定板内容。",
            "底部第四区为能力资料：该区保留净空，仅标注“能力未设定”。", 1)
    return out


def render_t2i(layers: Qi21Layers, context: str = "", *, card_first: bool = False,
               style_expected: bool = True, type_expected: bool = True) -> str:
    """t2i 三层序列化(美术风格底座\\n类型句:T\\n主体句:X,1022 统一序;1017 标签令)。

    层可见性显式化(1108):三层全空=响亮拒(无文本可装配);期望层空=中文
    警告打印(日志可查),合法缺席由调用方以 *_expected=False 白名单声明
    (裸测档 style 缺席/自由型与未接线 type 缺席/ApiPE 槽缺席=1017 裁定)。
    设定卡旗型(card_first)类型句按主体句事实条件落定(解析单源在本模块)。
    """
    if not ((layers.style or "").strip() or (layers.type_text or "").strip()
            or (layers.subject or "").strip()):
        raise RuntimeError(
            f"[漫影 层结构] {context}: 三层全空——无文本可装配,拒出图"
            "(查主体句/BASE/底座三路输入是否全部缺席)")
    if style_expected and not (layers.style or "").strip():
        print(f"[漫影 层结构] {context}: 美术风格底座层为空——裸测/降级档合法;"
              "非预期时请查底座槽连线与 qi21_bases.json art_style_base")
    if type_expected and not (layers.type_text or "").strip():
        print(f"[漫影 层结构] {context}: 类型句层为空——自由型/未接线降级合法;"
              "非预期时请查 [150] MyQi21DaojieBase 的 BASE 连线")
    type_out = (resolve_card_conditionals(layers.type_text, layers.subject)
                if card_first else layers.type_text)
    parts = []
    if (layers.style or "").strip():
        parts.append(layers.style)
    if (type_out or "").strip():
        parts.append(f"类型句:{type_out}")
    if (layers.subject or "").strip():
        parts.append(f"主体句:{layers.subject}")
    return "\n".join(parts)


def render_style_swap(layers: Qi21Layers, context: str = "") -> str:
    """道劫美术风格转换序列化:主体句(编辑指令)\\n画法(保留原构图,09 篇两落法)。"""
    _ = context
    return "\n".join(p for p in ((layers.subject or "").strip(),
                                 (layers.style or "").strip()) if p)


def render_free(layers: Qi21Layers, context: str = "") -> str:
    """自由出图序列化:仅编辑指令(不继承类型布局/统一打光/全局负向)。"""
    _ = context
    return (layers.subject or "").strip()


def render_lean(parts, context: str = "") -> str:
    """透明回退极简公式序列化(遗留兼容件):非空段空格连缀,全空=官方英文兜底句。

    段序=主体句→画法托底→类型句版式(lean_carry_type 型)→rgba 格式锁→隔离句
    (1008 R3 九型实弹定谳配方,1017 十型验修序);头尾零自带(治双头双尾,
    官方英文头尾由 [4014] FinalOutput 统一包裹)。
    """
    _ = context
    kept = [p for p in parts if (p or "").strip()]
    return " ".join(kept) if kept else _LEAN_FALLBACK
