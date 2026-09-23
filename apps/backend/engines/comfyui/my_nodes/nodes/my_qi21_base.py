# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫 qi21 底座节点:九型底座下拉选一,四出 BASE/WIDTH/HEIGHT/型名(09-23 造件)。

仿 K2 件 MyDaojieBase(同包 my_daojie_base.py)的 combo 九选一+分辨率直出+
磁盘热读三件套,为 qi21-道劫 工作流接线备件(接线属下一轮,本轮零碰工作流):

  真源=本目录 qi21_bases.json(九型 zh 顺序=canon daojie_bases.json 条目顺序;
  由 apps/build/scripts/qi21_bases_extract_0923.py 从 05 库幂等提取落盘):
    base_text=库②层(型底座·美化版)+人物系增量四锁B(常量B·§四.4-.7)+
    ④配色行的换行拼合,与 docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md
    对应型逐字一致(契约测试从 05 库运行时切出对拍,零硬编码);①主体句槽与
    常量A·基础锁不在 BASE 内——由工作流恒挂层承担(05 库装配子图口径)。
    aspect_ratio/megapixels(及三视图 resolution_override 3072×1024)照抄 canon。

  W/H 口径单源=K2 件:native_px/FALLBACK_* 直接 import(同 K2 复用
  my_styles._merge_negative 的防两处实现漂移纪律)——resolution_override 直出,
  否则 MP 按 1024² 计、边长取整到 8 的倍数(公式与 [61] ResolutionSelector
  逐字节一致);契约测试钉死九型 W/H 与 K2 MyDaojieBase 同型输出一比一。

磁盘现读同 K2:combo=json 条目顺序现读+文件 mtime 失效重扫,base_text 每次
run 重读原文,单文件热改即时生效;IS_CHANGED 返回 mtime 签名穿透引擎输出
缓存(my_styles 09-16 战役同根修)。缺分辨率字段回退 1:1 (Square)/4.2 并在
控制台警告(回退值=FALLBACK 常量,与 K2 单源)。
"""

from __future__ import annotations

import json
from pathlib import Path

from .my_daojie_base import FALLBACK_ASPECT, FALLBACK_MEGAPIXELS, native_px

# 默认选型显式钉死+存在性校验(不在列表回落 json 首项;combo 保 json 条目顺序
# 不 sorted——设计九型定序即用户使用序,同 K2 DEFAULT_BASE 纪律)
DEFAULT_BASE = "人物"

_BASES_JSON = Path(__file__).resolve().parent / "qi21_bases.json"

_JSON_MISSING_COMBO = ["(qi21底座库未找到,请重启漫影或检查安装)"]

# 模块级缓存(mtime 失效):INPUT_TYPES 与 run 共用,热改即时生效(同 K2 件)
_bases_cache: dict = {"mtime": None, "entries": None}


def _load_bases() -> list:
    """qi21_bases.json 现读;mtime 变化即重扫(增删改即刻可见)。"""
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
        if isinstance(e, dict) and base == e.get("zh"):
            return e
    return None


def _resolution_of(base: str, entry: dict) -> tuple[str, float]:
    """按型读 aspect_ratio/megapixels;缺字段回退值与 K2 单源(FALLBACK 常量)
    +qi21 措辞警告(热改后的 json、或旧装机副本未同步时走此路)。"""
    aspect = entry.get("aspect_ratio")
    if not isinstance(aspect, str) or not aspect:
        print(f"[漫影 qi21底座] 「{base}」缺 aspect_ratio 字段,"
              f"回退 {FALLBACK_ASPECT}(请重新同步自研节点或检查 qi21_bases.json)")
        aspect = FALLBACK_ASPECT
    megapixels = entry.get("megapixels")
    if isinstance(megapixels, bool) or not isinstance(megapixels, (int, float)):
        print(f"[漫影 qi21底座] 「{base}」缺 megapixels 字段,"
              f"回退 {FALLBACK_MEGAPIXELS}(请重新同步自研节点或检查 qi21_bases.json)")
        megapixels = FALLBACK_MEGAPIXELS
    return aspect, float(megapixels)


def _width_height_of(base: str, entry: dict, aspect: str, megapixels: float) -> tuple[int, int]:
    """WIDTH/HEIGHT 两出(口径=K2 MyDaojieBase):resolution_override([w,h])
    直出(canon 先例直填,如三视图 3072×1024);缺/非法回退公式自算
    (native_px:MP 按 1024² 计,边长取整到 8 的倍数)。非法时控制台警告不炸画布。"""
    override = entry.get("resolution_override")
    if (isinstance(override, (list, tuple)) and len(override) == 2
            and all(isinstance(v, int) and not isinstance(v, bool) and v > 0
                    for v in override)):
        return int(override[0]), int(override[1])
    if override is not None:
        print(f"[漫影 qi21底座] 「{base}」resolution_override 非法({override!r}),"
              "回退公式自算(应为 [宽,高] 正整数对)")
    return native_px(aspect, megapixels)


class MyQi21DaojieBase:
    """漫影道劫 qi21 底座:选型下拉九选一,BASE(该型②+B+④拼合底座全文)+
    WIDTH/HEIGHT(型档分辨率直出)+型名(直通,驱动按型路由)四出。"""

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
        return {"required": {"base": (names, {"default": default})}}

    RETURN_TYPES = ("STRING", "INT", "INT", "STRING")
    RETURN_NAMES = ("BASE", "WIDTH", "HEIGHT", "型名")
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, base):
        """底座文本热改须穿透引擎输出缓存(同 K2 件根修:节点读外部文件不进
        输入哈希,同输入重跑像素全同,文本改动被缓存吞)。返回 json mtime 签名:
        文案动=签名变=重执行;未动=同签名=正常吃缓存。"""
        try:
            return f"{base}:{_BASES_JSON.stat().st_mtime_ns}"
        except OSError:
            return float("nan")

    def run(self, base):
        if not _BASES_JSON.is_file():
            raise RuntimeError(
                "qi21 底座库缺失:my_nodes/nodes/qi21_bases.json 未找到,"
                "请在漫影设置里重新同步自研节点,或重启漫影工作室")
        entry = _entry(base)
        if entry is None:
            raise RuntimeError(
                f"未知 qi21 底座:「{base}」。qi21 底座现共 {len(bases_list())} 个可选型,"
                "请在画布重新选择选型下拉,或检查 my_nodes/nodes/qi21_bases.json "
                "是否被改动")
        aspect, megapixels = _resolution_of(base, entry)
        width, height = _width_height_of(base, entry, aspect, megapixels)
        return (entry["base_text"], width, height, base)
