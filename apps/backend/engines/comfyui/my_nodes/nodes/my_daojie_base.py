# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫底座节点:九型底座下拉选型,装配收进节点一处(09-18 用户令)。

真源=daojie_ink_guofeng/json/qi21_bases.json types[](1004 集中化令;原
本目录 daojie_bases.json 已退役删件,字段 positive/negative→positive_text/
negative_text;十档=九型+自由末位)——_daojie_data 四层候选现读:combo=json
条目顺序现读+文件 mtime 失效重扫;positive/negative 每次 run 重读原文,
热改即时生效。旧「数据源放包内而非 art_skills(electron-builder 排除、
装机读不到)」理由已废止留痕——09-22 方案C 解除排除,装机同步打包
(my_styles.py 与 json/家 README 同口径)。

装配语义(契约测试钉死,test_daojie_workflow_contract.py):
  positive 输出=底座在前+用户主体句在后,零分隔符直拼(底座全文以全角
  句号自足收尾,主体句 strip 后原样拼接;主体句留空=恒等纯底座,对齐
  道劫图 [50] 留空语义);
  negative 输出=用户负向在前+按型负面基线在后,顶层逗号 token 去重合并
  (复用 .my_styles._merge_negative,防两处实现漂移)。

分辨率四出(09-18 两出;09-20 三视图 A 案后扩四出):ASPECT(COMBO)+
MEGAPIXELS(FLOAT),值按所选型现读 qi21_bases.json 的 aspect_ratio/
megapixels 字段;另出 WIDTH/HEIGHT(INT) 两出——型带 resolution_override
([w,h] 整数对,如多视图 3072×1024 现值直填)时直出该值,否则按 ASPECTS
公式自算(公式与 [61] ResolutionSelector 逐字节一致:MP 按 1024² 计,
边长取整到 8 的倍数)。缺字段回退 1:1 (Square)/4.2 并在控制台警告
(回退 aspect 同为官方枚举逐字串,裸 "1:1" 该 combo 不收)。
[53] 已改吃本节点 WIDTH/HEIGHT([61] 退位旁路保留作手动档)——COMBO 枚举
无 3:1 档,特殊画幅(多视图 3:1)只能走 override 直出,09-20 三视图
「多个重复」二连否的根修。

真源关系(双真源链,见 docs/prompts/道劫_底座节点_0918.md):
  链A=0917 提示词包 §一 通用无型底座,唯一持有者=修手图 [12](逐字锁);
  链B=qi21_bases.json types[] 九型底座(原 daojie_bases.json 已并入,
  1004 集中化),持有者=本节点;两链关系钉死为
  「人物型=§一 结构性超集」(主干逐字开头+结尾句逐字收尾,契约测试锚
  从 0917 md 运行时切出、零硬编码)。
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

from .my_styles import _merge_negative

# 默认底座显式钉死+存在性校验(不在列表回落 json 首项;combo 保 json
# 条目顺序不 sorted——设计九型定序即用户使用序,同 my_styles DEFAULT_STYLE 纪律)
DEFAULT_BASE = "人物"

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
        / "studio-manuals" / "art_skills" / "daojie_ink_guofeng" / "json",
    ]
    for _base in _cands:
        _p = _base / fn
        if _p.is_file():
            return _p
    return _here.parent / fn


_BASES_JSON = _daojie_data("qi21_bases.json")

_JSON_MISSING_COMBO = ["(道劫底座库未找到,请重启漫影或检查安装)"]

# 分辨率字段缺失回退值(09-18):aspect 必须官方枚举逐字串(同
# ResolutionSelector aspect_ratio 槽 options),否则 [61] combo 不收
FALLBACK_ASPECT = "1:1 (Square)"
FALLBACK_MEGAPIXELS = 4.2

# 宽高比表(09-20):覆盖 object_info 实测的官方枚举全 8 档;公式与
# [61] ResolutionSelector 逐字节一致(MP 按 1024² 计,边长取整到 8 倍数)。
ASPECTS: dict[str, tuple[int, int]] = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


def native_px(aspect_label: str, megapixels: float, multiple: int = 8) -> tuple[int, int]:
    """由宽高比标签+MP 求像素(复刻 [61] 口径;九型实测 21:9·4.2→3208×1376)。"""
    wr, hr = ASPECTS.get(aspect_label, (1, 1))
    total = megapixels * 1024 * 1024
    scale = math.sqrt(total / (wr * hr))
    return (round(wr * scale / multiple) * multiple,
            round(hr * scale / multiple) * multiple)


def _width_height_of(base: str, entry: dict, aspect: str, megapixels: float) -> tuple[int, int]:
    """WIDTH/HEIGHT 两出:resolution_override([w,h]) 直出(先例直填,如多视图
    1536×512);缺/非法回退公式自算。非法时控制台警告不炸画布。"""
    override = entry.get("resolution_override")
    if (isinstance(override, (list, tuple)) and len(override) == 2
            and all(isinstance(v, int) and not isinstance(v, bool) and v > 0
                    for v in override)):
        return int(override[0]), int(override[1])
    if override is not None:
        print(f"[漫影 道劫底座] 「{base}」resolution_override 非法({override!r}),"
              "回退公式自算(应为 [宽,高] 正整数对)")
    return native_px(aspect, megapixels)

# 模块级缓存(mtime 失效):INPUT_TYPES 与 run 共用,热改即时生效
_bases_cache: dict = {"mtime": None, "entries": None}


def _load_bases() -> list:
    """qi21_bases.json types[] 现读(1004 集中化;dict 外壳取 types,
    兼容旧平铺 list);mtime 变化即重扫(增删改即刻可见)。"""
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
            data = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
            # 1004 正负拆开+集中地令:qi21_bases.json={lock_layer:{...}, types:[...]}
            entries = data.get("types", []) if isinstance(data, dict) else data
        except (OSError, ValueError):
            entries = []
    cache["mtime"], cache["entries"] = mtime, entries
    return entries




