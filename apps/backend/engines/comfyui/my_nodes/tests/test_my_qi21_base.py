# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21DaojieBase 契约测试(qi21 道劫九选一底座节点,09-23 造件;与
test_my_daojie_base.py 同目录同纪律,源码位 sidecar 零引擎依赖)。

锁:注册面(含 test_my_nodes.py 注册面全集钉)/COMBO 九项有序(=canon
daojie_bases.json zh 顺序)+默认钉死「人物」/四出形状(BASE·WIDTH·HEIGHT·
型名)/BASE 与 05 库对应型逐字一致(②美化版底座+人物系增量四锁B+④配色行,
锚从库运行时切出、零硬编码;①槽与常量A 不在 BASE 内——工作流恒挂层承担)/
W/H 与 K2 MyDaojieBase 同型同参输出一比一(含三视图 override 3072×1024 直出;
公式=MP 按 1024² 计、边长取整 8 倍数)/数据文件 schema(aspect/MP/override
与 canon 逐字镜像)/未知型与库缺失中文 RuntimeError/mtime 失效热改。
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes import my_qi21_base
from engines.comfyui.my_nodes.nodes.my_daojie_base import ASPECTS, MyDaojieBase, native_px
from engines.comfyui.my_nodes.nodes.my_qi21_base import MyQi21DaojieBase

# 仓库根:my_nodes/tests/test_x.py → parents[6]=仓库根(apps 的上一级)
REPO = Path(__file__).resolve().parents[6]
LIB_MD = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
CANON_BASES = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes"
               / "daojie_bases.json")

