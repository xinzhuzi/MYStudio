"""Contracts for the isolated RGB FLUX.3 Daojie pipeline."""
import copy
import hashlib
import importlib.util
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]
SPEC=importlib.util.spec_from_file_location('flux_workflow',ROOT/'apps/build/scripts/flux3_daojie_workflow.py')
w=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(w)


def test_gui_expands_to_the_same_execution_graph_as_the_recorded_case(monkeypatch):
    case=json.loads((w.TASK/'artifacts/cases.json').read_text())[0]
    receipt_bytes=(w.TASK/'reports/approved-live-subject-revision-1021-3dcutaway.json').read_bytes()
    assert hashlib.sha256(receipt_bytes).hexdigest()=='90390978f454658408492d0b7696a58f166f2d4edffeaf2d039c06984565e612'
    receipt=json.loads(receipt_bytes)
    for evidence in receipt['evidence']+receipt['frozen']:
        assert hashlib.sha256(w.resolve(ROOT, evidence['path']).read_bytes()).hexdigest()==evidence['sha256'],evidence['path']
    approval=json.loads(w.resolve(ROOT, receipt['evidence'][0]['path']).read_text())['messages']
    proposal=next(message for message in approval if message['sequence']==14)
    human=next(message for message in approval if message['sequence']==15)
    assert proposal['role']=='assistant' and 'flux3-道劫-t2i.json' in proposal['parts'][0]['text']
    assert human['session']==receipt['approval']['session'] and human['message']==receipt['approval']['message']
    assert human['role']=='user' and human['semantics']['origin']=='real_user' and human['semantics']['kind']=='user_prompt'
    assert human['parts'][0]['text']=='好'
    historical=w.expand_gui(json.loads((w.TASK/'artifacts/gui-template.json').read_text()))
    assert historical==w.api_graph(case)
    source=w.resolve(ROOT, receipt['source']['path']).read_bytes()
    # Historical receipt predates the label rename; compare its unchanged payload.
    assert hashlib.sha256(source.replace('人物海报'.encode(), '人物'.encode())).hexdigest()==receipt['source']['observed_sha256']
    blocks=re.findall(r'^## (\d+)\.[^\n]*\n.*?^```[^\n]*\n(.*?)^```',source.decode('utf-8'),re.MULTILINE|re.DOTALL)
    assert len(blocks)==11 and blocks[0][0]=='1'  # 1021 示例库 §11 3D剖面场景图入列(十型→十一型)
    subject=blocks[0][1].strip()
    assert hashlib.sha256(subject.encode('utf-8')).hexdigest()==receipt['subject_sha256']
    path=w.sources()[1].with_name('flux3-道劫-t2i.json')
    assert path==ROOT/receipt['gui']['path']
    assert hashlib.sha256(path.read_bytes().replace('人物海报'.encode(), '人物'.encode())).hexdigest()==receipt['gui']['sha256']
    current_gui=json.loads(path.read_text())
    subjects=[node for node in current_gui['nodes'] if node['id']==400]
    assert len(subjects)==1
    assert subjects[0]['widgets_values_named']['value']==subject
    assert subjects[0]['widgets_values']==[subject]
    current_case=copy.deepcopy(case)
    current_case['subject']=subject
    current_case['type']='人物海报'
    graph=w.expand_gui(current_gui)
    assert graph==w.api_graph(current_case)
    restored=copy.deepcopy(graph)
    restored['400']['inputs']['value']=case['subject']
    restored['4010']['inputs']['base']=case['type']
    assert restored==historical
    # Validate the current GUI against the current node's enum, not the frozen receipt.
    from comfyui.my_nodes.nodes.my_qi21_base import MyQi21DaojieBase
    current_info=copy.deepcopy(w.INFO)
    current_info['MyQi21DaojieBase']['input']=MyQi21DaojieBase.INPUT_TYPES()
    monkeypatch.setattr(w,'INFO',current_info)
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
    # Frozen generation cases retain the type name used when they actually ran.
    assert [c['type'] for c in cases]==['人物','场景','道具','美宣','人物多视图','高清人脸','分镜剧情图','表情差分','概念气氛图','设定卡']
    assert [(c['width'],c['height']) for c in cases]==[(1088,1440),(1664,944),(1024,1024),(1920,832),(1792,1008),(1024,1024),(1664,944),(1248,1248),(1664,944),(1664,944)]
    assert len({c['seed'] for c in cases})==10
    for c in cases:
        assert c['subject'] and c['source_sha256']
        w.validate_api(w.api_graph(c))


