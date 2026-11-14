# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫设定卡合成器单测(1113 道劫正册化;1114 格式注册表数据驱动化)。

三门:
① 占位合成+几何互斥(恒跑):19 键色块占位 → 尺寸/模式/格不重叠不越界;
② 金样等价(步产物在位才跑,apps/output=gitignore 本地产物区):9 步真产物经
   derive_cells+extract_palette+compose 逐字节 == v6 金样(Skill-5.4 正名+底带
   档案栏重对;节点件=单真源,薄壳/管线/本测同一条代码路,防几何漂移金锚);
③ 格式注册表快照(1114):书写序(全卡恒首键=缺省档契约)+四格式 rects/键序/
   modes 锁内嵌 _FROZEN 冻结期望+真源在位时 truth.formats==快照(双源漂移即红)。
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

_SF_SRC = _TESTS.parent / "my_nodes/nodes/sheet_card_formats.py"
_sf_spec = importlib.util.spec_from_file_location("sheet_card_formats_test", _SF_SRC)
sf = importlib.util.module_from_spec(_sf_spec)
_sf_spec.loader.exec_module(sf)

STEPS_DIR = (_TESTS.parents[3] / "apps/output/daojie-sheet-b-1112-arch1113"
               if (_TESTS.parents[3] / "apps/output/daojie-sheet-b-1112-arch1113").is_dir()
               else _TESTS.parents[3] / "apps/output/daojie-sheet-b-1112")
# 金样 e6221c36 的产源步图住归档夹(1113 复测重掷顶位后指针随迁;两处皆无=skip)
GOLDEN_SHA = "897469792ad2c6d3ada9a050a0ef86ccef4869897235445dd7ec6fc6b2622a48"  # v6+表情条+材质/装备逐格命名+无装备档(1114 金样重对;老 e6221c36=v1.1 档随役存档)


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


def test_formats_registry_snapshot():
    """1114 格式注册表快照:书写序+四格式几何/键序/modes 锁内嵌 _FROZEN 冻结期望。

    『全卡』恒首键=INPUT_TYPES 缺省档契约(新增格式只能尾部追加);真源在位时
    truth.formats==_FROZEN(双源漂移即红)——快照等价半边在缺位环境无意义,skip。
    """
    # ① 书写序契约
    assert sf.formats_list() == ["全卡", "简版", "竖版", "无装备"]
    # ② 四格式 resolve(rects/键序/modes)锁 _FROZEN 冻结期望(与环境真源解耦)
    for fmt in sf.formats_list():
        got, want = sf.resolve(fmt), sf._resolve(sf._FROZEN, fmt)
        assert got["rects"] == want["rects"], fmt
        assert got["modes"] == want["modes"], fmt
        assert got["labels"] == want["labels"], fmt
        assert got["canvas"] == want["canvas"], fmt
        assert tuple(k for k in got["rects"] if k != "_palette") \
            == frame.CELL_KEYS_BY_FMT[fmt], fmt
    # ③ 字面锚(防 _FROZEN 与解释器一起漂):全卡几何 v6 档(底带通栏)恒等
    full = sf.resolve("全卡")
    assert full["canvas"] == (3840, 2160) and full["margin"] == 36 and full["gutter"] == 20
    assert full["rects"]["front"] == (36, 36, 717, 986)     # v6+表情条档(r1=950)
    assert full["rects"]["_palette"] == (36, 1974, 3804, 2124)   # v6 底部通栏信息带
    assert full["rects"]["exp_1"] == (36, 1006, 773, 1226)      # 表情条首格
    assert full["rects"]["weapon"] == (36, 1246, 1519, 1657)    # 底区下移
    assert full["rects"]["fx_2"] == (3061, 1610, 3804, 1954)
    assert {k for k, m in full["modes"].items() if m == "contain"} \
        == {"front", "side", "back", "weapon", "eye", "gear_1", "gear_2"}
    assert len(full["labels"]["text"]) == 23 and full["labels"]["size"] == 36  # 15+表情5+材质/装备逐格名3
    assert len(sf.resolve("简版")["rects"]) == 10            # 9 格+_palette
    assert len(sf.resolve("无装备")["rects"]) == 20           # 19 格+_palette(武器/装备区全撤)
    # ④ 真源在位时:truth.formats == 内嵌快照(双源漂移即红)
    tp = sf.truth_path()
    if tp is None:
        pytest.skip("真源缺位(候选链全无 qi21_bases.json):快照等价半边无意义;"
                    "当前 resolve 走内嵌 _FROZEN 回退,见 load_formats 分级兜底")
    import json
    truth_reg = json.loads(tp.read_text(encoding="utf-8"))["sheet_card_qwen"]["formats"]
    assert truth_reg == sf._FROZEN, \
        f"真源与 _FROZEN 漂移:{tp}(请跑 apps/build/scripts/daojie_sheet_formats_freeze.py 再生)"
