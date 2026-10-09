# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyQi21DaojieBase 契约测试(qi21 道劫九选一底座节点,09-23 造件;与
test_my_daojie_base.py 同目录同纪律,源码位 sidecar 零引擎依赖)。

1004 集中化令随迁:canon/数据真源=daojie_ink_guofeng/json/qi21_bases.json
(dict 外壳 types[];原本目录 daojie_bases.json 退役删件,字段 positive/
negative→positive_text/negative_text);05 库逐字互锁退役(05 库=记录层,
措辞可与真源漂移——如衣物完整性长短版),BASE 锚随迁真源家 json。

锁:注册面(含 test_my_nodes.py 注册面全集钉)/COMBO 十项有序(1001 P1 起
=canon zh 顺序九型+「自由」末位)
+默认钉死「人物」/五出形状(BASE·WIDTH·HEIGHT·透明值·负面词——
1002 ⑯ 删「型名」第四出:三件工作流全零消费,输出槽迁移表=任务档
research/slot-map.md;透明值 1001 P1 透明执行口 d 方案,同款零漂移纪律;
负面词=1005 案B Phase I 第五出:型负面出口=entry.negative_text 逐字,
追加最末存量四出槽序零漂移)/全部控件 tooltip 在位(1002 ⑰)/
BASE=真源家 positive_text 逐字(①槽与美术风格底座常量 不在 BASE 内——工作流恒挂层
承担;人物系=②+锁B+④+衣物完整性 7 行,非人物系 2 行;自由型 BASE=空串
例外)/负面词=真源家 negative_text 逐字(1005 案B:十档全带,自由型非空
例外与 BASE 相反)/
W/H 与 K2 MyDaojieBase 同型同参输出一比一(1004 集中化:两件同源直读
真源家,0927 Q21 多视图分档随 sidecar 提取链退役,多视图回 canon 合板
override 直出——1008 快出档缩编后=2448×1632,旧 3072×1024 入 git 史;
公式=MP 按 1024² 计、边长取整 8 倍数;自由型
1:1/1.0MP 兜底 1024×1024)/
rgba_default 四型(道具/多视图/高清人脸/表情差分)=true 其余五型 false
+自由型 false(布尔真源=json 字段+四型集合独立钉;旧「②层透明声明句全串
运行时判定」互锁随 1004 重建退役——真源家 positive_text 仅道具型保留
声明句;缺字段回退 False)/透明值三例(1001 P1:自由+覆盖true→true/
人物+覆盖true→false 型默认优先/缺省覆盖→各型 rgba_default)/数据文件
schema(dict 外壳 types[] 十档;aspect/MP/override 与 canon 逐字镜像;
自由型独立钉)/未知型与库缺失中文 RuntimeError/
mtime 失效热改。
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes import my_qi21_base
from engines.comfyui.my_nodes.nodes.my_daojie_base import ASPECTS, MyDaojieBase, native_px
from engines.comfyui.my_nodes.nodes.my_qi21_base import MyQi21DaojieBase

# 仓库根:my_nodes/tests/test_x.py → parents[6]=仓库根(apps 的上一级)
REPO = Path(__file__).resolve().parents[6]
# 1004 集中化:canon=真源家 qi21_bases.json(dict 外壳;原 sidecar canon
# daojie_bases.json 退役删件,锚随迁);sidecar nodes/qi21_bases.json=四层
# 兜底同步产物(镜像对拍见 test_aspect_megapixels_mirror_canon)
CANON_BASES = (REPO / "apps/frontend/assets/studio-manuals"
               / "art_skills/daojie_ink_guofeng/json" / "qi21_bases.json")
SIDECAR_BASES = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes"
                 / "qi21_bases.json")

# 人物系六型(positive_text 含锁B 增量四锁+衣物完整性行;1004 集中化后真源
# =qi21_bases.json 自身,旧「05 库生成器 daojie_canon_lib.py 同表」提取链退役)
RENWU_XI = {"人物", "美宣", "人物多视图", "高清人脸", "分镜剧情图", "表情差分"}

# 0929 D6 rgba_default 四型(用户拍板:道具/多视图/高清人脸/表情差分默认开 RGBA,
# 其余五型默认关)——独立钉(防提取器 RGBA_DEFAULT_TYPES 常量被静默改)
RGBA_DEFAULT_TYPES = {"道具", "人物多视图", "高清人脸", "表情差分"}

