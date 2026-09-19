# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫按型 LoRA 节点测试(09-19 九型驱动 LoRA)。

repo 侧(无引擎)只测数据面与映射纯函数:九型键与 daojie_bases.json 一比一、
条目字段完备、强度区间 sane、金雾/裁定锚在位;引擎依赖(comfy.*)在 run 内
懒加载,repo 侧触不到也不该触到。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engines.comfyui.my_nodes.nodes import my_daojie_loras  # noqa: E402
from engines.comfyui.my_nodes.nodes import my_daojie_base  # noqa: E402


def _entries():
    return json.loads(my_daojie_loras._LORAS_JSON.read_text(encoding="utf-8"))


def test_loras_json_nine_types_match_bases_exactly():
    """按型 LoRA 数据面九型与底座数据面一比一(键与顺序),[80] 选型全覆盖。"""
    bases = json.loads(my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
    assert [e["key"] for e in _entries()] == [e["key"] for e in bases]
    assert [e["zh"] for e in _entries()] == [e["zh"] for e in bases]


def test_loras_for_matches_by_zh_and_key():
    scene = my_daojie_loras.loras_for("场景")
    assert scene is not None and any("金雾" in e["file"] for e in scene)
    assert my_daojie_loras.loras_for("prop") is None  # key 不匹配(值域=zh/key)


def test_every_entry_fields_sane():
    for e in _entries():
        for item in e["loras"]:
            assert item["file"].endswith(".safetensors"), item
            assert 0 < item["strength_model"] <= 1.5, item
            assert "/" in item["file"], f"应带子目录路径: {item['file']}"


def test_ruling_anchors_present():
    """裁定锚:人物系三件(67+76+73);场景免鎏金+金雾在场。"""
    person = my_daojie_loras.loras_for("人物")
    files = [e["file"] for e in person]
    assert any("细节滑杆" in f for f in files)
    assert any("AsianMix" in f for f in files)
    assert any("鎏金" in f for f in files)
    scene_files = [e["file"] for e in my_daojie_loras.loras_for("场景")]
    assert any("金雾" in f for f in scene_files)
    assert not any("鎏金" in f for f in scene_files)  # 场景免鎏金
    assert not any("AsianMix" in f for f in scene_files)  # 空镜无面孔


def test_files_exist_in_engine_home_when_present():
    """引擎家在场时逐文件存在性;无引擎家=跳过(repo 侧测试零引擎依赖)。"""
    home = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
            / "models/loras")
    if not home.is_dir():
        return
    for e in _entries():
        for item in e["loras"]:
            assert (home / item["file"]).is_file(), \
                f"「{e['zh']}」引用的 LoRA 不在引擎家: {item['file']}"


def test_node_class_surface():
    """节点类表面:类别/返回/懒加载纪律(run 不 import 引擎库直至被调)。"""
    cls = my_daojie_loras.MyDaojieLoras
    assert cls.CATEGORY == "my"
    assert cls.RETURN_TYPES == ("MODEL", "STRING")
    assert cls.RETURN_NAMES == ("model", "applied")
    assert "base" in cls.INPUT_TYPES()["required"]
