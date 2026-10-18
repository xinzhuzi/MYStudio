"""Style is drawing language; type owns background, light and source state."""
import importlib.util
import json
from pathlib import Path
import pytest
from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as pe
from engines.comfyui.my_nodes.nodes import my_qi21_prompt_assembly as assembly

ROOT = Path(__file__).resolve().parents[6]
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
SPEC = importlib.util.spec_from_file_location('qi21_style_type_node', Path(__file__).resolve().parents[1] / 'nodes/my_qi21_bases_text.py')
bt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bt)
LEGACY = '【风格工艺件】铁线描与矿物罩染。\n【底色背景件】旧背景，强烈顶光，鲜血。\n【透明承载件】old transparent\n【负向词表】油亮高光'


def test_style_schema_and_node_have_no_background_or_transparency():
    style = json.loads(SOURCE.read_text())['art_style_base']
    assert not {'positive_ground_text', 'rgba_text'} & set(style)
    node = bt.MyQi21美术风格底座()
    assert list(node.INPUT_TYPES()['optional']) == ['美术风格', '负向词表']
    result = node.output()
    assert result['result'] == (style['positive_text'], style['negative_text'])
    assert not {'bases_text_ground', 'bases_text_rgba', 'bases_text_protocol'} & set(result['ui'])
    assert bt.SECTIONS == ('系统提示词', '色卡', '美术风格底座')


@pytest.mark.parametrize('transparent', [False, True])
def test_legacy_protocol_cannot_restore_ground(transparent):
    assert pe._proto_base_segment(pe._parse_bases_protocol(LEGACY), transparent) == '铁线描与矿物罩染。'


def test_assembly_accepts_old_protocol_but_only_appends_style():
    pos, _ = assembly.MyQi21PromptAssembly().assemble(BASE='类型已有背景与光照规则。', 主体句='测试主体', 锁层A全文=LEGACY)
    assert '铁线描与矿物罩染。' in pos
    for old in ['旧背景', '强烈顶光', '鲜血', 'old transparent', '【']:
        assert old not in pos


@pytest.mark.parametrize('zh', ['人物多视图', '高清人脸', '表情差分', '道具', '设定卡'])
def test_transparent_fallback_preserves_type_light_and_source_state(zh):
    t = next(t for t in json.loads(SOURCE.read_text())['types'] if t['zh'] == zh)
    text = pe._rgba_lean_pos('按来源绘制主体。', t['positive_text'])
    assert '漫射光' in text
    assert '来源' in text
    assert '背景透明' not in text
    assert '底色：' not in text


def test_all_ten_types_own_their_background_light_and_state_rules():
    data = json.loads(SOURCE.read_text())
    for t in data['types']:
        if t['zh'] == '自由':
            assert t['positive_text'] == ''
            continue
        text = t['positive_text']
        assert '来源' in text, t['zh']
        assert '光' in text or '照明' in text, t['zh']
        assert '背景' in text or '环境' in text, t['zh']
    assert data['art_style_base']['positive_text'].startswith('美术风格底座：国风二维动漫手绘插画。')
    assert '简洁明暗色块' in data['art_style_base']['positive_text']
    for word in ('多手指', '文字错误', '背景'):
        assert word not in data['art_style_base']['negative_text']