# 透明声明句核锚=全串(防「透明头皮」光头禁令条款误判,S0 research/transparency-
# fusion.md 注记;canon_lib TRANSPARENT_DECL 首段,表情差分变体尾同前缀)
RGBA_DECL_ANCHOR = "图为带透明通道的 RGBA 透明底图"


@pytest.fixture(autouse=True)
def _reset_bases_cache():
    """测试间清模块级缓存,免 monkeypatch 改 _BASES_JSON 后读到旧缓存。"""
    my_qi21_base._bases_cache.update(mtime=None, entries=None)
    yield
    my_qi21_base._bases_cache.update(mtime=None, entries=None)


def _canon_types() -> list:
    """真源家 types[] 九型(排除自由=Q2.1 十档末位,非 canon 九型)。"""
    data = json.loads(CANON_BASES.read_text(encoding="utf-8"))
    return [e for e in data["types"] if e["zh"] != "自由"]


def _canon_order() -> list:
    return [e["zh"] for e in _canon_types()]


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_qi21_base():
    assert NODE_CLASS_MAPPINGS.get("MyQi21DaojieBase") is MyQi21DaojieBase
    assert MyQi21DaojieBase.CATEGORY == "漫影"  # 类目与 K2 件(MyDaojieBase)同区
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
    # 1002 ⑰:tooltip 随加(default 语义不变;精确文案锁见 test_tooltips_present)
    assert spec["optional"]["透明覆盖"][0] == "BOOLEAN"
    assert spec["optional"]["透明覆盖"][1]["default"] is False
    combo = spec["required"]["base"]
    assert isinstance(combo[0], list)
    # 1001 P1:十档=九型(canon zh 顺序,json 条目顺序不 sorted)+「自由」末位
    assert combo[0] == _canon_order() + ["自由"]
    assert combo[1]["default"] == "人物"  # DEFAULT_BASE 钉死(自由不加塞默认)
    # 1002 ⑯:删「型名」第四出(三件工作流全零消费=按型路由历史遗留);1002 大轮
    # 连带(prd Grill Q1「rgba_default 删除」):rgba_default 出随 i2i [180].rgba_hint
    # 迁「透明值」(手术 STEP4)收口删除;1005 案B Phase I:负面词追加第五出
    # (=entry.negative_text 型负面出口,design §8.1 ①)——追加最末=存量四出
    # 槽序零漂移(存量连线按槽 0-3 不动)
    assert MyQi21DaojieBase.RETURN_TYPES == (
        "STRING", "INT", "INT", "STRING", "BOOLEAN")
    assert MyQi21DaojieBase.RETURN_NAMES == (
        "BASE", "WIDTH", "HEIGHT", "负面词", "透明值")
    assert MyQi21DaojieBase.FUNCTION == "run"


def test_tooltips_present_plain_language():
    """⑰(1002 用户测试批):全部控件 tooltip 在位(大白话一行)。"""
    spec = MyQi21DaojieBase.INPUT_TYPES()
    tips = {name: fields[1].get("tooltip")
            for group in ("required", "optional") for name, fields in spec[group].items()}
    for name, tip in tips.items():
        assert isinstance(tip, str) and tip.strip(), f"{name} 应有非空 tooltip(⑰),得 {tip!r}"
    assert "自由" in tips["base"], "base tooltip 应说明九型+自由档"
    assert "自由" in tips["透明覆盖"], "透明覆盖 tooltip 应说明仅自由型生效"


