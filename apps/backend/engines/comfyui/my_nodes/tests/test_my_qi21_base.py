# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21DaojieBase 契约测试(qi21 道劫九选一底座节点,09-23 造件;与
test_my_daojie_base.py 同目录同纪律,源码位 sidecar 零引擎依赖)。

锁:注册面(含 test_my_nodes.py 注册面全集钉)/COMBO 十项有序(1001 P1 起
=canon daojie_bases.json zh 顺序九型+「自由」末位;0923-1001 为九项 canon)
+默认钉死「人物」/六出形状(BASE·WIDTH·HEIGHT·型名·rgba_default——0929
画布治理批 D6 追加最末,既有槽序不动;透明值——1001 用户测试批 P1 透明执行口
d 方案追加第六出,同款零漂移纪律)/BASE 与 05 库对应型逐字一致(②美化版底座
+人物系增量四锁B+④配色行,
锚从库运行时切出、零硬编码;①槽与常量A 不在 BASE 内——工作流恒挂层承担;
自由型 BASE=空串例外)/W/H 与 K2 MyDaojieBase 同型同参输出一比一(K2 侧多视图 override 3072×1024 直出;Q2.1 侧 0927 起多视图分档 3:4 无 override;
公式=MP 按 1024² 计、边长取整 8 倍数;自由型 1:1/1.0MP 兜底 1024×1024)/
rgba_default 四型(道具/多视图/高清人脸/表情差分)=true 其余五型 false
+自由型 false(锚=②层透明声明句全串运行时判定+四型集合独立钉;缺字段回退
False)/透明值三例(1001 P1:自由+覆盖true→true/人物+覆盖true→false 型默认
优先/缺省覆盖→各型 rgba_default)/数据文件 schema(aspect/MP/override
与 canon 逐字镜像;自由型独立钉)/未知型与库缺失中文 RuntimeError/
mtime 失效热改。
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
RENWU_XI = {"人物", "美宣", "多视图", "高清人脸", "分镜剧情图", "表情差分"}

# 0929 D6 rgba_default 四型(用户拍板:道具/多视图/高清人脸/表情差分默认开 RGBA,
# 其余五型默认关)——独立钉(防提取器 RGBA_DEFAULT_TYPES 常量被静默改)
RGBA_DEFAULT_TYPES = {"道具", "多视图", "高清人脸", "表情差分"}

# 透明声明句核锚=全串(防「透明头皮」光头禁令条款误判,S0 research/transparency-
# fusion.md 注记;canon_lib TRANSPARENT_DECL 首段,表情差分变体尾同前缀)
RGBA_DECL_ANCHOR = "图为带透明通道的 RGBA 透明底图"


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


# ── 形状:COMBO 十项(九型 canon 顺序+自由末位)有序+默认钉死 ──────────
def test_combo_ten_options_in_canon_order_with_pinned_default():
    spec = MyQi21DaojieBase.INPUT_TYPES()
    # 1001 P1:optional 透明覆盖(d 方案透明执行口)尾部追加;required 仍恰 base
    assert set(spec) == {"required", "optional"}
    assert set(spec["required"]) == {"base"}
    assert set(spec["optional"]) == {"透明覆盖"}
    assert spec["optional"]["透明覆盖"] == ("BOOLEAN", {"default": False})
    combo = spec["required"]["base"]
    assert isinstance(combo[0], list)
    # 1001 P1:十档=九型(canon zh 顺序,json 条目顺序不 sorted)+「自由」末位
    assert combo[0] == _canon_order() + ["自由"]
    assert combo[1]["default"] == "人物"  # DEFAULT_BASE 钉死(自由不加塞默认)
    # 0929 D6:rgba_default(BOOLEAN)追加最末——既有槽序不动=存量工作流接线零漂移;
    # 1001 P1:透明值(BOOLEAN)追加第六出(同款纪律):型≠自由?rgba_default:透明覆盖
    assert MyQi21DaojieBase.RETURN_TYPES == (
        "STRING", "INT", "INT", "STRING", "BOOLEAN", "BOOLEAN")
    assert MyQi21DaojieBase.RETURN_NAMES == (
        "BASE", "WIDTH", "HEIGHT", "型名", "rgba_default", "透明值")
    assert MyQi21DaojieBase.FUNCTION == "run"


# ── BASE:九型与 05 库对应型逐字一致(锚运行时切出,零硬编码)─────────
def test_base_text_verbatim_from_lib_for_all_nine():
    doc = _lib_doc()
    for zh in _canon_order():
        base_text, _w, _h, name_out, _rgba, _t = MyQi21DaojieBase().run(zh)
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
    # 自由型(1001 P1):无型底座层=BASE 空串(装配器两段降级拼的常常态)
    free_base, *_rest = MyQi21DaojieBase().run("自由")
    assert free_base == ""


