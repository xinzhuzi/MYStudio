"""Contracts for the isolated RGB FLUX.3 Daojie pipeline."""
import copy
import hashlib
import importlib.util
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[5]
SPEC=importlib.util.spec_from_file_location('flux_workflow',ROOT/'apps/build/scripts/flux3_daojie_workflow.py')
w=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(w)


def test_gui_expands_to_the_same_execution_graph_as_the_recorded_case():
    case=json.loads((w.TASK/'artifacts/cases.json').read_text())[0]
    receipt_bytes=(w.TASK/'reports/approved-live-subject-revision.json').read_bytes()
    assert hashlib.sha256(receipt_bytes).hexdigest()=='8f33e1be58cea3f28bdd9a872247dd3a18d8991f6df3fb300e1a707b8d7f7234'
    receipt=json.loads(receipt_bytes)
    for evidence in receipt['evidence']+receipt['frozen']:
        assert hashlib.sha256((ROOT/evidence['path']).read_bytes()).hexdigest()==evidence['sha256'],evidence['path']
    approval=json.loads((ROOT/receipt['evidence'][0]['path']).read_text())['messages']
    proposal=next(message for message in approval if message['sequence']==14)
    human=next(message for message in approval if message['sequence']==15)
    assert proposal['role']=='assistant' and 'flux3-道劫-t2i.json' in proposal['parts'][0]['text']
    assert human['session']==receipt['approval']['session'] and human['message']==receipt['approval']['message']
    assert human['role']=='user' and human['semantics']['origin']=='real_user' and human['semantics']['kind']=='user_prompt'
    assert human['parts'][0]['text']=='好'
    historical=w.expand_gui(json.loads((w.TASK/'artifacts/gui-template.json').read_text()))
    assert historical==w.api_graph(case)
    source=(ROOT/receipt['source']['path']).read_bytes()
    assert hashlib.sha256(source).hexdigest()==receipt['source']['observed_sha256']
    blocks=re.findall(r'^## (\d+)\.[^\n]*\n.*?^```[^\n]*\n(.*?)^```',source.decode('utf-8'),re.MULTILINE|re.DOTALL)
    assert len(blocks)==10 and blocks[0][0]=='1'
    subject=blocks[0][1].strip()
    assert hashlib.sha256(subject.encode('utf-8')).hexdigest()==receipt['subject_sha256']
    path=w.sources()[1].with_name('flux3-道劫-t2i.json')
    assert path==ROOT/receipt['gui']['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==receipt['gui']['sha256']
    current_gui=json.loads(path.read_text())
    subjects=[node for node in current_gui['nodes'] if node['id']==400]
    assert len(subjects)==1
    assert subjects[0]['widgets_values_named']['value']==subject
    assert subjects[0]['widgets_values']==[subject]
    current_case=copy.deepcopy(case)
    current_case['subject']=subject
    graph=w.expand_gui(current_gui)
    assert graph==w.api_graph(current_case)
    restored=copy.deepcopy(graph)
    restored['400']['inputs']['value']=case['subject']
    assert restored==historical
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
    """Verify registered source provenance, not frozen historical runtime rendering."""
    import hashlib
    drift=json.loads((w.TASK/'reports/source-drift.json').read_text())
    assert set(drift)=={'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json'}
    base='apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
    subject='docs/prompts/道劫_类型主体句示例.md'
    revisions=json.loads((w.TASK/'reports/shared-source-revisions.json').read_text())
    assert set(revisions)=={base,subject}
    assert revisions[subject]=={
        'original_sha256':'40ecae03da80454b5dbec330c0bf17d2eedf6725993864e329f3b040a1ef99ea',
        'approved_sha256':'1f30ca63bdf0a3fb8990376775230cf408eb0aae50cb33e470237393943f2925',
        'role':'runtime_execution_input_updated_after_snapshot',
        'historical_backup':'.trellis/tasks/archive/2026-10/10-18-daojie-conflict-p3-subject-docs/backups/道劫_类型主体句示例.md.bak-1019-p3',
        'leaf_receipt':'.trellis/tasks/10-16-flux3-daojie-ten-types/reports/approved-live-subject-revision.json',
        'leaf_receipt_sha256':'8f33e1be58cea3f28bdd9a872247dd3a18d8991f6df3fb300e1a707b8d7f7234',
    }
    subject_revision=revisions[subject]
    assert hashlib.sha256((ROOT/subject_revision['historical_backup']).read_bytes()).hexdigest()==subject_revision['original_sha256']
    assert hashlib.sha256((ROOT/subject_revision['leaf_receipt']).read_bytes()).hexdigest()==subject_revision['leaf_receipt_sha256']
    receipt=json.loads((ROOT/subject_revision['leaf_receipt']).read_text())
    assert receipt['scope']=='approved_document_and_subject_revision'
    assert receipt['source']['approved_sha256']==subject_revision['approved_sha256']
    for evidence in receipt['evidence']+receipt['frozen']:
        assert hashlib.sha256((ROOT/evidence['path']).read_bytes()).hexdigest()==evidence['sha256'],evidence['path']
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
        'approved_sha256':'5f332526318010661a33bbc8c4a514679beeeb0d6200b7bc32f09a7cd8f7feb2',
        'role':'runtime_execution_input_updated_after_snapshot',
        'historical_backup':'.trellis/tasks/archive/2026-10/10-18-daojie-conflict-p1-canon/backups/qi21_bases.json',
        'approval':{
            'path':'.trellis/tasks/archive/2026-10/10-18-daojie-prompt-conflict-cleanup/prd.md',
            'anchor':'## Decisions(grill 轮 1,2026-10-18 用户令「按推荐落实」)',
            'sha256':'42f8e93dee72f9c1ded2fda6e0c028d686f92a8c44d8e94af368353c3877a7a9',
        },
        'change_ledger':{
            'path':'.trellis/tasks/archive/2026-10/10-18-daojie-prompt-conflict-cleanup/research/json-before-after.md',
            'anchor':'## P1 真源 · qi21_bases.json(2026-10-18)',
            'sha256':'4c79065b06bd46b1569e90959a280a35a6dd1e84b23ff49ba02e8408335a249a',
        },
    }
    revision=revisions[base]
    assert hashlib.sha256((ROOT/revision['historical_backup']).read_bytes()).hexdigest()==revision['original_sha256']
    for evidence in (revision['approval'],revision['change_ledger']):
        content=(ROOT/evidence['path']).read_bytes()
        assert hashlib.sha256(content).hexdigest()==evidence['sha256']
        assert evidence['anchor'] in content.decode('utf-8').splitlines()
    snapshot=json.loads((w.TASK/'artifacts/source-hashes.json').read_text())
    assert snapshot[base]==revision['original_sha256']
    for name,digest in snapshot.items():
        current=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
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
