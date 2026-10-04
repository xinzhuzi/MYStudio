# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫 qi21 底座节点:型底座下拉选(09-23 造件九型;1001 P1 起十档=九型+自由),
五出 BASE/WIDTH/HEIGHT/透明值/负面词(1002 ⑯ 删「型名」出+大轮连带删
rgba_default 出:i2i [180].rgba_hint 已迁「透明值」,三件全零消费;槽位迁移=
research/slot-map.md;负面词=1005 案B Phase I 第五出,追加最末存量槽序零漂移)。

仿 K2 件 MyDaojieBase(同包 my_daojie_base.py)的 combo 九选一+分辨率直出+
磁盘热读三件套,为 qi21-道劫 工作流接线备件(接线属下一轮,本轮零碰工作流):

  数据真源=daojie_ink_guofeng/json/qi21_bases.json(1004 集中化令;本目录同名件=
  四层兜底同步产物,禁手改,改真源家后跑同步;九型 zh 顺序=条目 canon 顺序;
  原「05 库→qi21_bases_extract_0923.py 提取器」旧链已退役留档,勿再以为改②层入口):
    base_text=库②层(型底座·美化版)+人物系增量四锁B(常量B·§四.4-.7)+
    ④配色行的换行拼合,与 docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md
    对应型逐字一致(契约测试从 05 库运行时切出对拍,零硬编码);①主体句槽与
    常量A·基础锁不在 BASE 内——由工作流恒挂层承担(05 库装配子图口径)。
    aspect_ratio/megapixels(及 canon override 型)照抄 canon——多视图型 0927 起 Q2.1侧
    分档 3:4 Portrait 4.2MP 并退役 override(提取器 Q21_ASPECT_FORK;K2 侧 canon 不动)。
    rgba_default(0929 画布治理批 D6 RGBA 型联动)=四型透明声明型(道具/多视图/高清
    人脸/表情差分)true 其余五型 false——**布尔真源=提取器 RGBA_DEFAULT_TYPES 常量**
    (05 库只载声明文字不载布尔,防文档格式漂移带坏机器可读链;提取时与②层透明
    声明句互锁对账);rgba_default 槽(BOOLEAN,追加最末不动既有槽序=存量工作流
    接线零漂移)供装配子图 RGBA 型联动(设计 D6:MyQi21RgbaSelect.rgba_hint←本槽);
    缺/非布尔回退 False+控制台警告(回退=默认关,与五型默认同态=安全侧)。

  W/H 口径单源=K2 件:native_px/FALLBACK_* 直接 import(同 K2 复用
  my_styles._merge_negative 的防两处实现漂移纪律)——resolution_override 直出,
  否则 MP 按 1024² 计、边长取整到 8 的倍数(公式与 [61] ResolutionSelector
  逐字节一致);契约测试钉死九型 W/H 与 K2 MyDaojieBase 同型输出一比一。

  透明执行口(1001 用户测试批 P1,design §2.4 d 方案/1001 深夜 grill 修正):
  optional 尾部「透明覆盖」(BOOLEAN, default False)+第六出「透明值」——
  透明值 = 型≠自由 ? 该型 rgba_default : 透明覆盖(九型=型默认优先,
  覆盖被忽略;自由型=面板布尔直通)。存量五出槽序零漂移(0929
  rgba_default 追加同款纪律),旧工作流不接新槽/不消费第六出=零波及;
  装配子图透明模式改接本出后=纯 BOOLEAN 跨子图边界(问题⑦),子图内
  [210] 三态合成层退役(问题⑥),「跟随型」解析住在底座件(数据同源);
  面板布尔恒存不被改写(消灭 web 扩展同步值方案的切型丢手设缺陷:
  自由型手设透明=true,切九型再切回,true 还在——扩展从此只管显隐
  不管值)。「自由」档=qi21_bases.json 十档末位(base_text="" 无型底座
  层,W/H 兜底 1:1/1.0MP=1024×1024,rgba_default=false 用户指定)。

  磁盘现读同 K2:combo=json 条目顺序现读+文件 mtime 失效重扫,base_text 每次
  run 重读原文,单文件热改即时生效;IS_CHANGED 返回 mtime 签名穿透引擎输出
  缓存(my_styles 09-16 战役同根修)。缺分辨率字段回退 1:1 (Square)/4.2 并在
  控制台警告(回退值=FALLBACK 常量,与 K2 单源)。

  负面词第五出(1005 案B Phase I,design §8.1 ①):=entry.negative_text 现读
  ——型负面 36 条的出口(此前=无出口死数据,PE 编造词顶掉锁层真负面)。
  上游接 [4011] MyQi21PromptAssembly.BASE负面(optional,缺键=空串),装配器
  merge(型负面,锁层负面)后经「负面词直写」进负向编码(案B 直写优先)。
  与 BASE 同条目热读(同一 _load_bases 现读链),缺键回退空串(空负向合法态,
  同 BASE 的 .get 默认纪律);追加最末=存量四出槽序零漂移(0929/1001 同款
  纪律,旧工作流不接第五出=零波及)。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from .my_daojie_base import FALLBACK_ASPECT, FALLBACK_MEGAPIXELS, native_px

# 默认选型显式钉死+存在性校验(不在列表回落 json 首项;combo 保 json 条目顺序
# 不 sorted——设计九型定序即用户使用序,同 K2 DEFAULT_BASE 纪律)
DEFAULT_BASE = "人物"

# 自由型名(1001 用户测试批 P1,design §2.4):十档末位,无型底座层(BASE 空串)
# +透明值走面板「透明覆盖」直通(九型=rgba_default 型默认优先)。型名与
# qi21_bases.json 条目 zh 同源;若热改 json 改名,本判定随之失效=透明值退
# 回 rgba_default(安全侧),combo 无自由档时用户无从选到,非静默错路。
FREE_BASE = "自由"

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
            data = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
            entries = data.get("types", []) if isinstance(data, dict) else data
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
    直出(canon 先例直填);缺/非法回退公式自算
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