def test_run_all_options_produce_nonempty_outputs():
    for zh in _canon_order():
        base_text, w, h, name_out, _rgba, _t = MyQi21DaojieBase().run(zh)
        assert base_text and ("细墨线" in base_text or "运笔" in base_text)
        assert isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0
    # 自由型:BASE 空串(正常态),W/H 兜底 1:1 (Square)/1.0MP=1024×1024
    base_text, w, h, name_out, _rgba, _t = MyQi21DaojieBase().run("自由")
    assert base_text == "" and name_out == "自由"
    assert (w, h) == (1024, 1024) and w % 8 == 0 and h % 8 == 0


# ── W/H:与 K2 MyDaojieBase 同型同参输出一致(公式口径单源)─────
def test_width_height_match_k2_same_type_and_params():
    for zh in _canon_order():
        _b, w, h, _n, _rgba, _t = MyQi21DaojieBase().run(zh)
        _p, _neg, aspect, mp, _bn, k_w, k_h = MyDaojieBase().run(zh)
        if zh == "多视图":
            # 0927 多视图轮:Q2.1侧画幅分档(3:4 Portrait 4.2MP 分张,退役 override;提取器
            # Q21_ASPECT_FORK)——K2 侧 canon 合板口径(21:9+3072×1024)不动,两制分道;
            # 型名对齐锁不受影响(此型外八型仍一比一)
            assert (w, h) == native_px("3:4 (Portrait Standard)", 4.2) == (1816, 2424), zh
            continue
        assert (w, h) == (k_w, k_h), zh  # 同型同参(aspect/MP/override 同 canon)
        entry = my_qi21_base._entry(zh)
        if entry.get("resolution_override") is None:
            # 公式路:与 [61] 口径一致(MP 按 1024² 计,边长取整 8 倍数)
            assert (w, h) == native_px(aspect, mp), zh
            assert w % 8 == 0 and h % 8 == 0, zh
        else:
            assert (w, h) == tuple(entry["resolution_override"]), zh


def test_width_height_reference_table():
    """十型对照表(型→宽×高;防 K2 侧公式漂移时静默跟漂的独立钉)。
    自由型(1001 P1)=1:1 (Square)/1.0MP 兜底 1024×1024(design §2.1)。"""
    expect = {
        "人物": (1816, 2424), "场景": (2800, 1576), "道具": (1024, 1024),
        "美宣": (3208, 1376), "多视图": (1816, 2424), "高清人脸": (1024, 1024),
        "分镜剧情图": (2800, 1576), "表情差分": (2096, 2096),
        "概念气氛图": (2800, 1576), "自由": (1024, 1024)}
    for zh, (w, h) in expect.items():
        _b, w_out, h_out, _n, _rgba, _t = MyQi21DaojieBase().run(zh)
        assert (w_out, h_out) == (w, h), (zh, w_out, h_out)


# ── rgba_default:四型透明声明型 true 其余 false(0929 D6)─────────
def test_rgba_default_four_types_true_rest_false():
    """rgba_default(0929 画布治理批 D6,用户拍板四型):①锚=②层透明声明句全串
    运行判定(零硬编码;全串防「透明头皮」光头禁令条款误判);②四型集合独立钉
    (防提取器 RGBA_DEFAULT_TYPES 被静默改);③节点输出与 json 字段一致。"""
    for zh in _canon_order():
        base_text, _w, _h, _n, rgba, _t = MyQi21DaojieBase().run(zh)
        assert isinstance(rgba, bool), zh
        assert rgba == (RGBA_DECL_ANCHOR in base_text), zh  # 布尔随声明句走
        entry = my_qi21_base._entry(zh)
        assert rgba == entry["rgba_default"], zh  # 节点输出=json 字段
    got = {zh for zh in _canon_order() if MyQi21DaojieBase().run(zh)[4]}
    assert got == RGBA_DEFAULT_TYPES, got
    # 自由型(1001 P1):rgba_default=false(用户指定;BASE 空串无透明声明句)
    _fb, _fw, _fh, _fn, free_rgba, _ft = MyQi21DaojieBase().run("自由")
    assert free_rgba is False


