# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyDaojieBase 契约测试(道劫底座节点,09-18 用户令;与 test_my_styles.py
同目录同纪律,源码位 sidecar 零引擎依赖)。

1004 集中化令随迁:数据真源=daojie_ink_guofeng/json/qi21_bases.json
(types[] 九型+自由;原本目录 daojie_bases.json 退役删件,平铺 list→dict
外壳,字段 positive/negative→positive_text/negative_text;美术风格底座=art_style_base
正负双出)。装配语义=正向三层换行拼装(型底座→美术风格底座→主体句)+负向三层
合并(美术风格底座+型负面+用户负向,复用 my_styles._merge_negative;旧「底座在前
零分隔符直拼」口径废止留痕)。九型负面基线=中文「，」token(1004 中文负面
役,旧「纯英文逗号 token」断言与现实相反,废止留痕)。

锁:注册面/COMBO 十项有序(九型+自由末位)+默认钉死「人物」/装配三层
语义/分辨率两出 aspect+mp 随型现读 json、缺字段回退 1:1 (Square)/4.2+
控制台警告/mtime 失效热改/未知底座中文 RuntimeError/人物型=v2.2 新口径锚
(09-18 定性切换,§一 超集解除,锚从 md 运行时切出防旧口径回潮,零硬编码)/
v3 九型配方(lora_recipe/steps_hint/i2i_routes/postprocess:九型全量形状+
定谳值+栈预设一比一+缺省回退,09-19 C2 单源;装机家存在性对拍已随 K2
退役退休,09-24)。
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from engines.comfyui.my_nodes.nodes import my_daojie_base
from engines.comfyui.my_nodes.nodes.my_daojie_base import MyDaojieBase

# 仓库根:my_nodes/tests/test_x.py → parents[6]=仓库根(apps 的上一级)
REPO = Path(__file__).resolve().parents[6]
PROMPT_MD_0917 = REPO / "docs" / "prompts" / "道劫_新提示词包_0917.md"

EXPECTED_OPTIONS = [
    "人物", "场景", "道具", "美宣", "人物多视图",
    "高清人脸", "分镜剧情图", "表情差分", "概念气氛图",
]


@pytest.fixture(autouse=True)
def _reset_bases_cache():
    """测试间清模块级缓存,免 monkeypatch 改 _BASES_JSON 后读到旧缓存
    (1004 正负拆开:美术风格底座缓存同清,防上一测试的真源 art_style_base 泄漏)。"""
    my_daojie_base._bases_cache.update(mtime=None, entries=None)
    my_daojie_base._lock_cache.update(mtime=None, data=None)
    yield
    my_daojie_base._bases_cache.update(mtime=None, entries=None)
    my_daojie_base._lock_cache.update(mtime=None, data=None)


def _bases_entries() -> list:
    """真源家 qi21_bases.json types[] 九型现读(1004 集中化:dict 外壳;
    自由=Q2.1 十档末位,K2 消费面=九型不含自由)。"""
    data = json.loads(my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
    return [e for e in data["types"] if e["zh"] != "自由"]


def _md_section1() -> str:
    """0917 提示词包 §一 首个 ```text 围栏逐字内容(与道劫契约测试同法)。"""
    lines = PROMPT_MD_0917.read_text(encoding="utf-8").splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.startswith("## 一、"))
    j = next(k for k in range(start, len(lines)) if lines[k].startswith("```text"))
    end = next(k for k in range(j + 1, len(lines)) if lines[k].startswith("```"))
    return "\n".join(lines[j + 1:end])


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_daojie_base():
    assert NODE_CLASS_MAPPINGS.get("MyDaojieBase") is MyDaojieBase
    assert MyDaojieBase.CATEGORY == "漫影"
    assert NODE_DISPLAY_NAME_MAPPINGS["MyDaojieBase"] == "漫影 道劫底座"
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingDaojieBase" not in NODE_CLASS_MAPPINGS


