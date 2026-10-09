"""qi21_prompt_layer_scan 测试锚(10-09-qi21-prompt-layer-conflict Phase 1)。

合成数据驱动,不读真源:锁三类违规判定(对立词对 AC1 / 元语言质量词 AC4 /
透明残留 AC3)各一正一反,以及撞词报告与 exit 码口径。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import qi21_prompt_layer_scan as scan  # noqa: E402

ASB_DIRTY = {
    "positive_text": "旧全文。",
    "positive_style_text": "美术风格底座：工笔线描。",
    "positive_ground_text": "非焦点区域低频干净；浅净哑光底在非主体区域的每层色罩下保持可见；色相分明不互混。",
    "negative_text": "照片,文字",
}
ASB_CLEAN = {
    "positive_text": "旧全文。",
    "positive_style_text": "美术风格底座：工笔线描。",
    "positive_ground_text": "各色面成整块，边界稳定，色相分明。",
    "negative_text": "照片,文字",
}
SCENE = {"zh": "场景", "rgba_default": False, "negative_text": "人物",
         "positive_text": "空镜场景；环境主体达到完整细节渲染；墨与色相互接晕；环境色面铺满画幅。"}
SCENE_CLEAN = {"zh": "场景", "rgba_default": False, "negative_text": "人物",
               "positive_text": "空镜场景；中景物件件件可辨可数；墨色分层晕染。"}
PROP = {"zh": "道具", "rgba_default": True, "negative_text": "文字",
        "positive_text": "图为带透明通道的道具素材，背景透明。单件道具居中。",
        "rgba_positive": "随主体句逐格点位指定的情绪变化。"}


def _rules(found):
    return {(f["type"], f["rule"]) for f in found}


def test_conflict_pairs_hit_on_dirty_base():
    found = scan.scan_conflicts({"art_style_base": ASB_DIRTY, "types": [SCENE]})
    rules = _rules(found)
    assert ("场景", "细节预算对冲") in rules
    assert ("场景", "底色可见对冲铺满") in rules
    assert ("场景", "不互混对冲接晕") in rules


def test_conflict_pairs_zero_on_clean_base():
    found = scan.scan_conflicts({"art_style_base": ASB_CLEAN, "types": [SCENE_CLEAN]})
    assert found == []


def test_meta_and_quality_words_hit():
    asb = dict(ASB_CLEAN, positive_style_text="第一眼是现代游戏；成片质量：生产级。")
    found = scan.scan_conflicts({"art_style_base": asb, "types": [PROP]})
    hits = {f["detail"] for f in found if f["rule"] == "元语言/质量词"}
    assert {"第一眼", "成片质量", "生产级", "主体句"} <= hits


def test_transparent_residue_hits_without_strip_and_clears_with_strip():
    data = {"art_style_base": ASB_CLEAN, "types": [PROP]}
    raw = scan.scan_conflicts(data, strip=lambda s: s)
    assert ("道具", "透明残留") in _rules(raw)
    cleaned = scan.scan_conflicts(
        data, strip=lambda s: s.replace("图为带透明通道的道具素材，背景透明。", ""))
    assert ("道具", "透明残留") not in _rules(cleaned)


def test_pe_input_transparent_excludes_ground():
    text = scan.pe_input(PROP, ASB_DIRTY, strip=lambda s: s)
    assert "工笔线描" in text and "低频" not in text
    text2 = scan.pe_input(SCENE, ASB_DIRTY, strip=lambda s: s)
    assert "低频" in text2 and text2.startswith("类型句:")


def test_clash_report_counts_per_type():
    rep = scan.scan_clash({"art_style_base": ASB_CLEAN, "types": [SCENE]},
                          subjects={"场景": "山门前无人物，只有石阶。"})
    assert rep["场景"]["count"] == 1 and rep["场景"]["hits"] == ["正负撞词:人物"]


def test_exit_code_two_on_violations(capsys):
    assert scan.exit_code([{"type": "场景", "rule": "x", "detail": "y"}]) == 2
    assert scan.exit_code([]) == 0
