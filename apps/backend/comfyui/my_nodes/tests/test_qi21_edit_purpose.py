"""Local edits must preserve reference composition, lighting and rendering."""
import pytest
from comfyui.my_nodes.nodes.my_qi21_prompt_assembly import MyQi21PromptAssembly


def test_local_edit_does_not_inherit_asset_layout_style_or_negatives():
    text, negative = MyQi21PromptAssembly().assemble(
        主体句='将右肩改为一道裂痕。保持其他内容不变。', BASE='四视图设定图',
        BASE负面='脏污', 锁层A全文='均匀平光浅底', 组装用途='自由出图')
    assert text == '将右肩改为一道裂痕。保持其他内容不变。'
    assert negative == ''


def test_style_transfer_keeps_edit_and_adds_only_requested_rendering():
    text, _ = MyQi21PromptAssembly().assemble(
        主体句='将画中人物改绘为工笔画。保持构图和姿态。',
        BASE='四视图设定图', 锁层A全文='细线矿物罩染', 组装用途='道劫美术风格转换')
    assert text == '将画中人物改绘为工笔画。保持构图和姿态。\n细线矿物罩染'
    assert '四视图' not in text


def test_old_callers_keep_asset_generation_default():
    text, _ = MyQi21PromptAssembly().assemble(主体句='角色', BASE='人物', 锁层A全文='画法')
    assert text == '画法\n类型句:人物\n主体句:角色'


def test_unknown_purpose_rejected_instead_of_silently_regenerating():
    with pytest.raises(ValueError, match='组装用途'):
        MyQi21PromptAssembly().assemble(组装用途='unknown')


# ── 1016 用户令「真关掉底座」开关:组装用途第四值「无底座出图」──────────────
# 背景:静音 [4032]/清 BASE 只会触发热读兜底(1001 S8 L-1 剂),底座恒回潮;
# 此值=显式声明无底座层:正向=主体句+类型句 两段,负向=型负面+主体句负面
# (美术风格底座正/负 全不入场,含 mtime 热读兜底路径)。

def test_no_base_mode_drops_style_from_positive_and_negative():
    text, negative = MyQi21PromptAssembly().assemble(
        主体句='崖顶青年', BASE='人物型文', BASE负面='脏污',
        主体句负面='多余手指', 锁层A全文='美术风格底座全文', 组装用途='无底座出图')
    assert text == '类型句:人物型文\n主体句:崖顶青年'
    assert '美术风格底座全文' not in text
    # 负向=型负面+主体句负面,底座负面(真源热读,含「模糊」族)不入场
    assert negative == '脏污, 多余手指'
    base_neg = MyQi21PromptAssembly().assemble(
        主体句='x', BASE='人物型文', BASE负面='脏污', 组装用途='道劫美术类型')[1]
    assert base_neg != negative  # 默认路径含底座负面,裸测路径不含


def test_no_base_mode_with_empty_base_stays_subject_only_no_fallback():
    text, negative = MyQi21PromptAssembly().assemble(
        主体句='崖顶青年', BASE='', 锁层A全文='美术风格底座全文', 组装用途='无底座出图')
    # 空 BASE 也不回落「主体句+底座」两段拼——裸测语义压过 S8 L-1 兜底
    assert text == '主体句:崖顶青年'
    assert '美术风格底座全文' not in text


def test_no_base_mode_registered_in_choices():
    choices = MyQi21PromptAssembly.INPUT_TYPES()["optional"]["组装用途"][0]
    assert "无底座出图" in choices