# ── 形状:COMBO 十项(九型+自由末位)与 json 一致且有序+默认钉死+forceInput ──
def test_combo_nine_options_in_json_order_with_pinned_default():
    spec = MyDaojieBase.INPUT_TYPES()
    assert set(spec["required"]) == {"base"}
    combo = spec["required"]["base"]
    assert isinstance(combo[0], list)
    # 1004 集中化:combo=真源家 types[] 全十档 zh 序(自由末位;原九型 canon
    # daojie_bases.json 已退役并入 qi21_bases.json,锚随迁)
    assert combo[0] == EXPECTED_OPTIONS + ["自由"]
    assert [e["zh"] for e in _bases_entries()] == EXPECTED_OPTIONS  # 九型顺序互锁
    assert combo[1]["default"] == "人物"  # DEFAULT_BASE 钉死
    assert set(spec["optional"]) == {"positive", "negative"}
    for key in ("positive", "negative"):
        slot = spec["optional"][key]
        assert slot[0] == "STRING"
        assert set(slot[1]) == {"forceInput"}  # 多键(default/multiline)会生文本 widget
        assert slot[1]["forceInput"] is True
    assert MyDaojieBase.RETURN_TYPES == ("STRING", "STRING", "COMBO", "FLOAT", "COMBO", "INT", "INT")
    assert MyDaojieBase.RETURN_NAMES == ("positive", "negative", "aspect", "megapixels", "base",
                                         "width", "height")
    assert MyDaojieBase.FUNCTION == "run"


# ── 装配语义(1004 正负拆开):正向=型底座→美术风格底座→主体句三层换行拼装 ──
def test_run_assembles_base_first_then_subject_verbatim():
    """1008 用户令「[4010] 应该只有类型句才对」:[4010] 只出型层,不再拼底座+主体句。
    三层拼装职责归 [4013] PE(subj+base+style),[4010] 是纯型层出口。"""
    renwu = next(e for e in _bases_entries() if e["zh"] == "人物")
    pos, _neg, _aspect, _mp, _base, _w, _h = MyDaojieBase().run(
        "人物", positive="  一位女修士，青年金丹期。 ")
    assert pos == renwu["positive_text"]  # 纯型层,不含底座/主体句
    lock_pos = my_daojie_base._load_art_style_base()["positive"]
    assert lock_pos not in pos  # 底座不在(由 [4032] 供)
    assert "一位女修士" not in pos  # 主体句不在(由 [400] 供)


def test_run_empty_subject_is_identity_pure_base():
    """1008 同上:[4010] 空主体句=纯型层(不再拼底座)。"""
    scene = next(e for e in _bases_entries() if e["zh"] == "场景")
    pos, neg, aspect, mp, base_out, w_out, h_out = MyDaojieBase().run("场景")
    assert base_out == "场景"
    assert pos == scene["positive_text"]  # 纯型层
    assert aspect == "16:9 (Widescreen)" and mp == 1.5  # 1008 快出档缩编
    pos2, _n2, _a2, _m2, _b2, _w, _h = MyDaojieBase().run("场景", positive=None, negative=None)
    assert pos2 == pos


def test_run_all_options_produce_nonempty_outputs():
    for name in EXPECTED_OPTIONS:
        pos, neg, aspect, mp, base_out, _w, _h = MyDaojieBase().run(name)
        assert base_out == name  # 09-19 第五出=型直通(驱动按型 LoRA)
        # 09-22 v4:九型同一套可见画法,句号自足收尾;不再以资产定性句开头
        # (道具型 ② 无「均匀柔光/平涂」措辞,画法锚收窄为细彩线)
        assert pos and "细线" in pos
        assert not pos.startswith("现代修仙游戏")
        assert pos.endswith("。")
        # 1004 中文负面役:九型负面基线=中文「，」token,美术风格底座负面同并入
        assert neg and "模糊" in neg
        # 09-18 分辨率两出:九型 aspect 一律官方枚举串;mp 1008 快出档缩编
        # (用户令 1-2MP 快出+后放大):道具/高清人脸 1.0(09-19 裁定出
        # 1024×1024,节点口径 1.0 MP 精确命中)、多视图 1.8、其余五型 1.5
        assert aspect.endswith(")") and ":" in aspect
        assert mp == {"道具": 1.0, "高清人脸": 1.0, "人物多视图": 1.8}.get(name, 1.5)


