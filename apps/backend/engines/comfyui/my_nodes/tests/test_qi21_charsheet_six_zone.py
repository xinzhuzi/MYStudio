"""Character-card layout survives direct, transparent and PE acceptance paths."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = next(p for p in Path(__file__).resolve().parents
            if (p / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json').is_file())
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
NODE = Path(__file__).resolve().parents[1] / 'nodes/my_qi21_api_pe.py'
spec = importlib.util.spec_from_file_location('charsheet_six_zone_uut', NODE)
pe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pe)


@pytest.fixture
def card(monkeypatch):
    data = json.loads(SOURCE.read_text())
    monkeypatch.setattr(pe, '_BASES_JSON', SOURCE)
    return next(t for t in data['types'] if t['zh'] == '设定卡')


def test_card_has_closed_layout_and_shared_transparent_structure(card):
    assert '完整横向角色设定板' in card['positive_text']
    assert '四幅全身人物、两幅头部近景、四幅人物细节' in card['positive_text']
    assert card['positive_text'] == card['rgba_positive']
    assert '数格' not in card['positive_text']
    assert '姿势重复' not in card['negative_text']


@pytest.mark.parametrize('transparent', [False, True])
def test_pe_off_keeps_complete_layout(card, monkeypatch, transparent):
    monkeypatch.setattr(pe, '_alive', lambda *_: pytest.fail('PE off called network'))
    result = pe.MyQi21ApiPE().rewrite(正向提示词='青年修士，玄色道袍。',
        类型句正向=card['positive_text'], 类型句负向=card['negative_text'],
        透明模式=transparent, AI扩写开关=False)
    # 1017 条件预解析:终稿=按主体落定的确定描述(模板句在 canon 不动)
    expected = pe._resolve_card_conditionals(card['positive_text'], '青年修士，玄色道袍。')
    assert expected in result['result'][0]
    assert expected != card['positive_text']  # 能力区已落定(无技能→净空+无灵兽)
    assert '主体未提供技能或术法时' not in result['result'][0]
    for zone in ('三视图三格', '四枚细节格', '底部第一区为武器展示', '底部第二区为衣料与材质',
                 '底部第三区为装备结构', '底部第四区为能力资料'):
        assert zone in result['result'][0], zone


def test_pe_layout_mutation_is_rejected(card):
    original = card['positive_text']
    assert '完整横向角色设定板' in original
    changed = original.replace('右栏第三行固定四格', '右栏第三行固定六格', 1) + '。' * 300
    violations = pe._self_check(changed, [], False, '', type_pos=card['positive_text'])
    assert any('设定卡版式' in v for v in violations)


def test_pe_preserved_layout_is_accepted(card):
    original = card['positive_text']
    violations = pe._self_check(original + '。' * 300, [], False, '', type_pos=card['positive_text'])
    assert not any('设定卡版式' in v for v in violations)


def test_non_card_layout_is_not_locked(card):
    assert not any('设定卡版式' in v for v in pe._self_check('。' * 310, [], False, '', type_pos='普通人物立绘'))


@pytest.mark.parametrize('transparent', [False, True])
@pytest.mark.parametrize('response_mode', ['preserve', 'mutate', 'retry_repair', 'unreachable'])
def test_full_rewrite_accepts_or_falls_back_without_layout_loss(card, monkeypatch, transparent, response_mode):
    """Exercise real acceptance/retry/fallback code with controlled model replies."""
    subject = '青年修士，玄色劲装。'
    layout = card['positive_text']
    # 1017 条件预解析:忠实模型回显=解析后的确定稿(PE 输入已是解析文)
    good = subject + pe._resolve_card_conditionals(layout, subject) + '衣装依来源呈现。' * 30
    bad = good.replace('底部第三区为装备结构', '底部第三区为表情差分', 1)
    calls = []

    class Reply:
        def __init__(self, content):
            self.content = content
        def read(self):
            return json.dumps({'choices': [{'message': {'content': json.dumps(
                {'rewritten_prompt': self.content}, ensure_ascii=False)}}]}).encode()

    def reply(request, **kwargs):
        calls.append(json.loads(request.data))
        content = good if response_mode == 'preserve' or (response_mode == 'retry_repair' and len(calls) > 1) else bad
        return Reply(content)

    monkeypatch.setattr(pe, '_alive', lambda *_: response_mode != 'unreachable')
    monkeypatch.setattr(pe._LAN_OPENER, 'open', reply)
    monkeypatch.setattr(pe, '_RUNTIME_KEY', '')
    result = pe.MyQi21ApiPE().rewrite(正向提示词=subject,
        类型句正向=card['positive_text'], 类型句负向='',
        透明模式=transparent, AI扩写开关=True,
        api_url='http://127.0.0.1:9', model='test-model', timeout_sec=10,
        **{'美术风格底座-负向': '模糊'})
    # 1017 条件预解析:PE 输入已是确定稿,验收基线=解析后的 layout
    resolved_layout = pe._resolve_card_conditionals(layout, subject)
    assert ''.join(resolved_layout.split()) in ''.join(result['result'][0].split())
    assert result['ui']['api_pe_pos'][0] == result['result'][0]
    if response_mode == 'preserve':
        assert len(calls) == 1
        assert ''.join(result['result'][0].split()) == ''.join(good.split())
    elif response_mode == 'retry_repair':
        assert len(calls) == 2
        assert ''.join(result['result'][0].split()) == ''.join(good.split())
    elif response_mode == 'mutate':
        assert len(calls) == 2
        assert '拒收回退' in result['ui']['api_pe_status'][0]
    else:
        assert calls == []


@pytest.mark.parametrize('transparent', [False, True])
def test_card_rejects_loss_of_later_layout_paragraph(monkeypatch, transparent):
    layout = '同一角色的完整横向角色设定板。\n底部第四区为能力资料，缺失能力时保留净空。'
    monkeypatch.setattr(pe, '_load_bases_node', lambda: {'types': [
        {'zh': '设定卡', 'positive_text': layout, 'rgba_positive': layout}]})
    changed = layout.splitlines()[0] + '衣装依来源呈现。' * 50
    assert any('设定卡版式' in v for v in pe._self_check(
        changed, [], transparent, '', type_pos=layout))


def test_full_board_defaults_and_each_detail_position(card):
    assert card['rgba_default'] is False
    assert card['aspect_ratio'] == '21:9 (Ultrawide)'
    assert card['megapixels'] == 3.0
    for text in ['完整横向角色设定板', '左栏下方为人物资料与配色方案',
                 '右栏第三行固定四格', '单眼与眉形特写', '腕部与袖口结构特写',
                 '底部第一区', '底部第二区', '底部第三区', '底部第四区']:
        assert text in card['positive_text']