# 人物系六型(base_text 含常量B 增量四锁;与 05 库生成器 daojie_canon_lib.py 同表)
RENWU_XI = {"人物", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分"}


@pytest.fixture(autouse=True)
def _reset_bases_cache():
    """测试间清模块级缓存,免 monkeypatch 改 _BASES_JSON 后读到旧缓存。"""
    my_qi21_base._bases_cache.update(mtime=None, entries=None)
    yield
    my_qi21_base._bases_cache.update(mtime=None, entries=None)


def _canon_order() -> list:
    return [e["zh"] for e in json.loads(CANON_BASES.read_text(encoding="utf-8"))]


def _lib_doc() -> str:
    return LIB_MD.read_text(encoding="utf-8")


def _lib_const_b(doc: str) -> list:
    """库首「常量 B·人物系增量」围栏逐行(§四.4-.7 四把全员锁,提取零硬编码)。"""
    i = doc.find("**常量 B·人物系增量")
    assert i >= 0, "05 库缺常量 B 标记"
    m = re.search(r"```text\n(.*?)\n```", doc[i:], re.S)
    assert m, "05 库常量 B 缺围栏"
    return m.group(1).split("\n")


def _lib_base_text(doc: str, zh: str) -> str:
    """从 05 库运行时切出该型期望 BASE:②层+人物系增量四锁B+④配色行换行拼合。"""
    m = re.search(rf"^### {re.escape(zh)}-基础\s*$", doc, re.M)
    assert m, f"05 库缺节: {zh}"
    nxt = re.search(r"^### ", doc[m.end():], re.M)
    seg = doc[m.end(): m.end() + nxt.start()] if nxt else doc[m.end():]
    fence = re.search(r"```text\n(.*?)\n```", seg, re.S)
    assert fence, f"{zh}: 缺装配全文围栏"
    lines = fence.group(1).split("\n")
    assert lines[0].startswith("⟨①:") and lines[0].endswith("⟩"), zh
    base, pal = lines[1], lines[-1]
    return "\n".join([base, *_lib_const_b(doc), pal] if zh in RENWU_XI else [base, pal])


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_qi21_base():
    assert NODE_CLASS_MAPPINGS.get("MyQi21DaojieBase") is MyQi21DaojieBase
    assert MyQi21DaojieBase.CATEGORY == "my"  # 类目与 K2 件(MyDaojieBase)同区
    assert NODE_DISPLAY_NAME_MAPPINGS["MyQi21DaojieBase"] == "道劫·qi21底座九选一"
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingQi21DaojieBase" not in NODE_CLASS_MAPPINGS


# ── 形状:COMBO 九项与 canon 一致且有序+默认钉死 ──────────────
def test_combo_nine_options_in_canon_order_with_pinned_default():
    spec = MyQi21DaojieBase.INPUT_TYPES()
    assert set(spec) == {"required"}  # 本节点无 optional 槽(widget 只剩选型一枚)
    assert set(spec["required"]) == {"base"}
    combo = spec["required"]["base"]
    assert isinstance(combo[0], list)
    assert combo[0] == _canon_order()  # canon zh 顺序(json 条目顺序,不 sorted)
    assert combo[1]["default"] == "人物"  # DEFAULT_BASE 钉死
    assert MyQi21DaojieBase.RETURN_TYPES == ("STRING", "INT", "INT", "STRING")
    assert MyQi21DaojieBase.RETURN_NAMES == ("BASE", "WIDTH", "HEIGHT", "型名")
    assert MyQi21DaojieBase.FUNCTION == "run"


# ── BASE:与 05 库对应型逐字一致(锚运行时切出,零硬编码)─────────
def test_base_text_verbatim_from_lib_for_all_nine():
    doc = _lib_doc()
    for zh in _canon_order():
        base_text, _w, _h, name_out = MyQi21DaojieBase().run(zh)
        assert name_out == zh  # 型名直通
        assert base_text == _lib_base_text(doc, zh), zh
        lines = base_text.split("\n")
        # 人物系=②+四锁+④共 6 行;非人物系(场景/道具/概念气氛图)=②+④共 2 行
        assert len(lines) == (6 if zh in RENWU_XI else 2), zh
        assert "=" in lines[-1], (zh, "④配色行「色名=…」形状")
        assert lines[0].endswith("。")  # ②层美化版底座句号自足收尾
        # ①槽与常量A 不在 BASE 内(工作流恒挂层承担;禁混:防 BASE 变整段装配)
        assert not base_text.startswith("⟨①:")
        assert "风格底座：现代修仙游戏" not in base_text  # 常量A §四.1 首句禁入


def test_run_all_options_produce_nonempty_outputs():
    for zh in _canon_order():
        base_text, w, h, name_out = MyQi21DaojieBase().run(zh)
        assert base_text and ("细墨线" in base_text or "运笔" in base_text)
        assert isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0


# ── W/H:与 K2 MyDaojieBase 同型同参输出一致(公式口径单源)─────
def test_width_height_match_k2_same_type_and_params():
    for zh in _canon_order():
        _b, w, h, _n = MyQi21DaojieBase().run(zh)
        _p, _neg, aspect, mp, _bn, k_w, k_h = MyDaojieBase().run(zh)
        assert (w, h) == (k_w, k_h), zh  # 同型同参(aspect/MP/override 同 canon)
        entry = my_qi21_base._entry(zh)
        if entry.get("resolution_override") is None:
            # 公式路:与 [61] 口径一致(MP 按 1024² 计,边长取整 8 倍数)
            assert (w, h) == native_px(aspect, mp), zh
            assert w % 8 == 0 and h % 8 == 0, zh
        else:
            assert (w, h) == tuple(entry["resolution_override"]), zh


def test_width_height_reference_table():
    """九型对照表(型→宽×高;防 K2 侧公式漂移时静默跟漂的独立钉)。"""
    expect = {
        "人物": (1816, 2424), "场景": (2800, 1576), "道具": (1024, 1024),
        "美宣": (3208, 1376), "三视图": (3072, 1024), "高清人脸": (1024, 1024),
        "分镜剧情图": (2800, 1576), "表情差分": (2096, 2096),
        "概念气氛图": (2800, 1576)}
    for zh, (w, h) in expect.items():
        _b, w_out, h_out, _n = MyQi21DaojieBase().run(zh)
        assert (w_out, h_out) == (w, h), (zh, w_out, h_out)


# ── 数据文件 schema:字段形状+与 canon 逐字镜像 ─────────────────
def test_data_file_schema():
    entries = json.loads(
        my_qi21_base._BASES_JSON.read_text(encoding="utf-8"))
    assert isinstance(entries, list) and len(entries) == 9
    assert [e["zh"] for e in entries] == _canon_order()  # 顺序=canon zh 顺序
    for e in entries:
        zh = e["zh"]
        assert isinstance(zh, str) and zh
        bt = e["base_text"]
        assert isinstance(bt, str) and bt
        assert len(bt.split("\n")) == (6 if zh in RENWU_XI else 2), zh
        assert e["aspect_ratio"] in ASPECTS, (zh, e["aspect_ratio"])  # 官方枚举串
        mp = e["megapixels"]
        assert (isinstance(mp, (int, float)) and not isinstance(mp, bool)
                and mp > 0), (zh, mp)
        if "resolution_override" in e:
            ov = e["resolution_override"]
            assert (isinstance(ov, list) and len(ov) == 2
                    and all(isinstance(v, int) and not isinstance(v, bool) and v > 0
                            for v in ov)), (zh, ov)


def test_aspect_megapixels_mirror_canon():
    """画幅档与 canon(daojie_bases.json)逐字镜像(aspect/MP/override 三字段)。"""
    canon = {e["zh"]: e for e in json.loads(CANON_BASES.read_text(encoding="utf-8"))}
    for e in json.loads(
            my_qi21_base._BASES_JSON.read_text(encoding="utf-8")):
        c = canon[e["zh"]]
        assert e["aspect_ratio"] == c["aspect_ratio"], e["zh"]
        assert e["megapixels"] == c["megapixels"], e["zh"]
        assert e.get("resolution_override") == c.get("resolution_override"), e["zh"]


# ── 热改:mtime 失效(json 文案改=下次 run 即新文)───────────
def test_json_mtime_invalidation_hot_edit(tmp_path, monkeypatch, capsys):
    fake = tmp_path / "qi21_bases.json"
    fake.write_text(json.dumps([
        {"zh": "测试型", "base_text": "测试底座"}], ensure_ascii=False),
        encoding="utf-8")
    monkeypatch.setattr(my_qi21_base, "_BASES_JSON", fake)
    assert my_qi21_base.bases_list() == ["测试型"]
    bt, w, h, name = MyQi21DaojieBase().run("测试型")
    assert bt == "测试底座" and name == "测试型"
    # 缺分辨率字段:回退 1:1 (Square)/4.2(与 K2 单源)+控制台中文警告
    assert (w, h) == native_px("1:1 (Square)", 4.2) == (2096, 2096)
    out = capsys.readouterr().out
    assert "缺 aspect_ratio 字段" in out and "缺 megapixels 字段" in out
    assert "回退" in out
    # 热改:同路径改内容+推 mtime(免文件系统时间粒度),现读即生效
    entries = json.loads(fake.read_text(encoding="utf-8"))
    entries[0]["base_text"] = "热改后的底座"
    fake.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    stat = fake.stat()
    time.sleep(0.01)
    import os
    os.utime(fake, (stat.st_atime + 5, stat.st_mtime + 5))
    bt2, _w2, _h2, _n2 = MyQi21DaojieBase().run("测试型")
    assert bt2 == "热改后的底座"


def test_is_changed_tracks_json_mtime_signature():
    sig1 = MyQi21DaojieBase.IS_CHANGED("人物")
    assert isinstance(sig1, str) and "人物" in sig1
    assert MyQi21DaojieBase.IS_CHANGED("人物") == sig1  # json 未动=同签名(吃缓存)
    # 库文件缺失才退化 nan(恒变);真源在场时签名恒为字符串
    assert isinstance(MyQi21DaojieBase.IS_CHANGED("场景"), str)


# ── 自守:未知型/库缺失中文 RuntimeError ───────────────────
def test_unknown_base_raises_plain_language():
    with pytest.raises(RuntimeError, match="未知 qi21 底座"):
        MyQi21DaojieBase().run("不存在的型")


def test_missing_json_degrades_loudly(tmp_path, monkeypatch):
    monkeypatch.setattr(my_qi21_base, "_BASES_JSON", tmp_path / "nope.json")
    assert my_qi21_base.bases_list() == ["(qi21底座库未找到,请重启漫影或检查安装)"]
    with pytest.raises(RuntimeError, match="qi21 底座库缺失"):
        MyQi21DaojieBase().run("人物")
