# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫设定卡合成器单测(1113 道劫正册化)。

两门:
① 占位合成+几何互斥(恒跑):18 格色块占位 → 尺寸/模式/格不重叠不越界;
② 金样等价(步产物在位才跑,apps/output=gitignore 本地产物区):9 步真产物经
   derive_cells+extract_palette+compose 逐字节 == 格式一 v1 金样
   419639ab…(节点件=单真源,薄壳/管线/本测同一条代码路,防几何漂移金锚)。
"""
from __future__ import annotations

import hashlib
import importlib.util
import pathlib

import pytest
from PIL import Image

_TESTS = pathlib.Path(__file__).resolve().parent
_NODE_SRC = _TESTS.parent / "my_nodes/nodes/my_sheet_card_composer.py"
_spec = importlib.util.spec_from_file_location("my_sheet_card_frame_test", _NODE_SRC)
frame = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(frame)

STEPS_DIR = (_TESTS.parents[3] / "apps/output/daojie-sheet-b-1112-arch1113"
               if (_TESTS.parents[3] / "apps/output/daojie-sheet-b-1112-arch1113").is_dir()
               else _TESTS.parents[3] / "apps/output/daojie-sheet-b-1112")
# 金样 e6221c36 的产源步图住归档夹(1113 复测重掷顶位后指针随迁;两处皆无=skip)
GOLDEN_SHA = "e6221c367a02890c597c96aceb25fdc6ffdabd6d8d4578513532557d275394db"  # v1.1 净空三视图重掷(1113 用户勘背景/机位);金样重对


def test_placeholder_compose(tmp_path):
    cells = {k: Image.new("RGB", (900, 600),
                          (i * 13 % 255, i * 29 % 255, i * 47 % 255))
             for i, k in enumerate(frame.CELL_KEYS)}
    dst = tmp_path / "card.png"
    frame.compose(cells, [(200, 60, 60)] * 5, "自检", str(dst))
    im = Image.open(dst)
    assert im.size == (frame.W, frame.H) and im.mode == "RGB", (im.size, im.mode)


def test_geometry_non_overlap():
    geo = frame.layout()
    rects = [(k, geo[k]) for k in frame.CELL_KEYS]
    for k, (x0, y0, x1, y1) in rects:
        assert 0 <= x0 < x1 <= frame.W and 0 <= y0 < y1 <= frame.H, k
        assert x1 - x0 >= 100 and y1 - y0 >= 100, (k, x1 - x0, y1 - y0)
    for i, (k1, r1) in enumerate(rects):
        for k2, r2 in rects[i + 1:]:
            ox = max(0, min(r1[2], r2[2]) - max(r1[0], r2[0]))
            oy = max(0, min(r1[3], r2[3]) - max(r1[1], r2[1]))
            assert ox == 0 or oy == 0, f"格重叠 {k1}×{k2}"


def test_node_registered_in_package():
    """注册面=my_nodes/__init__.py 三处(imports/类映射/分类名)。"""
    src = (_TESTS.parent / "my_nodes" / "__init__.py").read_text(encoding="utf-8")
    assert "from .nodes.my_sheet_card_composer import MySheetCardComposer" in src
    assert '"MySheetCardComposer": MySheetCardComposer,' in src
    assert '"MySheetCardComposer": "道劫·设定卡合成器",' in src


def test_golden_equivalence(tmp_path):
    steps = {p.stem.split("_", 2)[2]: p for p in STEPS_DIR.glob("step_*.png")}
    need = {"master", "side", "back", "face", "head", "wrist", "waist",
            "weapon", "effect"}
    if not need <= set(steps):
        pytest.skip("金样步产物不在位(apps/output=gitignore 本地产物区)")
    imgs = {k: Image.open(v) for k, v in steps.items() if k in need}
    cells = frame.derive_cells(imgs)
    m = cells["front"]
    pal_src = m.crop((round(m.width * 0.32), 0,
                      round(m.width * 0.68), m.height))
    dst = tmp_path / "card.png"
    frame.compose(cells, frame.extract_palette(pal_src), "沈孤鸿", str(dst))
    sha = hashlib.sha256(dst.read_bytes()).hexdigest()
    assert sha == GOLDEN_SHA, \
        f"金样漂移:{sha}(几何/分格/字体任一改动须显式升版+金样重对)"