# ── BASE:九型与真源家 positive_text 逐字一致(1004 集中化锚)─────────
def test_base_text_verbatim_from_lib_for_all_nine():
    """BASE=真源家 qi21_bases.json types[].positive_text 逐字(1004 集中化:
    05 库→json 逐字互锁退役,05 库=记录层措辞可与真源漂移——如衣物完整性
    长短版,旧「从 05 库运行时切出」锚废止留痕,锚随迁真源家)。
    人物系=②+锁B四行+④+衣物完整性行共 8 行(1004 增衣物完整性锁;1007 头发两态句一段拆两段);
    非人物系(场景/道具/概念气氛图)=②+④共 2 行。"""
    for zh in _canon_order():
        entry = my_qi21_base._entry(zh)
        # 1002 ⑯+大轮连带:四出解包(型名/rgba_default 出均删);
        # 1006 十轮:五出解包,第四出负面词(序改:负面词上,透明值下)
        base_text, _w, _h, neg_text, _t = MyQi21DaojieBase().run(zh)
        assert base_text == entry["positive_text"], zh
        assert neg_text == entry["negative_text"], zh  # 型负面出口(案B:去死数据)
        lines = base_text.split("\n")
        # 1008晚透明句加入:三透明型(人物多视图/高清人脸/表情差分)型文+透明声明行=6行
        assert len(lines) == (7 if zh in {"人物多视图"} else (4 if zh in {"高清人脸", "表情差分"} else (6 if zh in RENWU_XI else 2))), zh  # 1009 并行轮:人脸/表情=4行脸专属版
        assert lines[0].endswith("。")  # ②层美化版底座句号自足收尾
        # ①槽与美术风格底座常量 不在 BASE 内(工作流恒挂层承担;禁混:防 BASE 变整段装配)
        assert not base_text.startswith("⟨①:")
        assert "风格底座：现代修仙游戏" not in base_text  # 美术风格底座常量 §四.1 首句禁入
    # 自由型(1001 P1):无型底座层=BASE 空串(装配器两段降级拼的常常态);
    # 负面词=短清单非空(schema 独立钉:十档 negative_text 应非空,自由型例外
    # 方向与 positive_text 相反——BASE 空但型负面在场)
    free_base, *_rest = MyQi21DaojieBase().run("自由")
    assert free_base == ""


def test_run_all_options_produce_nonempty_outputs():
    for zh in _canon_order():
        base_text, w, h, neg_text, _t = MyQi21DaojieBase().run(zh)
        assert base_text and ("细线" in base_text or "线随结构" in base_text)  # 1009 去彩锚随源
        assert isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0
        assert neg_text, zh  # 1005 案B:第五出型负面十档非空
    # 自由型:BASE 空串(正常态),W/H 兜底 1:1 (Square)/1.0MP=1024×1024
    base_text, w, h, free_neg, _t = MyQi21DaojieBase().run("自由")
    assert base_text == ""
    assert (w, h) == (1024, 1024) and w % 8 == 0 and h % 8 == 0
    assert free_neg  # 自由型型负面在场(短清单)


# ── 负面词第五出:真源家 negative_text 逐字(1005 案B Phase I 新锚)──────
def test_negative_output_verbatim_from_lib_for_all_ten():
    """第五出「负面词」=真源家 qi21_bases.json types[].negative_text 逐字
    (1005 案B Phase I,design §8.1 ①:型负面出口——修前无出口死数据,
    PE 编造词顶掉真负面);追加最末=存量四出零漂移(前四出值与本测试族
    其余锚同值);缺键回退空串(BASE 同款 .get 纪律,热改档容错)。"""
    data = json.loads(my_qi21_base._BASES_JSON.read_text(encoding="utf-8"))
    for entry in data["types"]:
        zh = entry["zh"]
        base_text, _w, _h, neg_text, transparent = MyQi21DaojieBase().run(zh)
        assert neg_text == entry["negative_text"], zh
        assert isinstance(neg_text, str) and neg_text, zh
        # 存量四出零漂移:第五出追加不改前四出形状与取值口径
        assert isinstance(base_text, str) and isinstance(transparent, bool), zh
    # 头部基线四词(契约 test_qi21_bases_json_interlocks_library 同口径抽验)
    assert "模糊" in MyQi21DaojieBase().run("人物")[3]


