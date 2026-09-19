# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""MyDaojieBase 契约测试(道劫底座节点,09-18 用户令;与 test_my_styles.py
同目录同纪律,源码位 sidecar 零引擎依赖)。

锁:注册面/COMBO 九项有序+默认钉死「人物」/装配语义(底座在前+主体句
零分隔符直拼、留空=恒等纯底座、句号自足收尾)/负向 token 去重合并
(复用 my_styles._merge_negative)/分辨率两出 aspect+mp 随型现读 json、
缺字段回退 1:1 (Square)/4.2+控制台警告/mtime 失效热改/未知底座中文
RuntimeError/人物型=v2.2 新口径锚(09-18 定性切换,§一 超集解除,锚从
md 运行时切出防旧口径回潮,零硬编码)/v3 九型配方(lora_recipe/
steps_hint/i2i_routes/postprocess:九型全量形状+定谳值+栈预设一比一+
装机家存在性+缺省回退,09-19 C2 单源)。
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
    "人物", "场景", "道具", "美宣", "三视图",
    "高清人脸", "分镜剧情图", "表情差分", "概念气氛图",
]


@pytest.fixture(autouse=True)
def _reset_bases_cache():
    """测试间清模块级缓存,免 monkeypatch 改 _BASES_JSON 后读到旧缓存。"""
    my_daojie_base._bases_cache.update(mtime=None, entries=None)
    yield
    my_daojie_base._bases_cache.update(mtime=None, entries=None)


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
    assert MyDaojieBase.CATEGORY == "my"
    assert NODE_DISPLAY_NAME_MAPPINGS["MyDaojieBase"] == "漫影 道劫底座"
    # 设计裁定:新节点无存量工作流,不建 Manying 旧名别名
    assert "ManyingDaojieBase" not in NODE_CLASS_MAPPINGS


# ── 形状:COMBO 九项与 json 一致且有序+默认钉死+forceInput ──
def test_combo_nine_options_in_json_order_with_pinned_default():
    spec = MyDaojieBase.INPUT_TYPES()
    assert set(spec["required"]) == {"base"}
    combo = spec["required"]["base"]
    assert isinstance(combo[0], list)
    assert combo[0] == EXPECTED_OPTIONS  # json 条目顺序,不 sorted
    assert combo[1]["default"] == "人物"  # DEFAULT_BASE 钉死
    assert set(spec["optional"]) == {"positive", "negative"}
    for key in ("positive", "negative"):
        slot = spec["optional"][key]
        assert slot[0] == "STRING"
        assert set(slot[1]) == {"forceInput"}  # 多键(default/multiline)会生文本 widget
        assert slot[1]["forceInput"] is True
    assert MyDaojieBase.RETURN_TYPES == ("STRING", "STRING", "COMBO", "FLOAT", "COMBO")
    assert MyDaojieBase.RETURN_NAMES == ("positive", "negative", "aspect", "megapixels", "base")
    assert MyDaojieBase.FUNCTION == "run"


# ── 装配语义:底座在前+主体句零分隔符直拼;留空=恒等纯底座 ──
def test_run_assembles_base_first_then_subject_verbatim():
    base_positive = next(
        e["positive"] for e in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
        if e["zh"] == "人物")
    pos, _neg, _aspect, _mp, _base = MyDaojieBase().run("人物", positive="  一位女修士，青年金丹期。 ")
    # 底座在前、主体句 strip 后原样拼接、零分隔符(底座以全角句号自足收尾)
    assert pos == base_positive + "一位女修士，青年金丹期。"


def test_run_empty_subject_is_identity_pure_base():
    base_positive = next(
        e["positive"] for e in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
        if e["zh"] == "场景")
    pos, neg, aspect, mp, base_out = MyDaojieBase().run("场景")
    assert base_out == "场景"  # 09-19 第五出=型直通
    assert pos == base_positive
    assert pos.endswith("。")  # 底座全文句号自足收尾(直拼无分隔符的前提)
    assert aspect == "16:9 (Widescreen)" and mp == 4.2  # 分辨率两出随型
    pos2, _n2, _a2, _m2, _b2 = MyDaojieBase().run("场景", positive=None, negative=None)
    assert pos2 == base_positive


