# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫底座节点:九型底座下拉选型,装配收进节点一处(09-18 用户令)。

真源=本目录 daojie_bases.json(九型:人物/场景/道具/美宣/三视图/高清人脸/
分镜剧情图/表情差分/概念气氛图)磁盘现读:combo=json 条目顺序现读+文件
mtime 失效重扫;positive/negative 每次 run 重读原文,单文件热改即时生效。
数据源放包内而非 art_skills——daojie_ink_guofeng 被 electron-builder
排除、装机读不到(my_styles.py _FIRST_PHASE_EXCLUDED 同因),且与
daojie-prompt-contract.ts 双写有风险。

装配语义(契约测试钉死,test_daojie_workflow_contract.py):
  positive 输出=底座在前+用户主体句在后,零分隔符直拼(底座全文以全角
  句号自足收尾,主体句 strip 后原样拼接;主体句留空=恒等纯底座,对齐
  道劫图 [50] 留空语义);
  negative 输出=用户负向在前+按型负面基线在后,顶层逗号 token 去重合并
  (复用 .my_styles._merge_negative,防两处实现漂移)。

真源关系(双真源链,见 docs/prompts/道劫_底座节点_0918.md):
  链A=0917 提示词包 §一 通用无型底座,唯一持有者=修手图 [12](逐字锁);
  链B=daojie_bases.json 九型底座,持有者=本节点;两链关系钉死为
  「人物型=§一 结构性超集」(主干逐字开头+结尾句逐字收尾,契约测试锚
  从 0917 md 运行时切出、零硬编码)。
"""

from __future__ import annotations

import json
from pathlib import Path

from .my_styles import _merge_negative

# 默认底座显式钉死+存在性校验(不在列表回落 json 首项;combo 保 json
# 条目顺序不 sorted——设计九型定序即用户使用序,同 my_styles DEFAULT_STYLE 纪律)
DEFAULT_BASE = "人物"

_BASES_JSON = Path(__file__).resolve().parent / "daojie_bases.json"

_JSON_MISSING_COMBO = ["(道劫底座库未找到,请重启漫影或检查安装)"]

# 模块级缓存(mtime 失效):INPUT_TYPES 与 run 共用,热改即时生效
_bases_cache: dict = {"mtime": None, "entries": None}


def _load_bases() -> list:
    """daojie_bases.json 现读;mtime 变化即重扫(增删改即刻可见)。"""
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _bases_cache
    if cache["mtime"] == mtime and cache["entries"] is not None:
        return cache["entries"]
    if mtime is None:
        entries = []
    else:
        try:
            entries = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            entries = []
    cache["mtime"], cache["entries"] = mtime, entries
    return entries


def bases_list() -> list:
    """combo 值=json 条目 zh 顺序;文件缺失/解析失败返回占位单条,
    保节点可上画布不炸。"""
    names = [e["zh"] for e in _load_bases() if isinstance(e, dict) and e.get("zh")]
    return names or list(_JSON_MISSING_COMBO)


def _entry(base: str):
    for e in _load_bases():
        if isinstance(e, dict) and base in (e.get("zh"), e.get("key")):
            return e
    return None


class MyDaojieBase:
    """漫影道劫底座:base 下拉选九型,正向底座装配+按型负面 STRING 双出。"""

    CATEGORY = "my"

    @classmethod
    def INPUT_TYPES(cls):
        names = bases_list()
        if DEFAULT_BASE in names:
            default = DEFAULT_BASE
        elif names:
            default = names[0]
        else:
            default = ""
        return {
            "required": {"base": (names, {"default": default})},
            # forceInput(照 MyStylesLibrary 先例,原生 INPUT_TYPES 键):
            # 前端不为两输入建文本 widget,节点 widget 只剩 base 一枚,
            # widgets_values 恒单条 [型名]——道劫图 [80] 对齐的前提,勿加
            # multiline/default。
            "optional": {
                "positive": ("STRING", {"forceInput": True}),
                "negative": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, base, positive=None, negative=None):
        """底座文案热改须穿透引擎输出缓存(my_styles 09-16 战役同根修:
        节点读外部文件不进输入哈希,同输入重跑像素全同,文案改动被缓存吞)。
        返回 json mtime 签名:文案动=签名变=重执行;未动=同签名=正常吃缓存。"""
        try:
            return f"{base}:{_BASES_JSON.stat().st_mtime_ns}"
        except OSError:
            return float("nan")

    def run(self, base, positive=None, negative=None):
        if not _BASES_JSON.is_file():
            raise RuntimeError(
                "道劫底座库缺失:my_nodes/nodes/daojie_bases.json 未找到,"
                "请在漫影设置里重新同步自研节点,或重启漫影工作室")
        entry = _entry(base)
        if entry is None:
            raise RuntimeError(
                f"未知道劫底座:「{base}」。道劫底座现共 {len(bases_list())} 个可选型,"
                "请在画布重新选择底座下拉,或检查 my_nodes/nodes/daojie_bases.json "
                "是否被改动")
        base_positive = entry["positive"]
        base_negative = entry["negative"]
        user_positive = (positive or "").strip()
        user_negative = (negative or "").strip()
        # 底座在前+主体句零分隔符直拼:底座全文以全角句号自足收尾,主体句
        # 原样接续;留空=恒等纯底座(方向裁定记录见 0918 文档:画布链底座
        # 在前,与手册链正文在前刻意相反,勿"对齐")
        out_positive = (
            f"{base_positive}{user_positive}" if user_positive else base_positive)
        return (out_positive, _merge_negative(user_negative, base_negative))
