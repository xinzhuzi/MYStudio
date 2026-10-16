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
    assert '固定六个图像区' in card['positive_text']
    assert '四幅全身像、一幅面部近景和一幅局部特写' in card['positive_text']
    assert card['positive_text'] == card['rgba_positive']
    assert '数格' not in card['positive_text']
    assert '姿势重复' not in card['negative_text']


@pytest.mark.parametrize('transparent', [False, True])
def test_pe_off_keeps_complete_layout(card, monkeypatch, transparent):
    monkeypatch.setattr(pe, '_alive', lambda *_: pytest.fail('PE off called network'))
    result = pe.MyQi21ApiPE().rewrite(正向提示词='青年修士，玄色道袍。',
        类型句正向=card['positive_text'], 类型句负向=card['negative_text'],
        透明模式=transparent, AI扩写开关=False)
    assert card['positive_text'].splitlines()[0] in result['result'][0]


def test_pe_layout_mutation_is_rejected(card):
    original = card['positive_text'].splitlines()[0]
    assert '固定六个图像区' in original
    changed = original.replace('固定六个图像区', '固定九个图像区', 1) + '。' * 300
    violations = pe._self_check(changed, [], False, '', type_pos=card['positive_text'])
    assert any('设定卡版式' in v for v in violations)


def test_pe_preserved_layout_is_accepted(card):
    original = card['positive_text'].splitlines()[0]
    violations = pe._self_check(original + '。' * 300, [], False, '', type_pos=card['positive_text'])
    assert not any('设定卡版式' in v for v in violations)


def test_non_card_layout_is_not_locked(card):
    assert not any('设定卡版式' in v for v in pe._self_check('。' * 310, [], False, '', type_pos='普通人物立绘'))


@pytest.mark.parametrize('transparent', [False, True])
@pytest.mark.parametrize('response_mode', ['preserve', 'mutate', 'retry_repair', 'unreachable'])
def test_full_rewrite_accepts_or_falls_back_without_layout_loss(card, monkeypatch, transparent, response_mode):
    """Exercise real acceptance/retry/fallback code with controlled model replies."""
    subject = '青年修士，玄色劲装。'
    layout = card['positive_text'].splitlines()[0]
    good = subject + layout + '衣装依来源呈现。' * 30
    bad = good.replace('固定六个图像区', '固定九个图像区', 1)
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
    assert layout in result['result'][0]
    assert result['ui']['api_pe_pos'][0] == result['result'][0]
    if response_mode == 'preserve':
        assert len(calls) == 1
        assert result['result'][0] == good
    elif response_mode == 'retry_repair':
        assert len(calls) == 2
        assert result['result'][0] == good
    elif response_mode == 'mutate':
        assert len(calls) == 2
        assert '拒收回退' in result['ui']['api_pe_status'][0]
    else:
        assert calls == []
