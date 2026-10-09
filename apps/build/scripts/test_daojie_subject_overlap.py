"""daojie_subject_overlap 主体句规范三项自查测试锚(10-09-qi21-prompt-layer-conflict D11)。

合成型条目驱动:场景方位短语 8–14、透明型零环境/背景词、不撞本型负向词;
原有 ≥10 字重叠判定不在此锁(行为未改)。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import daojie_subject_overlap as ov  # noqa: E402

SCENE = {"zh": "场景", "rgba_default": False, "negative_text": "人物,文字"}
PROP = {"zh": "道具", "rgba_default": True, "negative_text": "手持,文字"}
RICH_SCENE = ("画面左上角挂一盏灯，右上角垂柳枝，左下角石阶三级，右下角青苔，"
              "画面中央立香炉，左侧木栏，右侧石狮，上方檐角，前景落叶，远景山影。")


def test_count_positions_counts_each_phrase():
    assert ov.count_positions(RICH_SCENE) == 10
    assert ov.count_positions("祭坛深藏谷底。") == 0


def test_scene_position_range_enforced():
    assert ov.subject_lint(RICH_SCENE, SCENE) == []
    assert any("方位短语" in v for v in ov.subject_lint("祭坛深藏谷底。", SCENE))


def test_transparent_type_rejects_env_and_background_words():
    v = ov.subject_lint("青铜剑一柄，背景远山云雾。", PROP)
    assert "透明型环境词:背景" in v and "透明型环境词:远山" in v
    assert ov.subject_lint("青铜剑一柄，剑格兽首衔环。", PROP) == []


def test_clash_with_own_negative_only():
    v = ov.subject_lint("青铜剑一柄，剑身刻文字。", PROP)
    assert "正负撞词:文字" in v
    # 非透明型不查环境词,只查本型负向
    assert ov.subject_lint(RICH_SCENE + "远处有人物。", SCENE) == ["正负撞词:人物"]


def test_non_scene_opaque_type_skips_position_check():
    person = {"zh": "人物", "rgba_default": False, "negative_text": ""}
    assert ov.subject_lint("青年刀修立于石阶。", person) == []
