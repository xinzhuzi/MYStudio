# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 最终输出件(MyQi21FinalOutput,1005 ㊄ 用户令 [4014] 简化拆件)。

用户令(1005):[4014] 从「PE 路由+合成」简化为「最终处理(透明包裹+双口
输出)」——删掉全部 PE 相关输入(pe开关/PE出文/PE负面/lazy 协议)和 PE 路由
逻辑;PE 选择全部前移到 [4012] PE开关路由 + [4021] 主体句路由(主体句过
PE 后再拼型底座/锁层A,装配器出全文,到本件时 PE 事已毕)。

本件与 MyQi21PromptSelect 的分工(1005 ㊄ 拆双类,修「一类两用」断裂):
  MyQi21PromptSelect = i2i/edit 老架构专用(装配→PE→选择 全逻辑+lazy 协议,
    my_qi21_prompt_select.py;1005 ㊄ 起 t2i 不再用它)
  MyQi21FinalOutput  = t2i 新管线专用(本件;零 PE 槽,透明包裹+双口输出)

输入口(3 连线槽,零 widget 参数框——RGBA 头尾/W1 三固定句走 qi21_bases.json
rgba 节热读,改库即可见,画布无参数框=1005 用户令「删参数框(JSON热读)」):
  装配全文   ← [4011] MyQi21PromptAssembly.装配全文;缺键(None)=降级空串
             +中文 print 警告(裁定 A 自洽语义,与 select 件同款)
  负面词直写 ← [4011] MyQi21PromptAssembly.负面词(=型负面+锁层负面+主体句
             负面 三源 merge 真值);缺键=空串(空负向合法态)
  透明模式   ← [4010].rgba_default(纯 BOOLEAN 连线,透明自动跟型)

逻辑(pe关路=select 件 pe关分支逐字保持;剥离不施于本件——词族剥离只用于
PE 扩写段(英文词族噪声),装配全文=纯中文三层,禁过剥离=6d5fa8a 深审
HIGH-2 同款口径):
  正文   = 装配全文
  透明开 = RGBA官方头句 + " " + 装配全文 + " " + W1收束句 + " "
           + RGBA官方尾句(1005 用户令去重:中文透明声明插入已删——声明逐字
           =头句+尾句拼接,头尾转中文后即书挡,再插一遍=同一句话出现两次)
  透明关 = 装配全文 原样
  负向   = 负面词直写 原样(不包裹不剥离;透明包裹是正向路的画幅服从性指令)

数据热读(_daojie_data 四层候选链+mtime 缓存,自 my_qi21_prompt_select.py
逐字迁入,勿 import 化禁令同款——lazy 契约测试 spec 直载无包上下文)。
注册(import+NODE_CLASS_MAPPINGS+DISPLAY「道劫·qi21最终输出」)在
my_nodes/__init__.py,本文件不自带注册。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# 数据真源(10-04 集中地令):qi21_bases.json 四层候选链解析(1004 §十六)
def _daojie_data(fn: str) -> Path:
    """道劫资产四层候选(1004 §十六):env→dev真源家→引擎家数据位→装机固定位→同目录产物兜底。

    env 显式设置但文件不在=响亮降级原路返回(下游缺档占位/报错指路),不偷偷
    滑落低层——免测试/定制环境静默读到别家库(MYSTUDIO_ART_SKILLS 先例纪律)。
    引擎家数据位=parents[4]/daojie-data:随文件真实所在地走(引擎家内节点在
    <家>/ComfyUI/custom_nodes/my-nodes/nodes/,上四级即家根,上三级只到
    ComfyUI 源码层),MYSTUDIO_COMFYUI_HOME 覆写/~manying-dev 兜底布局自动
    跟随,零 import(勿 import 化禁令)。装机固定位两安装位(同 my_styles
    _INSTALL_FIXED_CANDIDATES)。
    """
    _env = os.environ.get("MYSTUDIO_DAOJIE_DATA")
    _here = Path(__file__).resolve()
    if _env:
        _p = Path(_env) / fn
        if not _p.is_file():
            print(f"[漫影 道劫数据] MYSTUDIO_DAOJIE_DATA 已设但缺 {_p}:"
                  "响亮降级不兜底其它层(显式覆盖失效须排查,防静默读别家库)")
        return _p
    _cands = [
        _here.parents[5] / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json",
        _here.parents[4] / "daojie-data",
        Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json"),
        Path.home() / "Applications" / "漫影工作室.app" / "Contents" / "Resources"
        / "studio-manuals/art_skills/daojie_ink_guofeng/json",
    ]
    for _base in _cands:
        _p = _base / fn
        if _p.is_file():
            return _p
    return _here.parent / fn


_BASES_JSON = _daojie_data("qi21_bases.json")

# 整文件解析缓存(mtime 失效,同 my_daojie_base._load_lock_layer 模式):
# 缓存 json.loads 原文解析结果且以 mtime 为键——热改文件=mtime 变=现读重扫。
_bases_cache: dict = {"mtime": None, "data": None}


