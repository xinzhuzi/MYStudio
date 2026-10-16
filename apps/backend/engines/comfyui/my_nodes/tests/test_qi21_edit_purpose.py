"""Local edits must preserve reference composition, lighting and rendering."""
import pytest
from engines.comfyui.my_nodes.nodes.my_qi21_prompt_assembly import MyQi21PromptAssembly


def test_local_edit_does_not_inherit_asset_layout_style_or_negatives():
    text, negative = MyQi21PromptAssembly().assemble(
        主体句='将右肩改为一道裂痕。保持其他内容不变。', BASE='四视图设定图',
        BASE负面='脏污', 锁层A全文='均匀平光浅底', 组装用途='局部编辑')
    assert text == '将右肩改为一道裂痕。保持其他内容不变。'
    assert negative == ''


def test_style_transfer_keeps_edit_and_adds_only_requested_rendering():
    text, _ = MyQi21PromptAssembly().assemble(
        主体句='将画中人物改绘为工笔画。保持构图和姿态。',
        BASE='四视图设定图', 锁层A全文='细线矿物罩染', 组装用途='画风转换')
    assert text == '将画中人物改绘为工笔画。保持构图和姿态。\n细线矿物罩染'
    assert '四视图' not in text


def test_old_callers_keep_asset_generation_default():
    text, _ = MyQi21PromptAssembly().assemble(主体句='角色', BASE='人物', 锁层A全文='画法')
    assert text == '主体句:角色\n类型句:人物\n画法'


def test_unknown_purpose_rejected_instead_of_silently_regenerating():
    with pytest.raises(ValueError, match='组装用途'):
        MyQi21PromptAssembly().assemble(组装用途='unknown')
