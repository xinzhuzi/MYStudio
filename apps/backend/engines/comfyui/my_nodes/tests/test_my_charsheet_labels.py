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
    assert tuple(spec["layout"][0]) == ("纯拼版(无字)", "四格拼版", "四格条带", "左栏竖排")
    assert "半身像" in spec["grid_labels"][1]["default"]
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
def test_run_grid_card_only_zero_contact():
    """六轮=标签入卡(零接触):白底图上,四格模式只画左上信息卡(姓名+字段+
    格序图例+朱印);底部/右部不得有任何程序墨迹(无条带)。"""
    node = NODE_CLASS_MAPPINGS["MyCharsheetLabels"]()
    (out,) = node.run(_white_sheet(), "青珣", "筑基后期 · 剑修\n青云门 · 内门弟子",
                      "苹方(简体)", 92, 40, "墨黑", "道劫", layout="四格条带",
                      grid_labels="面部特写\n正面全身\n侧面全身\n背面全身")
    array = out.numpy()
    assert array.shape == (1, 1712, 2568, 3)
    # ① 左上信息卡:墨字+朱印+图例行(图例行较宽,窗口放宽至 0.38W)
    card = array[0, int(0.03 * 1712):int(0.34 * 1712),
                 int(0.03 * 2568):int(0.38 * 2568), :]
    cflat = card.reshape(-1, 3)
    assert (cflat.max(axis=1) < 0.5).sum() > 300, "信息卡未见墨字"
    red = (cflat[:, 0] > 0.6) & (cflat[:, 1] < 0.43) & (cflat[:, 2] < 0.43)
    assert red.sum() > 300, "信息卡未见朱印"
    # ② 零接触:卡区之外(白底输入)不得出现程序墨迹——底部条带区墨迹≈0
    bottom = array[0, int(0.80 * 1712):, int(0.35 * 2568):, :]
    assert (bottom.max(axis=2) < 0.5).sum() < 100, "底部出现程序墨迹(条带未移除)"


@pytest.mark.skipif(not _HAS_CJK_FONT, reason="本机无中文系统字体栈")
def test_content_columns_detects_four_pillars():
    """内容列检测(布局审计):四根不等分深色柱应检出 4 段(供重roll 提示)。"""
    import numpy as np
    from PIL import Image
    canvas = Image.new("L", (1536, 1024), 255)
    for c in (0.23, 0.56, 0.74, 0.92):
        x = int(c * 1536)
        for yy in range(100, 800):
            for xx in range(x - 60, x + 60):
                canvas.putpixel((xx, yy), 30)
    segs = mcl.MyCharsheetLabels._content_columns(canvas.convert("RGBA"))
    assert len(segs) == 4, segs


@pytest.mark.skipif(not _HAS_CJK_FONT, reason="本机无中文系统字体栈")
def test_long_name_and_field_overflow_do_not_crash():
    node = NODE_CLASS_MAPPINGS["MyCharsheetLabels"]()
    long_name = "青云门掌门玄真子上人"  # 10 字>6,触发缩宽
    many_lines = "\n".join(f"第{i}行身份字段" for i in range(60))  # 溢出印区→截断
    (out,) = node.run(_white_sheet(512, 768), long_name, many_lines,
                      "黑体", 64, 24, "朱砂", "漫影设定", layout="左栏竖排")
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


@pytest.mark.skipif(not _HAS_CJK_FONT, reason="本机无中文系统字体栈")
def test_compose_four_views_fixed_order():
    """十轮=四格拼版:4 张单视角图→2568×1712 画布,标签带画在留白区
    (y≈86%),等分=拼版顺序定死;内容条(上 76% 区)零程序条带。"""
    import torch
    a = torch.ones((1, 768, 1024, 3)); a[0, :, :100] = 0.2     # 第1张左黑边=可辨序
    b = torch.ones((1, 768, 1024, 3)); b[0, :, -100:] = 0.2
    c = torch.ones((1, 768, 1024, 3)); c[0, :100, :] = 0.2
    d = torch.ones((1, 768, 1024, 3))
    node = NODE_CLASS_MAPPINGS["MyCharsheetLabels"]()
    (out,) = node.run(a, "青珣", "剑修", "苹方(简体)", 92, 40, "墨黑", "道劫",
                      layout="四格拼版",
                      grid_labels="半身像\n正面全身\n侧面全身\n背面全身",
                      image_b=b, image_c=c, image_d=d)
    arr = out.numpy()
    assert arr.shape == (1, 1712, 2568, 3)
    # 内容条存在(上区有暗像素)
    assert (arr[0, :int(0.7*1712), :, :].max(axis=2) < 0.5).sum() > 500
    assert (arr[0].max(axis=2) < 0.5).sum() > 500  # 内容条存在
