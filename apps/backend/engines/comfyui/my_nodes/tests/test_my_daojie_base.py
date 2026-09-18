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
md 运行时切出防旧口径回潮,零硬编码)。
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
    assert MyDaojieBase.RETURN_TYPES == ("STRING", "STRING", "COMBO", "FLOAT")
    assert MyDaojieBase.RETURN_NAMES == ("positive", "negative", "aspect", "megapixels")
    assert MyDaojieBase.FUNCTION == "run"


# ── 装配语义:底座在前+主体句零分隔符直拼;留空=恒等纯底座 ──
def test_run_assembles_base_first_then_subject_verbatim():
    base_positive = next(
        e["positive"] for e in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
        if e["zh"] == "人物")
    pos, _neg, _aspect, _mp = MyDaojieBase().run("人物", positive="  一位女修士，青年金丹期。 ")
    # 底座在前、主体句 strip 后原样拼接、零分隔符(底座以全角句号自足收尾)
    assert pos == base_positive + "一位女修士，青年金丹期。"


def test_run_empty_subject_is_identity_pure_base():
    base_positive = next(
        e["positive"] for e in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
        if e["zh"] == "场景")
    pos, neg, aspect, mp = MyDaojieBase().run("场景")
    assert pos == base_positive
    assert pos.endswith("。")  # 底座全文句号自足收尾(直拼无分隔符的前提)
    assert aspect == "16:9 (Widescreen)" and mp == 4.2  # 分辨率两出随型
    pos2, _n2, _a2, _m2 = MyDaojieBase().run("场景", positive=None, negative=None)
    assert pos2 == base_positive


def test_run_all_options_produce_nonempty_outputs():
    for name in EXPECTED_OPTIONS:
        pos, neg, aspect, mp = MyDaojieBase().run(name)
        # 09-18 v2.2 定性切换:SD 质量标签串已废,九型一律以定性句开头+句号自足收尾
        assert pos and pos.startswith("现代修仙游戏")
        assert pos.endswith("。")
        assert neg and "text" in neg  # 九型负面均为英文 token 基线
        # 09-18 分辨率两出:九型 aspect 一律官方枚举串、mp 一律 4.2
        assert aspect.endswith(")") and ":" in aspect
        assert mp == 4.2


# ── 负向:token 去重合并(复用 my_styles._merge_negative)──
def test_run_negative_merges_and_dedupes_tokens():
    base_negative = next(
        e["negative"] for e in json.loads(
            my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
        if e["zh"] == "人物")
    first_token = base_negative.split(",")[0].strip()
    # 用户 token "text" 恰也在人物基线中——整 token 相等即去重
    _, neg, _, _ = MyDaojieBase().run("人物", negative="text")
    assert neg.startswith("text, ")  # 用户段在前
    pieces = [t.strip() for t in neg.split(",")]
    assert pieces.count("text") == 1  # 基线内的重复 token 被去重
    # 用户给基线首 token:同样只保留一份,且顺序=用户在前
    _, neg2, _, _ = MyDaojieBase().run("人物", negative=f"zzz, {first_token}")
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
    pos, _, aspect, mp = MyDaojieBase().run("测试型")
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
    pos2, _, _, _ = MyDaojieBase().run("测试型")
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
