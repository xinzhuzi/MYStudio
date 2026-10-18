"""The shared style must stay independent of subject facts and image type."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
SOURCE = ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'


def test_style_keeps_visual_dna_and_craft_without_subject_or_layout_rules():
    base = json.loads(SOURCE.read_text())['art_style_base']
    text = base['positive_text']
    assert text.startswith('美术风格底座：国风二维动漫手绘插画。')
    assert '赛璐璐' not in base['negative_text'] and '动漫' not in base['negative_text']
    for word in ['二维动漫', '工笔', '白描', '连环画', '线条细稳连贯',
                 '平整分层的清晰色面', '简洁明暗色块', '主色统领', '辅色呼应',
                 '点睛色突出', '数字绘画表面洁净平整']:
        assert word in text, word
    for word in ['衣物', '尘土', '血痕', '身体状态', '来源事实', '背景', '近景',
                 '远景', '时段', '光源', '光照', '构图', '布局', '留白']:
        assert word not in text, word
    assert 'positive_style_text' not in base
    assert 'positive_ground_text' not in base
    assert 'rgba_text' not in base


def test_old_piece_display_values_never_change_style_output(tmp_path, monkeypatch, capsys):
    node_file = Path(__file__).resolve().parents[1]/'nodes/my_qi21_bases_text.py'
    spec = importlib.util.spec_from_file_location('qi21_style_boundary_node', node_file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path/'qi21_bases.json'
    source.write_text(json.dumps({'art_style_base': {
        'positive_text': '工笔白描。', 'positive_style_text': '工笔白描。',
        'positive_ground_text': '', 'rgba_text': 'transparent', 'negative_text': 'blur'
    }}, ensure_ascii=False))
    monkeypatch.setattr(module, '_BASES_JSON', source)
    monkeypatch.setattr(module, '_cache', {'mtime': None, 'data': None})
    out = module.MyQi21美术风格底座().output()
    assert out['result'] == ('工笔白描。', 'blur')
    assert 'bases_text_ground' not in out['ui']
    assert 'bases_text_protocol' not in out['ui']
    assert '缺拆分字段' not in capsys.readouterr().out
