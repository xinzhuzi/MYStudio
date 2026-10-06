# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 真源文本输出器(MyQi21BasesText,1006 API版PE三轮·全上下文节点化)。

用户令:系统提示词/色卡/美术风格底座在子图里**必须是可见节点**,连线进 API版PE
[4013]。本件=真源只读出口:下拉选节,从 qi21_bases.json 热读(mtime 失效缓存)
输出 STRING——画布零复制(集中地令:提示词只有 json 一份),改 json 即时生效
免重启,节点无需任何参数框。

三节:
  系统提示词   = expand_instruction.system_prompt_zh(扩写教材,935字级)
  色卡         = color_lexicon.entries 格式化(词+ma_id+用途)前缀职责预算两行
  美术风格底座 = lock_layer.positive_text(锁层A全文)

注册(import+NODE_CLASS_MAPPINGS+DISPLAY「漫影 真源文本」)在
my_nodes/__init__.py,本文件不自带注册。

1006 批A(问题1「三真源节点不展示内容」,决议 Q3=执行回填):OUTPUT_NODE+
ui 载荷 {"bases_text":[全文]}——JS(my-qi21-prompt-preview.js 第三注册)
onExecuted 把 bases_text[0] 回填节点上 optional「内容」multiline 展示框
(展示槽必须 optional:required 会被 /prompt 验证层 400,在案);展示框值
不参与计算,改 qi21_bases.json 重跑即刷新(热读),会话内不清旧值(Q4)。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# ── 数据真源四层候选链(与 my_qi21_base 同款,零 import——勿 import 化禁令) ──
def _daojie_data(fn: str) -> Path:
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

SECTIONS = ("系统提示词", "色卡", "美术风格底座")

_cache: dict = {"mtime": None, "data": None}


def _load_data() -> dict:
    try:
        mtime = _BASES_JSON.stat().st_mtime
    except OSError:
        mtime = None
    if mtime is not None and _cache["mtime"] == mtime and _cache["data"] is not None:
        return _cache["data"]
    try:
        data = json.loads(_BASES_JSON.read_text(encoding="utf-8"))
        data = data if isinstance(data, dict) else {}
    except (OSError, ValueError) as exc:
        print(f"[漫影 真源文本] qi21_bases.json 读取失败({exc})——输出空串,请同步自研节点")
        data = {}
    _cache.update(mtime=mtime, data=data)
    return data


def _section_text(section: str) -> str:
    data = _load_data()
    if section == "系统提示词":
        raw = (data.get("expand_instruction") or {}).get("system_prompt_zh")
        return str(raw).strip() if isinstance(raw, str) else ""
    if section == "美术风格底座":
        raw = (data.get("lock_layer") or {}).get("positive_text")
        return str(raw).strip() if isinstance(raw, str) else ""
    if section == "色卡":
        lines = ["大面积基底=淡墨;主体色=石青/青绿/赭石;点睛(accent)只落一个叙事焦点=旧金或朱红(仅来源事实存在时)",
                 "色词必须落到实物载体(部件/材质/布面),禁落光效特效;禁裸色词(色+材质组合,如「石青丝绦」)"]
        for word, ent in sorted((data.get("color_lexicon") or {}).get("entries", {}).items()):
            if isinstance(ent, dict):
                lines.append(f"{word}({ent.get('ma_id', '')}):{ent.get('usage_hint', '')}")
        return "\n".join(lines) if len(lines) > 2 else ""
    return ""


class MyQi21BasesText:
    """漫影 真源文本:qi21_bases.json 三节只读出口(系统提示词/色卡/美术风格底座)。"""

    CATEGORY = "漫影"
    DESCRIPTION = ("真源文本:下拉选节从 qi21_bases.json 热读输出(画布零复制,改 json "
                   "即时生效);1006 API版PE全上下文节点化的上下文源")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "文本节": (list(SECTIONS), {"default": "系统提示词",
                                            "tooltip": "真源节:系统提示词=扩写教材/色卡=在用词表+落点纪律/美术风格底座=锁层A全文"}),
            },
            # 1006 批A 展示槽(必 optional:required 会被 /prompt 验证层 400,在案)
            "optional": {
                "内容": ("STRING", {"multiline": True,
                                    "tooltip": "展示框:真源节全文(执行后 JS 自动回填,不参与计算)"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("文本",)
    FUNCTION = "output"
    # 1006 批A(问题1):OUTPUT_NODE+ui 载荷 bases_text——JS 把真源全文回填
    # 「内容」展示框,画布上直接看 935字教材/色卡词表/739字锁层A
    OUTPUT_NODE = True

    def output(self, 文本节: str, 内容: str = "") -> dict:
        text = _section_text(文本节 if 文本节 in SECTIONS else "系统提示词")
        _ = 内容  # 展示框值不参与计算(JS 回填;签名收下防 unexpected-keyword)
        if not text:
            print(f"[漫影 真源文本] 「{文本节}」节为空——请检查 qi21_bases.json 对应节")
        return {"ui": {"bases_text": [text]}, "result": (text,)}
