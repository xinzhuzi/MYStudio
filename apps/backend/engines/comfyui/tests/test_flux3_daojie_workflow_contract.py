"""Contracts for the isolated RGB FLUX.3 Daojie pipeline."""
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[5]
SPEC=importlib.util.spec_from_file_location('flux_workflow',ROOT/'apps/build/scripts/flux3_daojie_workflow.py')
w=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(w)


def test_gui_expands_to_the_same_execution_graph_as_the_recorded_case():
    case=json.loads((w.TASK/'artifacts/cases.json').read_text())[0]
    path=w.sources()[1].with_name('flux3-道劫-t2i.json')
    graph=w.expand_gui(json.loads(path.read_text()))
    assert graph==w.api_graph(case)
    assert w.validate_api(graph)
    assert graph['4013']['inputs']['AI扩写开关'] is True
    assert graph['4013']['inputs']['api_url']=='http://127.0.0.1:1234'
    assert graph['4013']['inputs']['model']==w.MODEL
    assert graph['4013']['inputs']['max_tokens']==2048
    assert graph['4013']['inputs']['透明模式']==['4017',3]
    assert graph['4014']['inputs']['透明模式']==['4013',2]
    assert graph['6']['inputs']['width']==['4013',3]
    assert graph['6']['inputs']['height']==['4013',4]
    assert graph['4']['inputs']['text']==['4014',0]
    assert graph['5']['inputs']['text']==['4014',1]
    assert graph['7']['inputs']['steps']==15
    assert graph['7']['inputs']['cfg']==1
    forbidden=('Lora','SeedVR','TextGenerate','TextEncodeQwen')
    assert not any(any(f in n['class_type'] for f in forbidden) for n in graph.values())


def test_ten_cases_preserve_source_facts_and_native_dimensions():
    cases=json.loads((w.TASK/'artifacts/cases.json').read_text())
    assert [c['type'] for c in cases]==['人物','场景','道具','美宣','人物多视图','高清人脸','分镜剧情图','表情差分','概念气氛图','设定卡']
    assert [(c['width'],c['height']) for c in cases]==[(1088,1440),(1664,944),(1024,1024),(1920,832),(1792,1008),(1024,1024),(1664,944),(1248,1248),(1664,944),(1664,944)]
    assert len({c['seed'] for c in cases})==10
    for c in cases:
        assert c['subject'] and c['source_sha256']
        w.validate_api(w.api_graph(c))


def test_shared_sources_are_unchanged_since_the_builder_snapshot():
    import hashlib
    drift=json.loads((w.TASK/'reports/source-drift.json').read_text())
    for name,digest in json.loads((w.TASK/'artifacts/source-hashes.json').read_text()).items():
        current=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
        if name in drift:
            assert Path(name).name=='qi21-道劫-t2i.json'
            assert drift[name]['original_sha256']==digest
            assert drift[name]['role']=='reference_only_not_execution_input'
            first=json.loads((w.TASK/'artifacts/cases.json').read_text())[0]
            assert w.expand_gui(json.loads((w.TASK/'artifacts/gui-template.json').read_text()))==w.api_graph(first)
        else:assert current==digest,name
