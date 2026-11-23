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
GOLDEN_SHA = "c9677a63de250c25068bbd547fedf14e898c0dec0a2681299415d3eae5f5a691"  # v6+底带收高108(1114 用户令;金样重对;老 e6221c36=v1.1 档随役存档)


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
    assert full["rects"]["_palette"] == (36, 2016, 3804, 2124)   # v6 底带收高108(1114 令)
    assert full["rects"]["exp_1"] == (36, 1006, 773, 1226)      # 表情条首格
    assert full["rects"]["weapon"] == (36, 1246, 1519, 1681)    # 底区(收高后 r4=750)
    assert full["rects"]["fx_2"] == (3061, 1631, 3804, 1996)
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


# ── 1123 Phase 6:角标变体+留空格随武器类别(全卡版式跟随武器类别)────────────────
VARIANT_KEYS = ("weapon_a", "weapon_b", "gear_1", "fabric_3")
NO_ABILITY = {"通用": "通用·能力未设定", "包裹": "包裹·能力未设定"}   # 无「能力:」字段时的细化类别


def _placeholder_cells():
    return {k: Image.new("RGB", (900, 600), (i * 13 % 255, i * 29 % 255, i * 47 % 255))
            for i, k in enumerate(frame.CELL_KEYS)}


def test_label_variants_and_blank_cells_registered_and_inherited():
    """真源 labels:两类本体(通用/包裹)各四角标变体;细化类别另加 fx_1「能力未设定」并登记特效两格留空;
    均为既有格键;四格式继承同一份。"""
    tp = sf.truth_path()
    if tp is None:
        pytest.skip("真源缺位:variants 半边无意义")
    lab = sf.resolve("全卡")["labels"]
    assert set(lab["variants"]) == {"通用", "包裹", *NO_ABILITY.values()}
    for base, refined in NO_ABILITY.items():
        four = lab["variants"][base]
        assert set(four) == set(VARIANT_KEYS)
        assert lab["variants"][refined] == {**four, "fx_1": "能力未设定"}
        assert {"fx_1", "fx_2"} <= set(lab["blank_cells"][refined]) and base not in lab["blank_cells"]
    assert lab["variants"]["包裹"]["fabric_3"] == "腕部图·局部"
    for fmt in sf.formats_list():
        got = sf.resolve(fmt)["labels"]
        assert got["variants"] == lab["variants"] and got["blank_cells"] == lab["blank_cells"], fmt


@pytest.mark.parametrize("category,changed", [
    ("通用", VARIANT_KEYS),
    ("包裹", VARIANT_KEYS),
    # 能力未设定:特效两格由程序留空(不吃传入的 effect 图),fx_1 角标换字
    ("通用·能力未设定", VARIANT_KEYS + ("fx_1", "fx_2")),
    ("包裹·能力未设定", VARIANT_KEYS + ("fx_1", "fx_2")),
])
def test_compose_category_changes_only_registered_cells(tmp_path, category, changed):
    """类别渲染:与默认渲染的差异只落在换角标/留空的格内(几何/其余格/底带逐字节不变)。"""
    from PIL import ImageChops, ImageDraw
    cells, palette = _placeholder_cells(), [(200, 60, 60)] * 5
    a, b = tmp_path / "a.png", tmp_path / "b.png"
    frame.compose(cells, palette, "自检", str(a))
    frame.compose(cells, palette, "自检", str(b), weapon_category=category)
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    geo = frame.layout("全卡")
    for k in changed:
        assert ImageChops.difference(ia.crop(geo[k]), ib.crop(geo[k])).getbbox(), k
    mask = Image.new("L", ia.size, 0)
    d = ImageDraw.Draw(mask)
    for k in changed:
        d.rectangle(geo[k], fill=255)
    outside = ImageChops.multiply(ImageChops.difference(ia, ib).convert("L"),
                                  ImageChops.invert(mask))
    assert outside.getbbox() is None, "登记之外的格出现像素差异"


def test_compose_blank_cells_are_plain_paper(tmp_path):
    """能力未设定:特效两格=纸面底色+框线+角标(不吃传入的 effect 图);本体类别不留空。"""
    import numpy as np
    cells, palette = _placeholder_cells(), [(200, 60, 60)] * 5
    geo, paper = frame.layout("全卡"), tuple(frame._bg_color("纯白"))
    blank, filled = tmp_path / "blank.png", tmp_path / "filled.png"
    frame.compose(cells, palette, "自检", str(blank), weapon_category="包裹·能力未设定")
    frame.compose(cells, palette, "自检", str(filled), weapon_category="包裹")
    ib, ifl = Image.open(blank).convert("RGB"), Image.open(filled).convert("RGB")
    for k in ("fx_1", "fx_2"):
        x0, y0, x1, y1 = geo[k]
        crop = np.asarray(ib.crop((x0 + 6, y0 + 90, x1 - 6, y1 - 6)))    # 避开框线与顶部角标带
        assert {tuple(int(v) for v in px) for px in crop.reshape(-1, 3)} == {paper}, k
        assert ifl.getpixel((x0 + 40, y0 + 120)) != paper, k              # 有能力字段=正常贴图


def test_compose_default_and_unknown_category_are_identical(tmp_path):
    """空串/未登记类别=默认角标(与不传逐字节相同)。"""
    cells, palette = _placeholder_cells(), [(200, 60, 60)] * 5
    outs = []
    for i, cat in enumerate(("", "剑", "不存在")):
        dst = tmp_path / f"{i}.png"
        frame.compose(cells, palette, "自检", str(dst), weapon_category=cat)
        outs.append(dst.read_bytes())
    assert outs[0] == outs[1] == outs[2]
    text = sf.resolve("全卡")["labels"]["text"]
    assert text["weapon_a"] == "局部·柄首" and text["fabric_3"] == "材质·护臂"


def test_composer_input_types_has_optional_category():
    """节点输入:『武器类别』为 optional STRING,缺省空串,排在『档案』之后(=widget 承载序)。"""
    opt = frame.MySheetCardComposer.INPUT_TYPES()["optional"]
    assert opt["武器类别"] == ("STRING", {"default": "", "multiline": False})
    assert list(opt)[-2:] == ["档案", "武器类别"]