def _rgba_default_of(base: str, entry: dict) -> bool:
    """rgba_default(0929 画布治理批 D6:四型透明声明型默认开 RGBA,其余五型
    默认关);缺/非布尔回退 False+控制台警告(热改 json、旧装机副本未同步走此路
    ——回退=默认关,与五型默认同态=安全侧,同 _resolution_of 缺字段纪律)。"""
    v = entry.get("rgba_default")
    if not isinstance(v, bool):
        print(f"[漫影 qi21底座] 「{base}」缺 rgba_default 字段,"
              "回退 False(请重新同步自研节点或检查 qi21_bases.json)")
        return False
    return v


class MyQi21DaojieBase:
    """漫影道劫 qi21 底座:选型下拉十选一(九型+自由,1001 P1),BASE(该型②+B+④
    拼合底座全文;自由型空串)+WIDTH/HEIGHT(型档分辨率直出;自由型 1:1/1.0MP
    兜底 1024×1024)+rgba_default(0929 D6 RGBA 型联动:四型透明声明型 true
    其余 false)+透明值(1001 P1 透明执行口:型≠自由?rgba_default:透明覆盖
    ——纯 BOOLEAN 跨子图边界)+负面词(1005 案B Phase I:=entry.negative_text
    现读,型负面出口)五出(1002 ⑯ 删「型名」第四出:三件全零消费)。"""

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
        # 1002 ⑭ 接口批查:本件零连线输入槽(combo/BOOLEAN 全 widget),「连线槽
        # 前置」=空操作,声明序维持;⑰ tooltip 补(prd 问题⑰大白话口径)
        return {
            "required": {"base": (names, {
                "default": default,
                "tooltip": "选画风型:九个预设型+「自由」(自由=不要型底座,"
                           "画幅/透明全自己定)"})},
            # 透明覆盖(1001 用户测试批 P1,design §2.4 d 方案):尾部追加,
            # 存量槽序零漂移;缺省 False=九型不受影响(i2i/edit 不接=零波及)
            "optional": {"透明覆盖": ("BOOLEAN", {
                "default": False,
                "tooltip": "只在「自由」型下有用:勾上=出透明底图;九个预设型"
                           "自动按型决定,这里不用管"})},
        }

    # rgba_default 追加最末(0929 D6):不动既有槽序=存量工作流接线零漂移
    # (t2i/i2i 两件 [150] 现用槽 0/1/2,BASE/WIDTH/HEIGHT 索引不变);
    # 透明值追加第六出(1001 P1 同款纪律):型≠自由?rgba_default:透明覆盖
    # 1002 ⑯ 清理批:删「型名」第四出(三件工作流全零消费=RETURN_TYPES 历史
    # 按型路由遗留)——中部删,存量连线按槽位映射表迁移(research/slot-map.md);
    # 1002 大轮连带(prd Grill Q1 裁定 A 案「rgba_default 删除」):rgba_default
    # 出随 i2i [180].rgba_hint 迁「透明值」(1002 手术 STEP4)一并收口删除
    # ——rgba_default 布尔仍为件内中间量(透明值=型≠自由?rgba_default:
    # 透明覆盖 解析用),只是不再外露输出槽;
    # 负面词追加第五出(1005 案B Phase I,design §8.1 ①):=entry.negative_text
    # 现读(与 BASE 同条目),追加最末=四出槽序零漂移(旧工作流不接=零波及)。
    RETURN_TYPES = ("STRING", "INT", "INT", "BOOLEAN", "STRING")
    RETURN_NAMES = ("BASE", "WIDTH", "HEIGHT", "透明值", "负面词")
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, base, 透明覆盖: bool | None = None):
        """底座文本热改须穿透引擎输出缓存(同 K2 件根修:节点读外部文件不进
        输入哈希,同输入重跑像素全同,文本改动被缓存吞)。返回 json mtime 签名:
        文案动=签名变=重执行;未动=同签名=正常吃缓存。
        透明覆盖具名收参(1001 P4 实弹发现的签名欠账:引擎把 optional 槽一并
        投给 IS_CHANGED,签名缺该参→「unexpected keyword argument」WARNING+
        签名失效;K2 件 positive/negative 同款具名惯例)。签名值不参与返回
        (透明覆盖只影响第六出布尔,轻件输出无缓存穿透需求)。"""
        try:
            return f"{base}:{_BASES_JSON.stat().st_mtime_ns}"
        except OSError:
            return float("nan")

    def run(self, base, 透明覆盖: bool | None = None):
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
        rgba_default = _rgba_default_of(base, entry)
        # 透明值(1001 P1 d 方案):型≠自由=型默认优先(覆盖被忽略);
        # 自由型=面板布尔直通(缺省 None 按 False,与 default 同态)。
        # 解析住底座件(数据同源),跨子图边界=纯 BOOLEAN(问题⑦)。
        if base == FREE_BASE:
            透明值 = bool(透明覆盖) if 透明覆盖 is not None else False
        else:
            透明值 = rgba_default
        # 1002 ⑯:「型名」直通出删除;1002 大轮连带:rgba_default 出收口删除
        # (i2i [180].rgba_hint 已迁「透明值」);
        # 1005 案B Phase I:负面词第五出=型负面现读(缺键回退空串=空负向合法态,
        # 与 BASE 的 .get 默认同款纪律;返回元组序=RETURN_NAMES 五出序)
        return (entry.get("positive_text", ""), width, height, 透明值,
                entry.get("negative_text", ""))
