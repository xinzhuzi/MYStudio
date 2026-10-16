"""The shared style must stay independent of subject facts and image type."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
SOURCE = ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'


def test_style_keeps_visual_dna_and_craft_without_subject_or_layout_rules():
    base = json.loads(SOURCE.read_text())['art_style_base']
    text = base['positive_text']
    for word in ['中国传统工笔设色', '二维手绘', '工笔', '白描', '连环画', '线条细稳连贯',
                 'Gongbi painting', 'baimiao line drawing', 'classic Chinese lianhuanhua comic',
                 'fine brushwork', 'hand-painted brushwork',
                 '清晰色面', '分染', '层层罩染', '明暗融入固有色', '多色相并陈', '协调统一', '传统色', '受控',
                 '细节密度高、笔笔可辨', 'crisp, sharp edges', 'clean, flat digital finish',
                 '数字绘画表面洁净平整（clean, flat digital finish），线条与罩染层次分明。']:
        assert word in text, word
    for word in ['衣物', '尘土', '血痕', '身体状态', '来源事实', '背景', '近景',
                 '远景', '时段', '光源', '光照', '构图', '留白']:
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