# ── W/H:与 K2 MyDaojieBase 同型同参输出一致(公式口径单源)─────
def test_width_height_match_k2_same_type_and_params():
    for zh in _canon_order():
        _b, w, h, _n, _t = MyQi21DaojieBase().run(zh)
        _p, _neg, aspect, mp, _bn, k_w, k_h = MyDaojieBase().run(zh)
        # 1004 集中化:两件同源直读真源家 qi21_bases.json,十档全型一比一
        # (0927 Q21 多视图分档 3:4 分张/退役 override 随 sidecar 提取链退役,
        # 多视图回 canon 合板口径 override 直出,1008 缩编后=2448×1632)
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
    自由型(1001 P1)=1:1 (Square)/1.0MP 兜底 1024×1024(design §2.1);
    多视图=canon override 2448×1632 直出(0927 Q21 分档退役,见上)。
    1008 快出档缩编:六型 4.2→1.5MP、多视图 4.2→1.8MP(用户令 1-2MP
    快出+后放大;4.2 旧档宽高表入 git 史)。"""
    expect = {
        "人物": (1088, 1448), "场景": (1672, 944), "道具": (1024, 1024),
        "美宣": (1912, 824), "人物多视图": (1632, 1632), "高清人脸": (1024, 1024),
        "分镜剧情图": (1672, 944), "表情差分": (1256, 1256),
        "概念气氛图": (1672, 944), "自由": (1024, 1024)}
    for zh, (w, h) in expect.items():
        _b, w_out, h_out, _n, _t = MyQi21DaojieBase().run(zh)
        assert (w_out, h_out) == (w, h), (zh, w_out, h_out)


# ── rgba_default:四型透明声明型 true 其余 false(0929 D6)─────────
def test_rgba_default_four_types_true_rest_false():
    """rgba_default(0929 画布治理批 D6,用户拍板四型):①布尔真源=json
    rgba_default 字段(1004 重建后「②层透明声明句全串运行时判定」互锁退役
    留痕——真源家 positive_text 仅道具型保留声明句,声明句与布尔不再逐型
    互锁;RGBA_DECL_ANCHOR 保留为道具型单点锚);②四型集合独立钉(防
    RGBA_DEFAULT_TYPES 被静默改);③节点输出与 json 字段一致。"""
    daojv = next(e for e in _canon_types() if e["zh"] == "道具")
    assert RGBA_DECL_ANCHOR in daojv["positive_text"]  # 道具型声明句单点锚
    for zh in _canon_order():
        base_text, _w, _h, _n, _t = MyQi21DaojieBase().run(zh)
        entry = my_qi21_base._entry(zh)
        assert base_text == entry["positive_text"], zh  # BASE 真源逐字(见上锁)
        assert _t == entry["rgba_default"], zh  # 透明值(第4出)=json rgba_default(九型)
    got = {zh for zh in _canon_order() if MyQi21DaojieBase().run(zh)[4]}  # 大轮后透明值=第5出(索引4;1006 十轮序改)
    assert got == RGBA_DEFAULT_TYPES, got
    # 自由型(1001 P1):rgba_default=false(用户指定;BASE 空串无透明声明句)
    _fb, _fw, _fh, _fn, free_t = MyQi21DaojieBase().run("自由")
    assert free_t is False       # 自由型透明值=False(=json rgba_default 同值)


# ── 数据文件 schema:字段形状+与 canon 逐字镜像 ─────────────────
def test_data_file_schema():
    """1004 集中化 schema:dict 外壳 {art_style_base?, types[]}(原平铺 list 退役);
    字段 base_text→positive_text/negative_text(正负拆开)。"""
    data = json.loads(my_qi21_base._BASES_JSON.read_text(encoding="utf-8"))
    assert isinstance(data, dict) and isinstance(data.get("types"), list)
    entries = data["types"]
    assert len(entries) == 10  # 1001 P1:九型+自由
    assert [e["zh"] for e in entries] == _canon_order() + ["自由"]  # 自由末位
    for e in entries:
        zh = e["zh"]
        assert isinstance(zh, str) and zh
        bt = e["positive_text"]
        assert isinstance(bt, str)
        assert isinstance(e["negative_text"], str) and e["negative_text"], zh
        if zh == "自由":
            # 自由型(1001 P1,design §2.1):positive_text 空串=无型底座层(唯一例外;
            # v3 字段(key/purpose/lora_recipe/steps_hint/i2i_routes/postprocess)不带)
            assert bt == "", (zh, bt)
            assert e["aspect_ratio"] == "1:1 (Square)"
            assert e["megapixels"] == 1.0
            continue
        assert bt  # 九型底座文本非空
        # 1004 增衣物完整性锁:人物系 7 行(②+锁B四行+④+完整性),非人物系 2 行
        assert len(bt.split("\n")) == (7 if zh in {"人物多视图"} else (4 if zh in {"高清人脸", "表情差分"} else (6 if zh in RENWU_XI else 2))), zh  # 1008晚透明句加入:三透明型+1行
        assert e["aspect_ratio"] in ASPECTS, (zh, e["aspect_ratio"])  # 官方枚举串
        mp = e["megapixels"]
        assert (isinstance(mp, (int, float)) and not isinstance(mp, bool)
                and mp > 0), (zh, mp)
        # 0929 D6:rgba_default 九型全带布尔(RGBA_DEFAULT_TYPES 集合真源)
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
    """1005 Step4 退役守卫:sidecar 产品件已删,canon 真源自洽(aspect/MP/override 全)。

    旧「sidecar×canon 镜像对拍」随产品侧退役废止;镜像语义由
    test_prompt_source_single_truth(装机固定位 sha)承接。
    """
    assert not SIDECAR_BASES.exists(), "产品侧 qi21_bases.json 回潮:Step4 已退役"
    canon = json.loads(CANON_BASES.read_text(encoding="utf-8"))["types"]
    assert len(canon) >= 10
    for e in canon:
        assert e.get("aspect_ratio") and e.get("megapixels"), f"{e.get('zh')} 缺 aspect/MP"

def test_json_mtime_invalidation_hot_edit(tmp_path, monkeypatch, capsys):
    # 1004 集中化 schema:dict 外壳 types[]+positive_text(原平铺 list/base_text 退役)
    fake = tmp_path / "qi21_bases.json"
    fake.write_text(json.dumps({"types": [
        {"zh": "测试型", "positive_text": "测试底座"}]}, ensure_ascii=False),
        encoding="utf-8")
    monkeypatch.setattr(my_qi21_base, "_BASES_JSON", fake)
    assert my_qi21_base.bases_list() == ["测试型"]
    bt, w, h, neg, transparent = MyQi21DaojieBase().run("测试型")
    assert bt == "测试底座"
    assert neg == ""  # 缺 negative_text 键=回退空串(案B:.get 纪律,空负向合法态)
    # 缺 rgba_default 字段:回退 False(0929 D6;默认关=安全侧,与五型默认同态)
    # 非自由型透明值=rgba_default 型默认优先(1001 P1;覆盖缺省不改变九型行为)
    assert transparent is False
    # 缺分辨率字段:回退 1:1 (Square)/4.2(与 K2 单源)+控制台中文警告
    assert (w, h) == native_px("1:1 (Square)", 4.2) == (2096, 2096)
    out = capsys.readouterr().out
    assert "缺 aspect_ratio 字段" in out and "缺 megapixels 字段" in out
    assert "缺 rgba_default 字段" in out
    assert "回退" in out
    # 热改:同路径改内容+推 mtime(免文件系统时间粒度),现读即生效
    entries = json.loads(fake.read_text(encoding="utf-8"))["types"]
    entries[0]["positive_text"] = "热改后的底座"
    fake.write_text(json.dumps({"types": entries}, ensure_ascii=False),
                    encoding="utf-8")
    stat = fake.stat()
    time.sleep(0.01)
    import os
    os.utime(fake, (stat.st_atime + 5, stat.st_mtime + 5))
    bt2, _w2, _h2, _n2, _t2 = MyQi21DaojieBase().run("测试型")
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
    base_text, w, h, _neg, transparent = MyQi21DaojieBase().run(
        "自由", 透明覆盖=True)
    assert base_text == ""
    assert (w, h) == (1024, 1024)
    assert transparent is True    # 透明值=覆盖直通(自由型唯一消费覆盖的档)


def test_nine_type_transparent_value_ignores_override():
    """九型+透明覆盖 → 透明值=型默认优先(design §2.4 新单测例2:人物+true
    →false;反向钉道具+false→true——覆盖在九型恒被忽略,双方向防「覆盖
    恒压制」或「透明值恒取覆盖」两类实现漂移)。"""
    _b, _w, _h, _n, transparent = MyQi21DaojieBase().run("人物", 透明覆盖=True)
    assert transparent is False  # 人物 rgba_default=false(覆盖被忽略)
    _b, _w, _h, _n, transparent = MyQi21DaojieBase().run("道具", 透明覆盖=False)
    assert transparent is True   # 道具 rgba_default=true(覆盖被忽略)


def test_default_override_transparent_value_follows_rgba_default():
    """缺省透明覆盖(不传=None)→透明值=各型 rgba_default(design §2.4 新单测
    例3:十档全扫——九型逐一相等;自由型 None→False 与 default 同态;
    i2i/edit 旧工作流不接新槽=第四/五出同值,零波及;⑯ 删型名后仍同构)。"""
    for zh, rgba in [(z, z in RGBA_DEFAULT_TYPES) for z in _canon_order()] + [("自由", False)]:
        _b, _w, _h, _n, transparent = MyQi21DaojieBase().run(zh)
        assert isinstance(transparent, bool), zh
        assert transparent == rgba, (zh, rgba, transparent)  # 与 json rgba_default 同值
    # 显式缺省形态:None(引擎 optional 未接线投递)同 0 覆盖行为
    _b, _w, _h, _n, transparent = MyQi21DaojieBase().run("自由", 透明覆盖=None)
    assert transparent is False