def test_run_all_options_produce_nonempty_outputs():
    for name in EXPECTED_OPTIONS:
        pos, neg, aspect, mp, base_out = MyDaojieBase().run(name)
        assert base_out == name  # 09-19 第五出=型直通(驱动按型 LoRA)
        # 09-18 v2.2 定性切换:SD 质量标签串已废,九型一律以定性句开头+句号自足收尾
        assert pos and pos.startswith("现代修仙游戏")
        assert pos.endswith("。")
        assert neg and "text" in neg  # 九型负面均为英文 token 基线
        # 09-18 分辨率两出:九型 aspect 一律官方枚举串;mp 道具/高清人脸 1.0
        # (09-19 裁定出 1024×1024,节点口径 1.0 MP 精确命中)、其余一律 4.2
        assert aspect.endswith(")") and ":" in aspect
        assert mp == (1.0 if name in ("道具", "高清人脸") else 4.2)


# ── 负向:token 去重合并(复用 my_styles._merge_negative)──
def test_run_negative_merges_and_dedupes_tokens():
    base_negative = next(
        e["negative"] for e in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
        if e["zh"] == "人物")
    first_token = base_negative.split(",")[0].strip()
    # 用户 token "text" 恰也在人物基线中——整 token 相等即去重
    _, neg, _, _, _b = MyDaojieBase().run("人物", negative="text")
    assert neg.startswith("text, ")  # 用户段在前
    pieces = [t.strip() for t in neg.split(",")]
    assert pieces.count("text") == 1  # 基线内的重复 token 被去重
    # 用户给基线首 token:同样只保留一份,且顺序=用户在前
    _, neg2, _, _, _b2 = MyDaojieBase().run("人物", negative=f"zzz, {first_token}")
    pieces2 = [t.strip() for t in neg2.split(",")]
    assert pieces2[:2] == ["zzz", first_token]
    assert pieces2.count(first_token) == 1


def test_merge_negative_reused_from_my_styles():
    # 防漂移:节点负向合并必须就是 my_styles 的那份实现(权重组不切)
    from engines.comfyui.my_nodes.nodes.my_styles import _merge_negative
    assert my_daojie_base._merge_negative is _merge_negative
    merged = _merge_negative("a, (worst quality, low quality:1.4)", "a, b")
    assert merged == "a, (worst quality, low quality:1.4), b"


# ── 热改:mtime 失效(json 文案改=下次 run 即新文)───────────
def test_json_mtime_invalidation_hot_edit(tmp_path, monkeypatch, capsys):
    fake = tmp_path / "daojie_bases.json"
    fake.write_text(json.dumps([
        {"key": "测试型", "zh": "测试型", "purpose": "p",
         "positive": "测试底座。", "negative": "test"}], ensure_ascii=False),
        encoding="utf-8")
    monkeypatch.setattr(my_daojie_base, "_BASES_JSON", fake)
    assert my_daojie_base.bases_list() == ["测试型"]
    pos, _, aspect, mp, _base = MyDaojieBase().run("测试型")
    assert pos == "测试底座。"
    # 缺分辨率字段:回退 1:1 (Square)/4.2(枚举逐字串)+控制台中文警告
    assert aspect == "1:1 (Square)"
    assert mp == 4.2
    warned = capsys.readouterr().out
    assert "缺 aspect_ratio 字段" in warned and "缺 megapixels 字段" in warned
    assert "回退" in warned
    # 热改:同路径改内容+推 mtime(免文件系统时间粒度),现读即生效
    entries = json.loads(fake.read_text(encoding="utf-8"))
    entries[0]["positive"] = "热改后的底座。"
    fake.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    stat = fake.stat()
    time.sleep(0.01)
    import os
    os.utime(fake, (stat.st_atime + 5, stat.st_mtime + 5))
    pos2, _, _, _, _b2 = MyDaojieBase().run("测试型")
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
        e["positive"] for e in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
        if e["zh"] == "人物")
    assert renwu.startswith("现代修仙游戏的角色立绘资产"), \
        "人物型必须以 v2.2 定性句开头(现代游戏资产载体)"
    assert not renwu.startswith(head), "人物型回潮旧 §一 主干开头"
    assert not renwu.endswith(tail), "人物型回潮旧 §一 结尾句收尾"
    for kw in ("单人立像", "六成", "两至四条"):
        assert kw in renwu, f"人物型增量段缺共性关键词 {kw}"


