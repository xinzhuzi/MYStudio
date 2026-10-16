"""New style outputs are plain drawing language; old protocols are read-only compatibility."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import pytest
from engines.comfyui.my_nodes.nodes import my_qi21_api_pe as mod

ROOT = Path(__file__).resolve().parents[6]
NODE = Path(__file__).resolve().parents[1] / 'nodes/my_qi21_bases_text.py'
SPEC = importlib.util.spec_from_file_location('bases_protocol_compat', NODE)
bt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bt)
ASB = json.loads((ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json').read_text())['art_style_base']
STYLE, NEG = ASB['positive_text'], ASB['negative_text']
PROTO = f'【风格工艺件】{STYLE}\n【底色背景件】旧背景和强烈顶光\n【透明承载件】old isolation\n【负向词表】{NEG}'
SUBJ, TYPE = '一柄青铜断剑，刃口已有缺损。', '器物设定图，缺损依来源，均匀漫射光。'


def fire(transparent, text, negative='外接风格负向'):
    mod._RUNTIME_KEY = None
    return mod.MyQi21ApiPE().rewrite(
        正向提示词=SUBJ, 类型句正向=TYPE, 类型句负向='型级负向',
        画幅宽=1024, 画幅高=1024, 透明模式=transparent,
        api_url='http://127.0.0.1:9', timeout_sec=3,
        **{'美术风格底座-正向':text, '美术风格底座-负向':negative})['result']


def test_new_style_node_emits_plain_style_and_style_negative():
    node = bt.MyQi21美术风格底座()
    assert list(node.INPUT_TYPES()['optional']) == ['美术风格','负向词表']
    out = node.output(底色背景件='旧值不参与计算', 四段协议=PROTO)
    assert out['result'] == (STYLE,NEG)
    assert out['ui'] == {'bases_text':[STYLE],'bases_text_negative':[NEG]}


def test_plain_library_requires_no_piece_fields(tmp_path,monkeypatch):
    p=tmp_path/'qi21_bases.json'
    p.write_text(json.dumps({'art_style_base':{'positive_text':'铁线描。','negative_text':'油亮高光'}}))
    monkeypatch.setattr(bt,'_BASES_JSON',p)
    monkeypatch.setattr(bt,'_cache',{'mtime':None,'data':None})
    assert bt.MyQi21美术风格底座().output()['result'] == ('铁线描。','油亮高光')


def test_legacy_protocol_is_still_readable():
    parsed=mod._parse_bases_protocol(PROTO)
    assert parsed == {'style':STYLE,'ground':'旧背景和强烈顶光','rgba':'old isolation','neg':NEG}
    assert mod._parse_bases_protocol('普通画法') is None
    assert mod._parse_bases_protocol('【风格工艺件】残缺协议') is None


@pytest.mark.parametrize('transparent',[False,True])
def test_legacy_ground_is_never_used_by_style_assembly(transparent):
    assert mod._proto_base_segment(mod._parse_bases_protocol(PROTO),transparent) == STYLE
    pos,neg,tm,w,h=fire(transparent,PROTO)
    assert STYLE in pos
    assert '旧背景' not in pos and 'old isolation' not in pos
    assert '型级负向' in neg and '外接风格负向' not in neg
    assert (tm,w,h)==(transparent,1024,1024)


def test_plain_wired_style_and_negative_continue_to_work():
    pos,neg,*_=fire(False,STYLE)
    assert pos == f'主体句:{SUBJ}\n类型句:{TYPE}\n{STYLE}'
    assert neg.startswith('型级负向, 外接风格负向')


def test_partial_legacy_protocol_uses_clean_hot_style():
    pos,*_=fire(False,'【风格工艺件】旧画法\n【底色背景件】旧背景')
    assert STYLE in pos and '旧背景' not in pos and '【' not in pos


def test_production_style_snapshots_have_only_two_display_fields():
    cards = list((ROOT/'apps/backend/engines/comfyui/my_nodes/subgraphs').glob('qi21-*.json'))
    cards += [p for p in (ROOT/'apps/backend/engines/comfyui/workflows').rglob('qi21-*.json') if 't2i' in p.name]
    count=0
    for p in cards:
        d=json.loads(p.read_text())
        for sg in d.get('definitions',{}).get('subgraphs',[]):
            for node in sg.get('nodes',[]):
                if node.get('type')!='MyQi21美术风格底座': continue
                count+=1
                assert node['widgets_values']==[STYLE,NEG]
                assert node['widgets_values_named']=={'美术风格':STYLE,'负向词表':NEG}
                assert node['properties']['qi21StyleSchema']==2
                assert node['size']==[560,400]
                links={(l['origin_id'],l['origin_slot']):(l['target_id'],l['target_slot']) for l in sg['links']}
                assert links[(4032,0)]==(4013,2)
                assert links[(4032,1)]==(4013,3)
    assert count==2