_lock_cache: dict = {"mtime": None, "data": None}

def _load_lock_layer() -> dict:
    """qi21_bases.json lock_layer 现读(1004 集中地令):风格底座正负双出。
    
    Returns: {"positive": str, "negative": str}
    """
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _lock_cache
    if cache["mtime"] == mtime and cache["data"] is not None:
        return cache["data"]
    if mtime is None:
        data = {"positive": "", "negative": ""}
    else:
        try:
            raw = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
            ll = raw.get("lock_layer", {}) if isinstance(raw, dict) else {}
            data = {"positive": ll.get("positive_text", ""), "negative": ll.get("negative_text", "")}
        except (OSError, ValueError):
            data = {"positive": "", "negative": ""}
    cache["mtime"], cache["data"] = mtime, data
    return data

def lock_layer_positive() -> str:
    """风格底座正向全文(全九型恒挂层)。"""
    return _load_lock_layer()["positive"]

def lock_layer_negative() -> str:
    """风格底座负面词(入负向编码器)。"""
    return _load_lock_layer()["negative"]

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


def _resolution_of(base: str, entry: dict) -> tuple[str, float]:
    """按型读 aspect_ratio/megapixels;缺字段回退 1:1 (Square)/4.2+控制台警告
    (热改后的 json、或旧装机副本未同步时走此路,回退值保 [61] combo 可收)。"""
    aspect = entry.get("aspect_ratio")
    if not isinstance(aspect, str) or not aspect:
        print(f"[漫影 道劫底座] 「{base}」缺 aspect_ratio 字段,"
              f"回退 {FALLBACK_ASPECT}(请重新同步自研节点或检查 qi21_bases.json)")
        aspect = FALLBACK_ASPECT
    megapixels = entry.get("megapixels")
    if isinstance(megapixels, bool) or not isinstance(megapixels, (int, float)):
        print(f"[漫影 道劫底座] 「{base}」缺 megapixels 字段,"
              f"回退 {FALLBACK_MEGAPIXELS}(请重新同步自研节点或检查 qi21_bases.json)")
        megapixels = FALLBACK_MEGAPIXELS
    return aspect, float(megapixels)


def lora_recipe_of(base: str) -> list:
    """按型 LoRA 配方(lora_recipe 字段,09-19 v3 九型配方 C2 单源)。

    返回 [{file, weight, ...}] 深拷贝;缺字段/无该型=空表——空表语义=回退
    全局链现行为(调用方按「不点亮任何按型槽」处理),与 aspect/mp 缺省
    回退同纪律。深拷贝防调用方污染模块缓存(_load_bases 的 entries)。"""
    entry = _entry(base)
    recipe = entry.get("lora_recipe") if entry else None
    if not isinstance(recipe, list):
        return []
    return [dict(item) for item in recipe if isinstance(item, dict)]


def steps_hint_of(base: str) -> dict:
    """按型步数档(steps_hint 字段);缺省回退 {fast:4, quality:12}(v3 任务书口径)。"""
    entry = _entry(base)
    hint = entry.get("steps_hint") if entry else None
    if not isinstance(hint, dict) or not {"fast", "quality"} <= set(hint):
        return {"fast": 4, "quality": 12}
    return {"fast": int(hint["fast"]), "quality": int(hint["quality"])}


class MyDaojieBase:
    """漫影道劫底座:base 下拉选九型,正向底座装配+按型负面 STRING 双出,
    另出该型分辨率 ASPECT(COMBO)+MEGAPIXELS(FLOAT)(JS 侧中文显示名:
    画幅比例/百万像素,见 web/daojie-base-node.js)。"""

    CATEGORY = "漫影"

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

    RETURN_TYPES = ("STRING", "STRING", "COMBO", "FLOAT", "COMBO", "INT", "INT")
    RETURN_NAMES = ("positive", "negative", "aspect", "megapixels", "base",
                    "width", "height")
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
                "道劫底座库缺失:qi21_bases.json 未找到(真源家 "
                "daojie_ink_guofeng/json/,四层候选均缺;原本目录 "
                "daojie_bases.json 已退役并入),"
                "请在漫影设置里重新同步自研节点,或重启漫影工作室")
        entry = _entry(base)
        if entry is None:
            raise RuntimeError(
                f"未知道劫底座:「{base}」。道劫底座现共 {len(bases_list())} 个可选型,"
                "请在画布重新选择底座下拉,或检查真源家 qi21_bases.json"
                "(daojie_ink_guofeng/json/)是否被改动")
        base_positive = entry.get("positive_text", "")
        base_negative = entry.get("negative_text", "")
        aspect, megapixels = _resolution_of(base, entry)
        width, height = _width_height_of(base, entry, aspect, megapixels)
        user_positive = (positive or "").strip()
        user_negative = (negative or "").strip()
        # 1004 正负拆开+集中地令:正向=型底座正向+锁层A正向+主体句;负向=型负面词+锁层A负面词+用户负向(合并去重)
        lock = _load_lock_layer()
        lock_pos = lock["positive"]
        lock_neg = lock["negative"]
        # 正向三层拼装:型底座 → 锁层A → 主体句(各层换行分隔)
        parts = [p for p in (base_positive, lock_pos, user_positive) if p.strip()]
        out_positive = "\n".join(parts)
        # 负向三层合并:型负面词+锁层A负面词+用户负向(顶层逗号去重)
        out_negative = _merge_negative(lock_neg, _merge_negative(base_negative, user_negative))
        return (out_positive, out_negative,
                aspect, megapixels, base, width, height)