def _load_bases_data() -> dict:
    """qi21_bases.json 整文件现读(mtime 缓存);缺失/损坏=中文 RuntimeError。"""
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _bases_cache
    if mtime is not None and cache["mtime"] == mtime and cache["data"] is not None:
        return cache["data"]
    if mtime is None:
        raise RuntimeError(
            "qi21 数据库缺失:my_nodes/nodes/qi21_bases.json 未找到——请在漫影"
            "设置里重新同步自研节点,或重启漫影工作室")
    try:
        data = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(
            "qi21 数据库缺失或损坏:my_nodes/nodes/qi21_bases.json 读取失败"
            f"({exc})——请在漫影设置里重新同步自研节点,或重启漫影工作室") from exc
    if not isinstance(data, dict):
        raise RuntimeError(
            "qi21 数据库结构不合法:my_nodes/nodes/qi21_bases.json 顶层应为"
            "对象(JSON 对象,非数组/标量)")
    cache["mtime"] = mtime
    cache["data"] = data
    return data


def _load_rgba(key: str) -> str:
    """rgba 节热读(head/tail/w1_closing;英文备档=head_en/tail_en)。"""
    node = _load_bases_data().get("rgba")
    if not isinstance(node, dict) or key not in node:
        raise RuntimeError(
            f"qi21 数据库缺 rgba.{key}:请在漫影设置里重新同步自研节点,"
            "或检查 qi21_bases.json rgba 节")
    val = node[key]
    if not isinstance(val, str) or not val.strip():
        raise RuntimeError(
            f"qi21 数据库 rgba.{key} 应为非空字符串")
    return val


# import 时刻求值一次(default/常量面;热改 JSON 须重启引擎——与 select 件同款取舍)
_RGBA_HEAD = _load_rgba("head")    # RGBA官方头句(中文;英文备档=rgba.head_en)
_RGBA_TAIL = _load_rgba("tail")    # RGBA官方尾句(中文;英文备档=rgba.tail_en)
_TAIL = _load_rgba("w1_closing")   # W1收束句(中文)

# 1005 退役:头尾已中文化,本句与头句逐字重复
_ZH_ALPHA_DECL = ('这是一张带有透明度的RGBA图像 '
                  '该图像具有alpha通道,背景是透明的')


class MyQi21FinalOutput:
    """漫影最终输出:透明包裹+双口输出(零 PE 槽,t2i 新管线专用)。"""

    CATEGORY = "漫影"
    DESCRIPTION = "最终输出:装配全文+负面词直写→透明包裹→进编码正/负文本(t2i 新管线,PE已前移)"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # 1005 ㊄ [4014] 简化拆件:3 连线槽全 optional(可不接语义;required 化
        # 会被引擎验证层拒);零 widget 参数框(RGBA 头尾/W1 走 JSON 热读)。
        return {
            "required": {},
            "optional": {
                "正向提示词": ("STRING", {"tooltip": "AI 扩写后的完整正向提示词"
                                                "(主体句×PE选择+型底座+锁层A三层"
                                                "拼装),连「三层拼装」节点的"
                                                " 装配全文 输出;不连=正向降级"
                                                "空串,日志有中文警告"}),
                "负向提示词": ("STRING", {"tooltip": "AI 精炼后的负面清单"
                                                 "(型负面+锁层负面+主体句负面),"
                                                 "连「三层拼装」节点的 负面词 "
                                                 "输出;不连=空负向(合法态)"}),
                "透明模式": ("BOOLEAN", {"default": False,
                                          "tooltip": "透明包裹开关;连「类型句"
                                                     "选择」的 rgba_default 输出"
                                                     "=透明自动跟型"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("进编码正向文本", "进编码负向文本")
    FUNCTION = "compose"

    def compose(self, 正向提示词: str | None = None,
                负向提示词: str | None = None,
                透明模式: bool = False) -> tuple[str, str]:
        """最终处理:(进编码正向文本, 进编码负向文本)(元组序=RETURN_NAMES 序)。

        全参数有 default,缺投不炸 TypeError;装配全文 None=降级空串+中文
        print 警告(裁定 A 自洽:缺真源=缺整段文本,日志可查,不猜不代选)。
        剥离不施于本件(词族剥离只用于 PE 扩写段;装配全文=纯中文三层,
        禁过剥离——zh 词族会误删锁层A 核心句,6d5fa8a 深审 HIGH-2 同款口径)。
        """
        direct_neg = (负向提示词 or "").strip()
        if 正向提示词 is None:
            print("[MyQi21FinalOutput] 装配全文输入未接线:正向无真源文本可用,"
                  "进编码正向文本降级为空串——请把 [4011] 三层拼装的 装配全文 "
                  "输出连到本节点 装配全文 输入,或检查该连线是否被改动")
            direct = ""
        else:
            direct = 正向提示词
        transparent_mid = direct + " " + _TAIL
        if 透明模式:
            return (f"{_RGBA_HEAD} {transparent_mid} {_RGBA_TAIL}",
                    direct_neg)
        return (direct, direct_neg)
