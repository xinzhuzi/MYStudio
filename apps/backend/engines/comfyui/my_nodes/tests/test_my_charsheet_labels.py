# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyCharsheetLabels 契约测试(09-20 设定表汉字程序叠加,案一)。

锁:INPUT_TYPES 形状(combo 双值序+默认姓名/字段)+注册 CATEGORY=My;
端到端(白底 2K tensor→run)形状保持 RGBA→RGB 三通/左栏出现墨色像素/
印区出现朱砂像素;长姓名(>6 字)缩宽不炸;字段溢出印区截断不炸;
字体栈回退链按本机 macOS 系统字体探测(skipif 全缺)。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS
from engines.comfyui.my_nodes.nodes import my_charsheet_labels as mcl

_HAS_CJK_FONT = any(
    Path(p).is_file()
    for stack in mcl.FONT_STACKS.values()
    for entry in stack
    for p in (entry[0]() if callable(entry[0]) else [entry[0]]))


def _white_sheet(h: int = 1712, w: int = 2568):
    import torch
    return torch.ones((1, h, w, 3), dtype=torch.float32)


def test_input_types_shape_and_registry():
    node = NODE_CLASS_MAPPINGS["MyCharsheetLabels"]
    assert node is mcl.MyCharsheetLabels
    assert node.CATEGORY == "my"
    spec = node.INPUT_TYPES()["required"]
    assert spec["image"] == ("IMAGE",)
    assert tuple(spec["font"][0]) == ("苹方(简体)", "宋体", "黑体")  # 09-20 二轮:苹方=大陆规范字形默认
    assert tuple(spec["ink"][0]) == ("墨黑", "朱砂")
    assert spec["name"][1]["default"] == "青珣"
    assert "筑基后期" in spec["fields"][1]["default"]
    assert spec["name_size"][1]["default"] == 92
    assert spec["seal_text"][1]["default"] == "道劫"
    assert tuple(spec["layout"][0]) == ("四格条带", "左栏竖排")  # 09-20 三轮:四视图版式默认
    assert "正面全身" in spec["grid_labels"][1]["default"]
    assert node.RETURN_TYPES == ("IMAGE",)
    assert node.RETURN_NAMES == ("image",)


@pytest.mark.skipif(not _HAS_CJK_FONT, reason="本机无中文系统字体栈")
def test_run_overlays_ink_and_seal_on_2k_sheet():
    node = NODE_CLASS_MAPPINGS["MyCharsheetLabels"]()
    (out,) = node.run(_white_sheet(), "青珣", "筑基后期 · 剑修\n青云门 · 内门弟子",
                      "苹方(简体)", 92, 40, "墨黑", "道劫", layout="左栏竖排")
    array = out.numpy()
    assert array.shape == (1, 1712, 2568, 3)

    def darkest(region):  # tensor 0-1 口径:墨(38,34,30)叠白底≈0.19
        return region.reshape(-1, 3).min(axis=0)

    # 左栏姓名/字段区(x 4%~24%)出现墨色(最暗行亮度显著低于白底 1.0)
    column = array[0, :, int(0.04 * 2568):int(0.24 * 2568), :]
    assert darkest(column).max() < 0.5
    # 印区(y 74%~86%,x 4%~24%)出现朱砂(红通道显著高于绿蓝,0-1 口径)
    seal = array[0, int(0.74 * 1712):int(0.86 * 1712),
                 int(0.04 * 2568):int(0.24 * 2568), :]
    flat = seal.reshape(-1, 3)
    red_mask = (flat[:, 0] > 0.6) & (flat[:, 1] < 0.43) & (flat[:, 2] < 0.43)
    assert red_mask.sum() > 500, "印区未见朱砂像素"


@pytest.mark.skipif(not _HAS_CJK_FONT, reason="本机无中文系统字体栈")
def test_run_grid_bands_and_card_on_4view_sheet():
    """四格条带版式(09-20 三轮默认):底部四条纸色标签带+左上角色小卡+小朱印。"""
    node = NODE_CLASS_MAPPINGS["MyCharsheetLabels"]()
    (out,) = node.run(_white_sheet(), "青珣", "筑基后期 · 剑修\n青云门 · 内门弟子",
                      "苹方(简体)", 92, 40, "墨黑", "道劫", layout="四格条带",
                      grid_labels="正面全身\n侧面全身\n背面全身\n面部特写")
    array = out.numpy()
    assert array.shape == (1, 1712, 2568, 3)
    # ① 底部条带区(y 88%~97%):四段纸色带(≈(247,243,235)/255≈0.96)与墨字并存
    bands = array[0, int(0.88 * 1712):int(0.97 * 1712), :, :]
    flat = bands.reshape(-1, 3)
    paper_mask = (flat[:, 0] > 0.90) & (flat[:, 1] > 0.88) & (abs(flat[:, 0] - flat[:, 2]) < 0.08)
    ink_mask = flat.max(axis=1) < 0.5
    assert paper_mask.sum() > 20000, "底部未见纸色条带"
    assert ink_mask.sum() > 500, "条带内未见墨字"
    # ② 左上小卡区(x 3%~25%,y 3%~30%):卡底+墨字+朱印
    card = array[0, int(0.03 * 1712):int(0.30 * 1712),
                 int(0.03 * 2568):int(0.25 * 2568), :]
    cflat = card.reshape(-1, 3)
    assert (cflat.max(axis=1) < 0.5).sum() > 300, "小卡未见墨字"
    red = (cflat[:, 0] > 0.6) & (cflat[:, 1] < 0.43) & (cflat[:, 2] < 0.43)
    assert red.sum() > 300, "小卡未见朱印"


@pytest.mark.skipif(not _HAS_CJK_FONT, reason="本机无中文系统字体栈")
def test_long_name_and_field_overflow_do_not_crash():
    node = NODE_CLASS_MAPPINGS["MyCharsheetLabels"]()
    long_name = "青云门掌门玄真子上人"  # 10 字>6,触发缩宽
    many_lines = "\n".join(f"第{i}行身份字段" for i in range(60))  # 溢出印区→截断
    (out,) = node.run(_white_sheet(512, 768), long_name, many_lines,
                      "黑体", 64, 24, "朱砂", "漫影设定")
    assert out.numpy().shape == (1, 512, 768, 3)


def test_font_fallback_never_raises(monkeypatch):
    # size≤0 边界→load_default 兜底
    assert mcl._load_font("宋体", 0, bold=True) is not None
    # 栈全缺(含探测函数返回空)→load_default 兜底(不可中文但不炸)
    monkeypatch.setattr(mcl, "FONT_STACKS",
                        {"宋体": [("/不存在/none.ttc", 0, 0)],
                         "苹方(简体)": [(lambda: [], 11, 3)]})
    assert mcl._load_font("宋体", 40, bold=False) is not None
    assert mcl._load_font("苹方(简体)", 40, bold=True) is not None
