# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫按型 LoRA 节点(09-19 用户令「九型让不同的 lora 生效」)。

[80] 选型不仅带底座文案与画幅,还驱动按型 LoRA 组:型→LoRA 清单真源=
daojie_ink_guofeng/json/daojie_loras.json(1004 集中化;原本目录同名件=
四层兜底同步产物,与 qi21_bases.json 同纪律——原 daojie_bases.json 已退役
并入——_daojie_data 现读、mtime 失效、热改即时生效);节点吃 [80].base
输出(COMBO 直供,同 aspect/megapixels
先例)+MODEL 入,按清单顺序叠装 LoRA 后 MODEL 出,另出 applied STRING=
实际生效清单(审计/预览用,接 showAnything 可见)。

按型初始配方(裁定+默认,全部可在 json 热调,勿改图):
  人物系(人物/美宣/多视图/表情差分/高清人脸/分镜剧情图)=67细节×1+76亚洲面孔×0.4+73鎏金×0.3
  (人物三件=09-19 用户裁定;场景免鎏金同源裁定)
  场景系(场景/概念气氛图)=67细节×1+金雾仙侠×0.6(金雾=09-19 实拍定谳唯一倾向件,
  淡彩向与 73 现代资产向相反,按型自动二选一=「非替换」的共存形态)
  道具=67细节×1+73鎏金×0.3(静物无面孔;道具底座自带「旧金点睛」语言)

引擎依赖(folder_paths/comfy.*)在 run 内懒加载——repo 侧测试只测数据面与
映射纯函数,不 import 引擎库(同包其余节点纪律)。"""
from __future__ import annotations

import json
import os
from pathlib import Path


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


_LORAS_JSON = _daojie_data("daojie_loras.json")

# 模块级缓存(mtime 失效):热改 json 即时生效(同 my_daojie_base 纪律)
_loras_cache: dict = {"mtime": None, "entries": None}


def _load_entries() -> list:
    try:
        mtime = _LORAS_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _loras_cache
    if cache["mtime"] == mtime and cache["entries"] is not None:
        return cache["entries"]
    if mtime is None:
        entries = []
    else:
        try:
            entries = json.loads(_LORAS_JSON.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            entries = []
    cache["mtime"], cache["entries"] = mtime, entries
    return entries


def loras_for(base: str) -> list | None:
    """型→LoRA 清单;命中判 zh/key 双轨(同底座 _entry 纪律);未知型返回 None。"""
    for e in _load_entries():
        if isinstance(e, dict) and base in (e.get("zh"), e.get("key")):
            return e.get("loras") or []
    return None


def types_list() -> list:
    return [e["zh"] for e in _load_entries() if isinstance(e, dict) and e.get("zh")]


class MyDaojieLoras:
    """漫影道劫按型 LoRA:base 由 [80] 供线驱动,按 daojie_loras.json 装组;
    applied 出=生效清单文本(审计口径,如「场景:Krea2-细节滑杆DetailSlider_v1×1 +
    金雾仙侠GoldenMisty×0.6」)。"""

    CATEGORY = "漫影"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                # forceInput(照 [61] aspect_ratio 先例):无 widget,值由 [80].base 供线
                "base": ("COMBO", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "applied")
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, model, base):
        """json 热改须穿透引擎输出缓存(同 MyDaojieBase 根修:外部文件不进输入哈希)。"""
        try:
            return f"{base}:{_LORAS_JSON.stat().st_mtime_ns}"
        except OSError:
            return float("nan")

    def run(self, model, base):
        entries = loras_for(base)
        if entries is None:
            raise RuntimeError(
                f"未知道劫型:「{base}」。按型 LoRA 现共 {len(types_list())} 个可选型,"
                "请检查真源家 daojie_ink_guofeng/json/daojie_loras.json 或 [80]→[85] 供线")
        if not entries:
            return (model, f"{base}:无按型 LoRA(直通)")

        try:
            import folder_paths
            import comfy.utils
            import comfy.sd
        except ImportError as exc:  # repo 侧测试/无引擎环境
            raise RuntimeError(
                "按型 LoRA 节点须运行在漫影 ComfyUI 引擎内(缺 comfy 运行库)") from exc

        applied = []
        for ent in entries:
            name = str(ent.get("file", ""))
            strength = float(ent.get("strength_model", 1.0))
            if not name or strength == 0.0:
                continue
            path = folder_paths.get_full_path("loras", name)
            if path is None:
                raise RuntimeError(
                    f"按型 LoRA 文件未找到:{name}(型={base});"
                    "请检查模型目录或真源家 daojie_loras.json(daojie_ink_guofeng/json/)")
            lora = comfy.utils.load_torch_file(path, safe_load=True)
            model = comfy.sd.load_lora_for_models(model, None, lora, strength, 0.0)[0]
            applied.append(f"{Path(name).stem}×{strength:g}")
        return (model, f"{base}:" + (" + ".join(applied) if applied else "无(直通)"))