def test_shared_sources_are_unchanged_since_the_builder_snapshot():
    """Verify registered source provenance, not frozen historical runtime rendering."""
    import hashlib
    drift=json.loads((w.TASK/'reports/source-drift.json').read_text())
    assert set(drift)=={'apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json'}
    base='apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
    subject='docs/prompts/道劫_类型主体句示例.md'
    revisions=json.loads((w.TASK/'reports/shared-source-revisions.json').read_text())
    assert set(revisions)=={base,subject}
    assert revisions[subject]=={
        'original_sha256':'40ecae03da80454b5dbec330c0bf17d2eedf6725993864e329f3b040a1ef99ea',
        'approved_sha256':'0f38e714067c3b61da2c83751f55238cd117adc4559849d2f6fcdd35691ff7de',
        'role':'runtime_execution_input_updated_after_snapshot',
        'historical_backup':'.trellis/tasks/archive/2026-10/10-18-daojie-conflict-p3-subject-docs/backups/道劫_类型主体句示例.md.bak-1019-p3',
        'leaf_receipt':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/approved-live-subject-revision-1021-3dcutaway.json',
        'leaf_receipt_sha256':'90390978f454658408492d0b7696a58f166f2d4edffeaf2d039c06984565e612',
    }
    subject_revision=revisions[subject]
    assert hashlib.sha256(w.resolve(ROOT, subject_revision['historical_backup']).read_bytes()).hexdigest()==subject_revision['original_sha256']
    assert hashlib.sha256(w.resolve(ROOT, subject_revision['leaf_receipt']).read_bytes()).hexdigest()==subject_revision['leaf_receipt_sha256']
    receipt=json.loads(w.resolve(ROOT, subject_revision['leaf_receipt']).read_text())
    assert receipt['scope']=='approved_document_and_subject_revision'
    assert receipt['source']['approved_sha256']==subject_revision['approved_sha256']
    for evidence in receipt['evidence']+receipt['frozen']:
        assert hashlib.sha256(w.resolve(ROOT, evidence['path']).read_bytes()).hexdigest()==evidence['sha256'],evidence['path']
    gender=json.loads((ROOT/receipt['evidence'][-1]['path']).read_text())['messages']
    assert [message['sequence'] for message in gender]==[121,122,123]
    for human in (gender[0],gender[2]):
        assert human['role']=='user' and human['semantics']['origin']=='real_user' and human['semantics']['kind']=='user_prompt'
    assert gender[0]['parts'][0]['text']=='女性和男性必须保持一致,不能男性变女性,也不能女性变男性'
    assert '性别恒定' in gender[1]['parts'][0]['text']
    assert gender[2]['message']==receipt['gender_approval']['message']
    assert gender[2]['parts'][0]['text']=='按照你的建议去做'
    assert revisions[base]=={
        'original_sha256':'a2df104bf740670cbea1fbe9b06ba43c7695b7d2be26d0a6cfc621e422967bff',
        'approved_sha256':'5151c81f9323bfddc86e5f7f83f837d7b41125920b574444469ca26a2cd351ea',
        'role':'runtime_execution_input_updated_after_snapshot',
        'historical_backup':'.trellis/tasks/archive/2026-10/10-18-daojie-conflict-p1-canon/backups/qi21_bases.json',
        'approval':{
            'path':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-reapproval-1023-bodybase.md',
            'anchor':'## Decisions(2026-10-23 用户令「目前是 无衣物定妆,用这个来新作一个类型」)',
            'sha256':'592641c223763ba7fd7ddd500872653f4613100862f2c05cf14ca2a7ed7746de',
        },
        'change_ledger':{
            'path':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/bases-change-ledger-1023-bodybase.md',
            'anchor':'## 字段级变更(2 处,1023 无衣物定妆入列实测)',
            'sha256':'badfbe39ffe33fa9d566ae9d539eab48d6b27a3a30ceb8a00f0e98b017baae8d',
        },
    }
    revision=revisions[base]
    assert hashlib.sha256((ROOT/revision['historical_backup']).read_bytes()).hexdigest()==revision['original_sha256']
    for evidence in (revision['approval'],revision['change_ledger']):
        content=w.resolve(ROOT, evidence['path']).read_bytes()
        assert hashlib.sha256(content).hexdigest()==evidence['sha256']
        assert evidence['anchor'] in content.decode('utf-8').splitlines()
    snapshot=json.loads((w.TASK/'artifacts/source-hashes.json').read_text())
    assert snapshot[base]==revision['original_sha256']
    for name,digest in snapshot.items():
        content=(ROOT/name).read_bytes()
        if name in (base,subject):
            content=content.replace('人物海报'.encode(), '人物'.encode())
        current=hashlib.sha256(content).hexdigest()
        if name==base:
            assert current==revision['approved_sha256'],name
        elif name==subject:
            assert digest==subject_revision['original_sha256']
            assert current==subject_revision['approved_sha256'],name
        elif name in drift:
            assert Path(name).name=='qi21-道劫-t2i.json'
            assert drift[name]['original_sha256']==digest
            assert drift[name]['role']=='reference_only_not_execution_input'
            first=json.loads((w.TASK/'artifacts/cases.json').read_text())[0]
            assert w.expand_gui(json.loads((w.TASK/'artifacts/gui-template.json').read_text()))==w.api_graph(first)
        else:assert current==digest,name