# ── 数据文件 schema:字段形状+与 canon 逐字镜像 ─────────────────
def test_data_file_schema():
    entries = json.loads(
        my_qi21_base._BASES_JSON.read_text(encoding="utf-8"))
    assert isinstance(entries, list) and len(entries) == 10  # 1001 P1:九型+自由
    assert [e["zh"] for e in entries] == _canon_order() + ["自由"]  # 自由末位
    for e in entries:
        zh = e["zh"]
        assert isinstance(zh, str) and zh
        bt = e["base_text"]
        assert isinstance(bt, str)
        if zh == "自由":
            # 自由型(1001 P1,design §2.1):base_text 空串=无型底座层(唯一例外)
            assert bt == "", (zh, bt)
            assert e["aspect_ratio"] == "1:1 (Square)"
            assert e["megapixels"] == 1.0
            continue
        assert bt  # 九型底座文本非空
        assert len(bt.split("\n")) == (6 if zh in RENWU_XI else 2), zh
        assert e["aspect_ratio"] in ASPECTS, (zh, e["aspect_ratio"])  # 官方枚举串
        mp = e["megapixels"]
        assert (isinstance(mp, (int, float)) and not isinstance(mp, bool)
                and mp > 0), (zh, mp)
        # 0929 D6:rgba_default 九型全带布尔(提取器 RGBA_DEFAULT_TYPES 真源)
        assert isinstance(e["rgba_default"], bool), (zh, e.get("rgba_default"))
        assert e["rgba_default"] == (zh in RGBA_DEFAULT_TYPES), zh
        if "resolution_override" in e:
            ov = e["resolution_override"]
            assert (isinstance(ov, list) and len(ov) == 2
                    and all(isinstance(v, int) and not isinstance(v, bool) and v > 0
                            for v in ov)), (zh, ov)
    # 自由型 rgba_default=false(用户指定;ASPECTS 枚举同样适用)
    free = entries[-1]
    assert isinstance(free["rgba_default"], bool) and free["rgba_default"] is False
    assert free["aspect_ratio"] in ASPECTS


def test_aspect_megapixels_mirror_canon():
    """画幅档与 canon(daojie_bases.json)逐字镜像(aspect/MP/override 三字段;
    多视图型例外=0927 多视图轮 Q2.1侧画幅分档,与提取器 Q21_ASPECT_FORK 单源;
    自由型例外=1001 P1 十档末位,非 canon 镜像,字段独立钉见 test_data_file_schema)。"""
    fork = {"多视图": ("3:4 (Portrait Standard)", 4.2, None)}
    canon = {e["zh"]: e for e in json.loads(CANON_BASES.read_text(encoding="utf-8"))}
    for e in json.loads(
            my_qi21_base._BASES_JSON.read_text(encoding="utf-8")):
        if e["zh"] == "自由":
            continue  # 自由型不在 canon(1001 P1 独立条目,非提取器产物)
        c = canon[e["zh"]]
        want_a, want_m, want_ov = fork.get(
            e["zh"], (c["aspect_ratio"], c["megapixels"], c.get("resolution_override")))
        assert e["aspect_ratio"] == want_a, e["zh"]
        assert e["megapixels"] == want_m, e["zh"]
        assert e.get("resolution_override") == want_ov, e["zh"]


# ── 热改:mtime 失效(json 文案改=下次 run 即新文)───────────
def test_json_mtime_invalidation_hot_edit(tmp_path, monkeypatch, capsys):
    fake = tmp_path / "qi21_bases.json"
    fake.write_text(json.dumps([
        {"zh": "测试型", "base_text": "测试底座"}], ensure_ascii=False),
        encoding="utf-8")
    monkeypatch.setattr(my_qi21_base, "_BASES_JSON", fake)
    assert my_qi21_base.bases_list() == ["测试型"]
    bt, w, h, name, rgba, transparent = MyQi21DaojieBase().run("测试型")
    assert bt == "测试底座" and name == "测试型"
    # 缺 rgba_default 字段:回退 False(0929 D6;默认关=安全侧,与五型默认同态)
    assert rgba is False
    # 非自由型透明值=rgba_default 型默认优先(1001 P1;覆盖缺省不改变九型行为)
    assert transparent is False
    # 缺分辨率字段:回退 1:1 (Square)/4.2(与 K2 单源)+控制台中文警告
    assert (w, h) == native_px("1:1 (Square)", 4.2) == (2096, 2096)
    out = capsys.readouterr().out
    assert "缺 aspect_ratio 字段" in out and "缺 megapixels 字段" in out
    assert "缺 rgba_default 字段" in out
    assert "回退" in out
    # 热改:同路径改内容+推 mtime(免文件系统时间粒度),现读即生效
    entries = json.loads(fake.read_text(encoding="utf-8"))
    entries[0]["base_text"] = "热改后的底座"
    fake.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    stat = fake.stat()
    time.sleep(0.01)
    import os
    os.utime(fake, (stat.st_atime + 5, stat.st_mtime + 5))
    bt2, _w2, _h2, _n2, _rgba2, _t2 = MyQi21DaojieBase().run("测试型")
    assert bt2 == "热改后的底座"