# ── 负向(1008):[4010] 只出型层负向,不再拼底座负向+用户负向 ──
def test_run_negative_merges_and_dedupes_tokens():
    """1008:[4010] 负向=纯型层 negative_text(三层合并归 [4013] PE)。"""
    renwu = next(e for e in _bases_entries() if e["zh"] == "人物")
    _, neg, _, _, _b, _w, _h = MyDaojieBase().run("人物", negative="text")
    assert neg == renwu["negative_text"]  # 纯型层负向
    lock_neg = my_daojie_base._load_art_style_base()["negative"]
    assert lock_neg not in neg  # 底座负向不在(由 [4032].1 供)
    assert "text" not in neg  # 用户负向不在(由 [404] 供)


def test_merge_negative_reused_from_my_styles():
    # 防漂移:节点负向合并必须就是 my_styles 的那份实现(权重组不切)
    from engines.comfyui.my_nodes.nodes.my_styles import _merge_negative
    assert my_daojie_base._merge_negative is _merge_negative
    merged = _merge_negative("a, (worst quality, low quality:1.4)", "a, b")
    assert merged == "a, (worst quality, low quality:1.4), b"


# ── 热改:mtime 失效(json 文案改=下次 run 即新文)───────────
def test_json_mtime_invalidation_hot_edit(tmp_path, monkeypatch, capsys):
    # 1004 集中化 schema:dict 外壳 types[];字段 positive_text/negative_text
    # (art_style_base 缺席=美术风格底座两出为空串,正负装配降级为纯型底座面)
    fake = tmp_path / "qi21_bases.json"
    fake.write_text(json.dumps({"types": [
        {"key": "测试型", "zh": "测试型", "purpose": "p",
         "positive_text": "测试底座。", "negative_text": "测试负面"}]},
        ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(my_daojie_base, "_BASES_JSON", fake)
    assert my_daojie_base.bases_list() == ["测试型"]
    pos, _, aspect, mp, _base, _w, _h = MyDaojieBase().run("测试型")
    assert pos == "测试底座。"
    # 缺分辨率字段:回退 1:1 (Square)/4.2(枚举逐字串)+控制台中文警告
    assert aspect == "1:1 (Square)"
    assert mp == 4.2
    warned = capsys.readouterr().out
    assert "缺 aspect_ratio 字段" in warned and "缺 megapixels 字段" in warned
    assert "回退" in warned
    # 热改:同路径改内容+推 mtime(免文件系统时间粒度),现读即生效
    entries = json.loads(fake.read_text(encoding="utf-8"))["types"]
    entries[0]["positive_text"] = "热改后的底座。"
    fake.write_text(json.dumps({"types": entries}, ensure_ascii=False),
                    encoding="utf-8")
    stat = fake.stat()
    time.sleep(0.01)
    import os
    os.utime(fake, (stat.st_atime + 5, stat.st_mtime + 5))
    pos2, _, _, _, _b2, _w, _h = MyDaojieBase().run("测试型")
    assert pos2 == "热改后的底座。"


def test_is_changed_tracks_json_mtime_signature():
    sig1 = MyDaojieBase.IS_CHANGED("人物")
    assert isinstance(sig1, str) and "人物" in sig1
    assert MyDaojieBase.IS_CHANGED("人物") == sig1  # json 未动=同签名(吃缓存)
    # 库文件缺失才退化 nan(恒变);真源在场时签名恒为字符串
    assert isinstance(MyDaojieBase.IS_CHANGED("场景"), str)


# ── 自守:未知底座/库缺失中文 RuntimeError ─────────────────
def test_unknown_base_raises_plain_language():
    with pytest.raises(RuntimeError, match="未知道劫底座"):
        MyDaojieBase().run("不存在的型")


def test_missing_json_degrades_loudly(tmp_path, monkeypatch):
    monkeypatch.setattr(my_daojie_base, "_BASES_JSON", tmp_path / "nope.json")
    assert my_daojie_base.bases_list() == ["(道劫底座库未找到,请重启漫影或检查安装)"]
    with pytest.raises(RuntimeError, match="道劫底座库缺失"):
        MyDaojieBase().run("人物")


# ── 人物型=v2.2 新口径锚(09-18 定性切换,§一 超集解除;锚从 md 运行时切出,零硬编码)──
def test_renwu_new_framing_after_v22_switch():
    md_base = _md_section1()
    tail = "仙道古韵，气韵深远，完成度高的画作。"
    assert md_base.endswith(tail)  # 锚切分自洽:尾段确为 §一 后缀
    head = md_base[: -len(tail)]
    renwu = next(
        e["positive_text"] for e in _bases_entries() if e["zh"] == "人物")
    assert renwu.startswith("主体的单人立绘"), \
        "人物型必须以主体立绘构图句开头(09-22 v5 纯画法)"
    assert not renwu.startswith("现代修仙游戏"), "人物型回潮资产定性句"
    assert not renwu.startswith(head), "人物型回潮旧 §一 主干开头"
    assert not renwu.endswith(tail), "人物型回潮旧 §一 结尾句收尾"
    # 1004 重建:②层措辞「线随结构时粗时细」(旧锚「线有粗细变化」措辞退役)
    for kw in ("单人立绘", "取景范围完整呈现", "细线勾勒", "线随结构时粗时细"):  # 1009 并行轮:全身入画→弹性取景
        assert kw in renwu, f"人物型增量段缺 v5 画法关键词 {kw}"
    # v5「禁物象词」口径随 1004 集中化部分退役留痕:positive_text=②+锁B+④+
    # 衣物完整性拼合,锁B 行自带衣褶词汇;骨相/眉眼/发丝/衣色仍禁(未入锁B)
    for bad in ("骨相", "眉眼", "发丝", "衣色"):
        assert bad not in renwu, f"人物型残留物象词 {bad}(v5 底座禁具体画面)"


# ── 负向口径:全九型中文负面基线(1004 中文负面役)───────────
def test_all_negatives_are_chinese_baseline():
    """1004 中文负面役:negative_text 全九型中文「，」token 基线(旧「纯英文
    逗号 token 无中文残留」断言与现实相反,废止留痕;0918 md:120 同款旧口径
    归 docs 批勘正)。"""
    cjk = re.compile(r"[\u4e00-\u9fff]")
    for entry in _bases_entries():
        assert entry["negative_text"] and cjk.search(entry["negative_text"]), \
            f"底座「{entry['zh']}」negative_text 应为中文负面基线"


# ── v3 九型配方(09-19 C2 单源):lora_recipe/steps_hint/i2i_routes/postprocess ──
def _v3_entries():
    # 1004 集中化:真源家 types[] 九型(原平铺 list/daojie_bases.json 退役)
    return _bases_entries()


def test_v3_fields_present_for_all_nine_with_shape():
    """九型全量新字段在档且形状合法;老字段零丢失(v3 只增不改;1004
    正负拆开:positive/negative→positive_text/negative_text 字段名随迁)。"""
    for e in _v3_entries():
        zh = e["zh"]
        for field in ("lora_recipe", "steps_hint", "i2i_routes", "postprocess"):
            assert field in e, (zh, field)
        # 老字段仍在(v3 增量迁移的零改动面;1004 换名后的正负双字段;
        # 1008 R 批删 types[].key 冗余双键(九型 key≡zh 同值),断言随源重锚)
        for field in ("purpose", "aspect_ratio", "megapixels",
                      "positive_text", "negative_text"):
            assert field in e, (zh, field)
        assert isinstance(e["lora_recipe"], list) and e["lora_recipe"], zh
        for item in e["lora_recipe"]:
            assert set(item) >= {"file", "weight"}, (zh, item)
            assert item["file"].endswith(".safetensors"), (zh, item)
            assert "/" in item["file"], (zh, "应带子目录路径", item)
            assert isinstance(item["weight"], (int, float)) \
                and not isinstance(item["weight"], bool), (zh, item)
            assert 0 < item["weight"] <= 1.0, (zh, item)
        assert set(e["steps_hint"]) == {"fast", "quality"}, zh
        assert e["steps_hint"] == {"fast": 4, "quality": 12}, zh
        assert isinstance(e["i2i_routes"], list), zh
        for route in e["i2i_routes"]:
            assert set(route) >= {"name", "entry"} and route["entry"].endswith(".json"), \
                (zh, route)
            if "denoise" in route:
                assert 0 < route["denoise"] < 1, (zh, route)
        assert isinstance(e["postprocess"], str) and e["postprocess"], zh


def test_v3_recipe_mutex_and_rulings():
    """画风互斥(82/83/84 同型 ≤1)+ 关键定谳值(09-19 对拍定谳 §3)。"""
    ink_trio = {
        "Krea2-画风/Krea2-淡彩线描插画_v1.safetensors",
        "Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors",
        "Krea2-画风/Krea2-水彩湿画wash_v1.safetensors",
    }
    by = {e["zh"]: {i["file"]: i["weight"] for i in e["lora_recipe"]}
          for e in _v3_entries()}
    for zh, recipe in by.items():
        assert len(ink_trio & set(recipe)) <= 1, (zh, "三画风同开>1 违互斥纪律")
    # 系级三件基型(67×1+76×0.4+73×0.3);人物=09-21 0.2 手调基线(仅人物行,asianmix 0.4→0.2)
    trio = {"Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
            "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors": 0.4,
            "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors": 0.3}
    for zh in ("人物多视图", "表情差分"):
        assert by[zh] == trio, (zh, by[zh])
    # 美宣=0922 用户终审 8 件(画布 01:00 终态): asianmix→0.2,+Afterlight0.2,+Masterpiece1.0,+金雾0.8
    assert by["美宣"] == {**trio, "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors": 0.2, "Krea2-光影/Afterlight_v1.safetensors": 0.2, "Krea2-画风/Krea2-美学Masterpiece_v51.safetensors": 1.0, "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.8}, \
        by["美宣"]
    renwu = {**trio, "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors": 0.2,
            "Krea2-光影/Afterlight_v1.safetensors": 0.2}  # 09-21 用户人物行终审:+Afterlight0.2
    assert by["人物"] == {**renwu, "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.8}, \
        by["人物"]
    # 高清人脸=与人物 LoRA 同源(09-20 用户裁定「人脸与人物应相同」):三件+金雾0.8
    assert by["高清人脸"] == {**trio, "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.8}, \
        by["高清人脸"]
    # 场景=细节+金雾0.6(09-20 用户终审 87_scene_w06,墨洗出局);概念气氛同构过渡待终审
    assert by["场景"] == {  # 09-21 用户场景行终审:+Masterpiece1.0+湿画0.6+鎏金0.3
        "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
        "Krea2-画风/Krea2-美学Masterpiece_v51.safetensors": 1.0,
        "Krea2-画风/Krea2-水彩湿画wash_v1.safetensors": 0.6,
        "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors": 0.3,
        "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.6}
    assert by["概念气氛图"] == {
        "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
        "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.6}
    # 分镜=三件+金雾0.8(09-20 与人物同源裁定,淡彩撤);道具=细节+鎏金0.3(无面孔件)
    assert by["分镜剧情图"] == {**trio, "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.8}
    assert by["道具"] == {  # 0922 用户终审:撤湿画(projector 全局件升 0.5,不入配方)
        "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
        "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors": 0.2}


def test_v3_recipe_matches_lora_stack_presets():
    """三方一致之数据面:qi21_bases types[].lora_recipe ↔ daojie_lora_stack.json
    预设一比一(件↔开关↔权重;全局功能件 turbo/projector 恒挂不入配方,单列
    校验;1004 集中化:两侧同住真源家 json/,栈文件随 _BASES_JSON.parent 解析)。"""
    stack_slots = json.loads(
        (my_daojie_base._BASES_JSON.parent / "daojie_lora_stack.json")
        .read_text(encoding="utf-8"))
    for e in _v3_entries():
        zh = e["zh"]
        want = {i["file"]: i["weight"] for i in e["lora_recipe"]}
        for slot in stack_slots:
            on = slot["presets"][zh]["on"]
            weight = slot["presets"][zh]["weight"]
            if slot["key"] in ("turbo", "projector"):
                assert on, (zh, slot["key"], "全局件恒挂")
                continue
            if slot["file"] in want:
                assert on and abs(weight - want[slot["file"]]) < 1e-9, \
                    (zh, slot["key"], on, weight, want[slot["file"]])
            else:
                assert not on, (zh, slot["key"], "配方未列却点亮")


def test_v3_recipe_reader_helpers_and_fallback(tmp_path, monkeypatch):
    """lora_recipe_of/steps_hint_of:正常读出+深拷贝;缺字段回退空表/默认档
    (=回退全局链现行为的契约面);未知道型回退空。"""
    for name in EXPECTED_OPTIONS:
        recipe = my_daojie_base.lora_recipe_of(name)
        assert recipe and all("file" in i and "weight" in i for i in recipe), name
        assert my_daojie_base.steps_hint_of(name) == {"fast": 4, "quality": 12}
    # 深拷贝:改返回值不污染缓存
    r = my_daojie_base.lora_recipe_of("场景")
    r[0]["weight"] = 9.9
    assert my_daojie_base.lora_recipe_of("场景")[0]["weight"] != 9.9
    # 缺省回退:旧版 json(无 v3 字段)→ 空表+默认步数档,run 行为零变化
    # (1004 schema:dict 外壳 types[]+positive_text;art_style_base 缺席=美术风格底座空)
    fake = tmp_path / "qi21_bases.json"
    fake.write_text(json.dumps({"types": [
        {"key": "旧型", "zh": "旧型", "purpose": "p",
         "positive_text": "旧底座。", "negative_text": "test"}]},
        ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(my_daojie_base, "_BASES_JSON", fake)
    my_daojie_base._bases_cache.update(mtime=None, entries=None)
    assert my_daojie_base.lora_recipe_of("旧型") == []
    assert my_daojie_base.steps_hint_of("旧型") == {"fast": 4, "quality": 12}
    assert my_daojie_base.lora_recipe_of("不存在的型") == []
    pos, _neg, _a, _m, _b, _w, _h = MyDaojieBase().run("旧型")
    assert pos == "旧底座。"  # v3 字段缺席不影响既有装配行为


def test_width_height_override_and_formula():
    """WIDTH/HEIGHT 两出(09-20 多视图(旧名三视图) A 案转正):override 直出先例 1536×512;
    无 override 型走公式,与 [61] 逐字节一致(场景 16:9·1.5→1672×944)。
    1008 快出档缩编:多视图 override 3072×1024→2448×816、场景 4.2→1.5MP。"""
    _p, _n, _a, _m, _b, w, h = MyDaojieBase().run("人物多视图")  # 0927 改名轮(K2 侧 override 合板口径);1008 晚改名 多视图→人物多视图
    assert (w, h) == (1632, 1632), (w, h)  # 1009 四视图轮:两行两列方形 单格816px(旧六格2448×1632/三联2448×816 入 git 史)
    _p, _n, _a, _m, _b, w, h = MyDaojieBase().run("场景")
    assert (w, h) == (1672, 944), (w, h)
