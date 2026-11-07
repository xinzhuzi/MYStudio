# -*- coding: utf-8 -*-
"""MyMossDaojieBase——MOSS 道劫底座十四选一(1108 道劫范式×MOSS-Image 役)。

母本=MyQi21DaojieBase(my_qi21_base.py,接口/槽序/语义逐字镜像);唯一分叉=
数据源 moss_bases.json(由 qi21_bases.json 派生:6 透明型带白底句+人物海报带
挂载服从句——1108 用户裁定「重新做个 moss_bases.json」)。装配节点
MyQi21PromptAssembly 复用(BASE 出=型文原文,ingest 在装配入口单源做)。

六出 BASE/WIDTH/HEIGHT/负面词/透明值/型名 与母本同序——画布件
moss-道劫-t2i.json 的 1→4/9 连线契约锚。透明值在 MOSS 线语义=驱动
「白底转透明」后链(MOSS=flux2-vae 纯 RGB,1108 p2 实弹定谳)。
"""
from __future__ import annotations

import json

from .my_daojie_base import (
    FALLBACK_ASPECT,
    FALLBACK_MEGAPIXELS,
    _daojie_data,
    _width_height_of,
)

DEFAULT_BASE = "人物海报"
FREE_BASE = "自由"
_BASES_JSON = _daojie_data("moss_bases.json")
_JSON_MISSING_COMBO = ["(MOSS 道劫底座库未找到,请同步自研节点或检查 daojie-data)"]

_bases_cache: dict = {"mtime": None, "entries": None, "raw": None}


def _load() -> dict:
    """moss_bases.json 现读(mtime 失效缓存,热改即时生效;母本同款纪律)。"""
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _bases_cache
    if cache["mtime"] == mtime and cache["raw"] is not None:
        return cache["raw"]
    raw: dict = {}
    if mtime is not None:
        try:
            raw = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
    cache.update(mtime=mtime, raw=raw,
                 entries=raw.get("types", []) if isinstance(raw, dict) else [])
    return raw


def _entries() -> list:
    _load()
    return _bases_cache["entries"] or []


def bases_list() -> list:
    names = [e["zh"] for e in _entries() if isinstance(e, dict) and e.get("zh")]
    return names or list(_JSON_MISSING_COMBO)


def _entry(base: str):
    for e in _entries():
        if isinstance(e, dict) and base == e.get("zh"):
            return e
    return None


class MyMossDaojieBase:
    """漫影 MOSS 道劫底座:base 下拉选型(数据=moss_bases.json 十四型),
    六出同母本:BASE/WIDTH/HEIGHT/负面词/透明值/型名。"""

    CATEGORY = "漫影"

    @classmethod
    def INPUT_TYPES(cls):
        names = bases_list()
        default = DEFAULT_BASE if DEFAULT_BASE in names else (names[0] if names else "")
        return {
            "required": {"base": (names, {"default": default,
                                          "tooltip": "选画风型(MOSS 版型库 moss_bases.json):"
                                                     "十四型与 qi21 同名同画幅;透明型型文自带"
                                                     "白底句,配合白底转透明后链出真透明"})},
            "optional": {"透明覆盖": ("BOOLEAN", {
                "default": False,
                "tooltip": "只在「自由」型下有用:勾上=走白底转透明后链;"
                           "预设型自动按型决定"})},
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "STRING", "BOOLEAN", "STRING")
    RETURN_NAMES = ("BASE", "WIDTH", "HEIGHT", "负面词", "透明值", "型名")
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, base, 透明覆盖: bool | None = None):
        try:
            return f"moss:{base}:{_BASES_JSON.stat().st_mtime_ns}"
        except OSError:
            return float("nan")

    def run(self, base, 透明覆盖: bool | None = None):
        if not _BASES_JSON.is_file():
            raise RuntimeError(
                "MOSS 道劫底座库缺失:moss_bases.json 未找到(四层候选含 daojie-data),"
                "请在漫影设置里重新同步自研节点,或重启漫影工作室")
        entry = _entry(base)
        if entry is None:
            raise RuntimeError(
                f"未知 MOSS 道劫底座:「{base}」。现共 {len(bases_list())} 个可选型,"
                "请在画布重新选择选型下拉,或检查 moss_bases.json 是否被改动")
        aspect = entry.get("aspect_ratio")
        if not isinstance(aspect, str) or not aspect:
            print(f"[漫影 MOSS 道劫底座] 「{base}」缺 aspect_ratio,回退 {FALLBACK_ASPECT}")
            aspect = FALLBACK_ASPECT
        megapixels = entry.get("megapixels")
        if isinstance(megapixels, bool) or not isinstance(megapixels, (int, float)):
            print(f"[漫影 MOSS 道劫底座] 「{base}」缺 megapixels,回退 {FALLBACK_MEGAPIXELS}")
            megapixels = FALLBACK_MEGAPIXELS
        width, height = _width_height_of(base, entry, aspect, float(megapixels))
        if base == FREE_BASE:
            透明值 = bool(透明覆盖) if 透明覆盖 is not None else False
        else:
            透明值 = bool(entry.get("rgba_default", False))
        return (entry.get("positive_text", ""), width, height,
                entry.get("negative_text", ""), 透明值, base)
