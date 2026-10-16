"""Evidence verifier rejects corrupted persisted artifacts without contacting Windows."""
import copy
import json
from pathlib import Path
import shutil
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parent))
import flux3_daojie_verify as v


@pytest.fixture
def evidence(tmp_path,monkeypatch):
    source=v.w.TASK
    (tmp_path/'artifacts').mkdir();(tmp_path/'reports').mkdir()
    shutil.copytree(source/'artifacts/01',tmp_path/'artifacts/01')
    for name in ['cases.json','source-hashes.json','gui-template.json']:
        shutil.copyfile(source/'artifacts'/name,tmp_path/'artifacts'/name)
    shutil.copyfile(source/'reports/source-drift.json',tmp_path/'reports/source-drift.json')
    monkeypatch.setattr(v.w,'TASK',tmp_path)
    return tmp_path


def result(root):
    v.verify()
    return json.loads((root/'reports/final-verification.json').read_text())


def test_valid_first_type_is_not_ten_type_or_visual_or_gui_success(evidence):
    r=result(evidence)
    assert r['count']==1 and not r['generation_ok']
    assert not r['visual_ok'] and not r['gui_verified']
    assert r['types'][0]['generation_ok'] and r['types'][0]['visual_status']=='issues'


@pytest.mark.parametrize('mutation',['wrong_id','pe_off','text_substitution','wrong_hash','wrong_size'])
def test_corrupted_receipt_is_rejected(evidence,mutation):
    p=evidence/'artifacts/01/receipt.json';r=json.loads(p.read_text())
    if mutation=='wrong_id':r['prompt_id']='different-id'
    elif mutation=='pe_off':r['api_pe_status']='AI扩写关闭'
    elif mutation=='text_substitution':r['final_positive']='unrelated hand-written prompt'
    elif mutation=='wrong_hash':r['sha256']='0'*64
    elif mutation=='wrong_size':r['size']=[1,1]
    p.write_text(json.dumps(r))
    report=result(evidence)
    assert report['count']==0 and not report['types'][0]['generation_ok']
    assert report['types'][0]['error']


def test_pe_payload_must_equal_approved_graph_even_when_history_matches(evidence):
    folder=evidence/'artifacts/01'
    p=folder/'pe-prompt.json';request=json.loads(p.read_text())
    request['prompt']['4013']['inputs']['temperature']=1.9
    p.write_text(json.dumps(request))
    p=folder/'pe-history.json';history=json.loads(p.read_text())
    history['prompt'][2]=copy.deepcopy(request['prompt']);p.write_text(json.dumps(history))
    report=result(evidence)
    assert not report['types'][0]['generation_ok']
