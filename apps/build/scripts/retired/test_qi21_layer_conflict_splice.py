"""qi21_layer_conflict_splice 锁(10-09-qi21-prompt-layer-conflict Phase 3)。"""
import copy
import json

import pytest

import qi21_layer_conflict_splice as sp


def _fixture():
    asb_style = "风格头经现代游戏美术设计重组" + sp.D5_OLD + "工笔。" + sp.QUALITY_OLD + "罩染通透。"
    asb_ground = "底色。" + sp.D3_OLD + "线条深色。" + sp.D2_OLD
    types = [
        {"zh": "人物", "positive_text": "甲" + sp.C_OPS[0][2] + "乙" + sp.C_OPS[1][2]},
        {"zh": "场景", "positive_text": sp.B_OLD + "后半不动。\n主体设色配比：…"},
        {"zh": "道具", "rgba_default": True, "positive_text": "器物", "positive_background_text": ""},
        {"zh": "美宣", "positive_text": sp.C_OPS[2][2] + "；" + sp.C_OPS[3][2]},
        {"zh": "人物多视图", "rgba_default": True, "positive_text": "四格", "positive_background_text": "x"},
        {"zh": "高清人脸", "rgba_default": True, "positive_text": sp.C_OPS[4][2], "positive_background_text": "x"},
        {"zh": "表情差分", "rgba_default": True, "positive_text": sp.C_OPS[5][2] + sp.C_OPS[6][2],
         "rgba_positive": "九格" + sp.C_OPS[7][2], "positive_background_text": "x"},
    ]
    return {
        "art_style_base": {"positive_text": asb_style + "\n" + asb_ground,
                           "positive_style_text": asb_style, "positive_ground_text": asb_ground,
                           "negative_text": "不动"},
        "types": types,
        "layer_contract": {"updated": "2026-10-04",
                           "assembly_order": {"positive": ["主体句"], "negative": ["neg"]}},
    }


@pytest.mark.parametrize("batch", list(sp.BATCHES))
def test_batch_touches_only_whitelist(batch):
    before = _fixture()
    after = sp.apply_batch(copy.deepcopy(before), batch)
    changed = sp.diff_paths(before, after)
    assert changed, batch
    assert changed <= sp.whitelist(batch), changed - sp.whitelist(batch)


def test_batch_a_removes_conflict_words_keeps_anti_grey_lines():
    asb = sp.apply_batch(_fixture(), "A")["art_style_base"]
    for k in sp.ASB_FIELDS:
        for w in ("第一眼", "成片质量", "生产级", "每层色罩下保持可见", "低频"):
            assert w not in asb[k], (k, w)
    assert "罩染通透" in asb["positive_style_text"]
    assert sp.D2_NEW in asb["positive_ground_text"]


def test_missing_anchor_raises():
    d = _fixture()
    d["types"][1]["positive_text"] = "被别人改过的场景句"
    with pytest.raises(sp.AnchorError):
        sp.apply_batch(d, "B")


def test_duplicate_anchor_raises():
    d = _fixture()
    d["types"][0]["positive_text"] += sp.C_OPS[0][2]
    with pytest.raises(sp.AnchorError):
        sp.apply_batch(d, "C")


def test_reapply_is_rejected_not_double_spliced():
    d = sp.apply_batch(_fixture(), "C")
    with pytest.raises(sp.AnchorError):
        sp.apply_batch(d, "C")


def test_batch_d_deletes_bg_keys_and_keeps_negative_order():
    d = sp.apply_batch(_fixture(), "D")
    assert all("positive_background_text" not in t for t in d["types"])
    order = d["layer_contract"]["assembly_order"]
    assert order["negative"] == ["neg"] and order["positive"] == sp.ASSEMBLY_POSITIVE


def test_diff_paths_flags_non_whitelisted_change():
    before = _fixture()
    after = copy.deepcopy(before)
    after["art_style_base"]["negative_text"] = "被动了"
    assert ("art_style_base", "negative_text") in sp.diff_paths(before, after)


def test_dump_round_trip_is_byte_identical():
    raw = sp.BASES.read_text(encoding="utf-8")
    assert sp.dump(json.loads(raw)) == raw


@pytest.mark.parametrize("batch", list(sp.BATCHES))
def test_live_json_is_wholly_before_or_after(batch):
    """真源每批要么全旧锚(未落)要么全新句(已落),不许半截。"""
    state = sp.batch_state(json.loads(sp.BASES.read_text(encoding="utf-8")), batch)
    assert state in ("before", "after"), (batch, state)
