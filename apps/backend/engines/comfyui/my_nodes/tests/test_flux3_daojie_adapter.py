"""FLUX.3 道劫 RGB 适配器的独立契约测试。"""

import json
from pathlib import Path

from engines.comfyui.my_nodes.nodes.my_flux3_daojie_adapter import MyFlux3DaojieAdapter


_BASES_JSON = (
    Path(__file__).resolve().parents[6]
    / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
)


def test_adapter_preserves_setting_card_layout_while_projecting_rgba_canvas():
    source = (
        "卡面另留窄条档案区与色样区，各分区边界清晰，排版疏朗有呼吸，"
        "卡面为带透明通道的透明底，各分区外无背景景物与底色。"
    )

    text, width, height, transparent = MyFlux3DaojieAdapter().adapt(source, 1088, 1448)

    assert "窄条档案区与色样区" in text
    assert "各分区边界清晰" in text
    assert "卡面各分区共用简洁底色" in text
    assert "透明通道" not in text
    assert width == 1088
    assert height == 1440
    assert transparent is False


def test_adapter_projects_tool_background_rule_without_erasing_the_object():
    source = "器物可见范围完整入画并居中。透明底时主体以外为透明区域；关闭透明时背景采用主体句指定的简洁底色。"

    text, width, height, transparent = MyFlux3DaojieAdapter().adapt(source, 1024, 1024)

    assert "器物可见范围完整入画并居中" in text
    assert "主体以外采用简洁底色" in text
    assert "透明区域" not in text
    assert (width, height, transparent) == (1024, 1024, False)


def test_adapter_rejects_invalid_dimensions():
    adapter = MyFlux3DaojieAdapter()

    for width, height in ((0, 1024), (1024, 0), (True, 1024), (1024, "1024")):
        try:
            adapter.adapt("人物设定", width, height)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected invalid dimensions to fail: {(width, height)!r}")


def test_adapter_projects_every_real_type_without_losing_its_distinguishing_layout():
    types = json.loads(_BASES_JSON.read_text(encoding="utf-8"))["types"]
    expected_facts = {
        "人物": "主体的单人立绘",
        "场景": "前景、中景、远景三层分明",
        "道具": "器物可见范围完整入画并居中",
        "美宣": "叙事美宣画面",
        "人物多视图": "四视图设定图",
        "高清人脸": "正面头肩特写素材",
        "分镜剧情图": "一幅单格叙事画面",
        "表情差分": "九宫格脸部表情差分表",
        "概念气氛图": "以气氛为主的画面",
        "设定卡": "固定六个图像区",
    }
    adapter = MyFlux3DaojieAdapter()

    assert [item["zh"] for item in types if item["zh"] != "自由"] == list(expected_facts)
    for item in types:
        if item["zh"] == "自由":
            continue
        text, width, height, transparent = adapter.adapt(item["positive_text"], 1664, 944)
        assert expected_facts[item["zh"]] in text
        assert not any(marker in text for marker in ("透明通道", "背景透明", "透明底", "透明区域"))
        assert (width, height, transparent) == (1664, 944, False)