# ── 负向口径:全九型纯英文逗号 token(无中文残留)───────────
def test_all_negatives_are_english_comma_tokens():
    cjk = re.compile(r"[\u4e00-\u9fff]")
    for entry in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8")):
        assert not cjk.search(entry["negative"]), \
            f"底座「{entry['zh']}」negative 残留中文"


# ── v3 九型配方(09-19 C2 单源):lora_recipe/steps_hint/i2i_routes/postprocess ──
def _v3_entries():
    return json.loads(
        my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))


def test_v3_fields_present_for_all_nine_with_shape():
    """九型全量新字段在档且形状合法;老字段零丢失(v3 只增不改)。"""
    for e in _v3_entries():
        zh = e["zh"]
        for field in ("lora_recipe", "steps_hint", "i2i_routes", "postprocess"):
            assert field in e, (zh, field)
        # 老字段仍在(v3 增量迁移的零改动面)
        for field in ("key", "purpose", "aspect_ratio", "megapixels",
                      "positive", "negative"):
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
    # 人物系五型=现值三件(67×1+76×0.4+73×0.3),画风槽不点亮
    trio = {"Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
            "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors": 0.4,
            "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors": 0.3}
    for zh in ("人物", "美宣", "三视图", "高清人脸", "表情差分"):
        assert by[zh] == trio, (zh, by[zh])
    # 场景=细节+墨洗0.8+金雾0.6(免鎏金);概念气氛=细节+墨洗0.7+金雾0.6
    assert by["场景"] == {
        "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
        "Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors": 0.8,
        "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.6}
    assert by["概念气氛图"] == {
        "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
        "Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors": 0.7,
        "Krea2-画风/金雾仙侠GoldenMisty.safetensors": 0.6}
    # 分镜=三件+淡彩线描0.5;道具=细节+鎏金0.3(无面孔件)
    assert by["分镜剧情图"]["Krea2-画风/Krea2-淡彩线描插画_v1.safetensors"] == 0.5
    assert by["道具"] == {
        "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors": 1.0,
        "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors": 0.3}


def test_v3_recipe_matches_lora_stack_presets():
    """三方一致之数据面:bases.lora_recipe ↔ daojie_lora_stack.json 预设一比一
    (件↔开关↔权重;全局功能件 turbo/projector 恒挂不入配方,单列校验)。"""
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


def test_v3_recipe_files_exist_in_engine_home_when_present():
    """文件存在性对拍装机家(loras 实盘);无引擎家=跳过(repo 侧零引擎依赖)。"""
    home = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
            / "models/loras")
    if not home.is_dir():
        return
    for e in _v3_entries():
        for item in e["lora_recipe"]:
            assert (home / item["file"]).is_file(), \
                f"「{e['zh']}」配方件不在引擎家: {item['file']}"


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
    fake = tmp_path / "daojie_bases.json"
    fake.write_text(json.dumps([
        {"key": "旧型", "zh": "旧型", "purpose": "p", "positive": "旧底座。",
         "negative": "test"}], ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(my_daojie_base, "_BASES_JSON", fake)
    my_daojie_base._bases_cache.update(mtime=None, entries=None)
    assert my_daojie_base.lora_recipe_of("旧型") == []
    assert my_daojie_base.steps_hint_of("旧型") == {"fast": 4, "quality": 12}
    assert my_daojie_base.lora_recipe_of("不存在的型") == []
    pos, _neg, _a, _m, _b = MyDaojieBase().run("旧型")
    assert pos == "旧底座。"  # v3 字段缺席不影响既有装配行为