def test_is_changed_tracks_json_mtime_signature():
    sig1 = MyQi21DaojieBase.IS_CHANGED("人物")
    assert isinstance(sig1, str) and "人物" in sig1
    assert MyQi21DaojieBase.IS_CHANGED("人物") == sig1  # json 未动=同签名(吃缓存)
    # 库文件缺失才退化 nan(恒变);真源在场时签名恒为字符串
    assert isinstance(MyQi21DaojieBase.IS_CHANGED("场景"), str)


def test_is_changed_accepts_optional_transparent_override_kwarg():
    """IS_CHANGED 具名收 optional 槽(1001 P4 实弹发现的签名欠账回归锁:
    引擎把全部输入(含 optional 透明覆盖)投给 IS_CHANGED,签名缺参→引擎
    WARNING「unexpected keyword argument '透明覆盖'」+签名失效;P4 修复=
    K2 件 positive/negative 同款具名惯例)。值不参与签名(透明覆盖只影响
    第六出布尔,轻件输出无缓存穿透需求)。"""
    sig_base = MyQi21DaojieBase.IS_CHANGED("人物")
    sig_with_kw = MyQi21DaojieBase.IS_CHANGED("人物", 透明覆盖=True)
    assert sig_with_kw == sig_base  # 同型同库=同签名(覆盖不入签名)
    assert isinstance(MyQi21DaojieBase.IS_CHANGED("自由", 透明覆盖=False), str)


# ── 自守:未知型/库缺失中文 RuntimeError ───────────────────
def test_unknown_base_raises_plain_language():
    with pytest.raises(RuntimeError, match="未知 qi21 底座"):
        MyQi21DaojieBase().run("不存在的型")


def test_missing_json_degrades_loudly(tmp_path, monkeypatch):
    monkeypatch.setattr(my_qi21_base, "_BASES_JSON", tmp_path / "nope.json")
    assert my_qi21_base.bases_list() == ["(qi21底座库未找到,请重启漫影或检查安装)"]
    with pytest.raises(RuntimeError, match="qi21 底座库缺失"):
        MyQi21DaojieBase().run("人物")


# ── 透明值(1001 用户测试批 P1,design §2.4 d 方案三例)──────────────
# 透明值=型≠自由?该型 rgba_default:透明覆盖——九型=型默认优先(覆盖被
# 忽略,消灭子图内 [210] 三态合成层=问题⑥⑦),自由型=面板布尔直通;缺省
# 覆盖(False/None)→各型 rgba_default(旧接线零波及=向后兼容铁律)。
def test_free_base_transparent_value_passes_override():
    """自由+透明覆盖 true → 透明值 true(design §2.4 新单测例1:面板布尔
    直通;BASE 空串+W/H 兜底 1024×1024+rgba_default=false 一并钉)。"""
    base_text, w, h, name, rgba, transparent = MyQi21DaojieBase().run(
        "自由", 透明覆盖=True)
    assert base_text == "" and name == "自由"
    assert (w, h) == (1024, 1024)
    assert rgba is False          # rgba_default 输出=型档数据(自由=false)
    assert transparent is True    # 透明值=覆盖直通(自由型唯一消费覆盖的档)


def test_nine_type_transparent_value_ignores_override():
    """九型+透明覆盖 → 透明值=型默认优先(design §2.4 新单测例2:人物+true
    →false;反向钉道具+false→true——覆盖在九型恒被忽略,双方向防「覆盖
    恒压制」或「透明值恒取覆盖」两类实现漂移)。"""
    _b, _w, _h, _n, rgba, transparent = MyQi21DaojieBase().run(
        "人物", 透明覆盖=True)
    assert rgba is False and transparent is False  # 人物 rgba_default=false
    _b, _w, _h, _n, rgba, transparent = MyQi21DaojieBase().run(
        "道具", 透明覆盖=False)
    assert rgba is True and transparent is True    # 道具 rgba_default=true


def test_default_override_transparent_value_follows_rgba_default():
    """缺省透明覆盖(不传=None)→透明值=各型 rgba_default(design §2.4 新单测
    例3:十档全扫——九型逐一相等;自由型 None→False 与 default 同态;
    i2i/edit 旧工作流不接新槽=第五/六出同值,零波及)。"""
    for zh in _canon_order() + ["自由"]:
        _b, _w, _h, _n, rgba, transparent = MyQi21DaojieBase().run(zh)
        assert isinstance(transparent, bool), zh
        assert transparent == rgba, (zh, rgba, transparent)
    # 显式缺省形态:None(引擎 optional 未接线投递)同 0 覆盖行为
    _b, _w, _h, _n, _rgba, transparent = MyQi21DaojieBase().run("自由",
                                                                透明覆盖=None)
    assert transparent is False
